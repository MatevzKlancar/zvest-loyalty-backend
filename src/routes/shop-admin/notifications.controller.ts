import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { pushNotificationService } from "../../services/push-notifications";

export const notificationsController = new OpenAPIHono<UnifiedAuthContext>();

// Categories an admin can broadcast under. Personal-only types (birthday,
// coupon_ready, points_earned) aren't broadcastable — they're triggered by
// system events and have their own opt-in path.
const BROADCAST_CATEGORIES = ["manual", "daily_meal", "specials"] as const;
const broadcastCategorySchema = z.enum(BROADCAST_CATEGORIES);

// Per-shop broadcast rate limit. Prevents one shop from torching every
// subscriber's inbox even after the subscription model is in place.
const HOURLY_LIMIT = 1;
const DAILY_LIMIT = 2;

async function checkBroadcastQuota(
  shopId: string
): Promise<{ allowed: boolean; daily_remaining: number; retry_after_seconds: number }> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [hourResult, dayResult] = await Promise.all([
    supabase
      .from("push_notifications")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("notification_type", "manual")
      .gte("created_at", oneHourAgo),
    supabase
      .from("push_notifications")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("notification_type", "manual")
      .gte("created_at", oneDayAgo),
  ]);

  const hourly = hourResult.count ?? 0;
  const daily = dayResult.count ?? 0;
  const daily_remaining = Math.max(0, DAILY_LIMIT - daily);

  if (hourly >= HOURLY_LIMIT) {
    return { allowed: false, daily_remaining, retry_after_seconds: 60 * 60 };
  }
  if (daily >= DAILY_LIMIT) {
    return { allowed: false, daily_remaining: 0, retry_after_seconds: 24 * 60 * 60 };
  }
  return { allowed: true, daily_remaining, retry_after_seconds: 0 };
}

// =============================================================================
// POST /notifications/broadcast — send now or schedule
// =============================================================================
const sendBroadcastRoute = createRoute({
  method: "post",
  path: "/notifications/broadcast",
  summary: "Send or schedule a notification to subscribed customers",
  description:
    "Sends to customers who have favorited this shop AND opted in for the given category. " +
    "If scheduled_for is provided, queues the send instead of dispatching immediately.",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            category: broadcastCategorySchema.describe(
              "Notification category. Used to filter subscribers and tag analytics."
            ),
            title: z.string().min(1).max(100).describe("Notification title"),
            body: z.string().min(1).max(500).describe("Notification message"),
            data: z
              .record(z.any())
              .optional()
              .describe("Optional custom data payload"),
            scheduled_for: z
              .string()
              .datetime()
              .optional()
              .describe(
                "ISO timestamp. If omitted, sends immediately. If provided, must be in the future."
              ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Notification sent or scheduled",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              scheduled: z.boolean(),
              scheduled_id: z.string().nullable(),
              audience_size: z.number(),
              sent: z.number().optional(),
              failed: z.number().optional(),
              dry_run: z.number().optional(),
              daily_quota_remaining: z.number(),
            }),
          }),
        },
      },
    },
    429: {
      description: "Broadcast quota exceeded",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              retry_after_seconds: z.number(),
              daily_quota_remaining: z.number(),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(sendBroadcastRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { category, title, body, data, scheduled_for } = c.req.valid("json");

    // Rate limit only applies to immediate manual broadcasts, not scheduled
    // sends or system categories. (Scheduled sends will be rate-limited
    // implicitly when the dispatcher runs them.)
    if (!scheduled_for && category === "manual") {
      const quota = await checkBroadcastQuota(shop.id);
      if (!quota.allowed) {
        return c.json(
          {
            success: false,
            message: "Broadcast quota exceeded",
            data: {
              retry_after_seconds: quota.retry_after_seconds,
              daily_quota_remaining: quota.daily_remaining,
            },
          },
          429
        );
      }
    }

    // Schedule path
    if (scheduled_for) {
      const scheduledDate = new Date(scheduled_for);
      if (scheduledDate.getTime() <= Date.now()) {
        return c.json(
          standardResponse(400, "scheduled_for must be in the future"),
          400
        );
      }

      const { data: row, error } = await supabase
        .from("scheduled_notifications")
        .insert({
          shop_id: shop.id,
          notification_type: category,
          title,
          body,
          data: data || {},
          scheduled_for: scheduledDate.toISOString(),
        })
        .select("id")
        .single();

      if (error || !row) {
        logger.error("Error scheduling notification", { error });
        return c.json(standardResponse(500, "Failed to schedule notification"), 500);
      }

      // Audience preview for the response — what *would* be reached if sent now.
      const audienceSize = await getSubscribedCount(shop.id, category);

      return c.json(
        standardResponse(200, "Notification scheduled", {
          scheduled: true,
          scheduled_id: row.id,
          audience_size: audienceSize,
          daily_quota_remaining: DAILY_LIMIT,
        })
      );
    }

    // Immediate path
    logger.info("Broadcasting notification", {
      shopId: shop.id,
      category,
      title,
    });

    const result = await pushNotificationService.sendToShopCustomers(shop.id, {
      title,
      body,
      data,
      notificationType: category,
    });

    if (!result.success) {
      return c.json(
        standardResponse(400, result.message || "Failed to send notification"),
        400
      );
    }

    const audienceSize = "total" in result ? (result.total ?? 0) : 0;

    // Recompute remaining quota after this send (for the dashboard indicator).
    const quotaAfter =
      category === "manual"
        ? await checkBroadcastQuota(shop.id)
        : { daily_remaining: DAILY_LIMIT };

    return c.json(
      standardResponse(200, "Notification sent successfully", {
        scheduled: false,
        scheduled_id: null,
        audience_size: audienceSize,
        sent: "sent" in result ? result.sent : 0,
        failed: "failed" in result ? result.failed : 0,
        dry_run: "dryRun" in result ? (result as any).dryRun : 0,
        daily_quota_remaining: quotaAfter.daily_remaining,
      })
    );
  } catch (error) {
    logger.error("Error broadcasting notification", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// GET /notifications/audience-preview — how many subscribers for a category
// =============================================================================
async function getSubscribedCount(
  shopId: string,
  category: string
): Promise<number> {
  // categories is a JSONB column; filter via ->>
  const { data, error } = await supabase
    .from("user_shop_notification_preferences")
    .select("app_user_id, categories")
    .eq("shop_id", shopId);

  if (error || !data) return 0;
  return data.filter((row) => {
    const cats = (row.categories ?? {}) as Record<string, boolean>;
    return cats[category] === true;
  }).length;
}

const audiencePreviewRoute = createRoute({
  method: "get",
  path: "/notifications/audience-preview",
  summary: "Preview broadcast audience size for a category",
  description:
    "Returns how many of this shop's customers are currently subscribed and opted in for the given category.",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      category: broadcastCategorySchema,
    }),
  },
  responses: {
    200: {
      description: "Audience preview",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              category: z.string(),
              subscribed_count: z
                .number()
                .describe("Users subscribed AND opted in for this category"),
              total_with_loyalty: z
                .number()
                .describe(
                  "Users with a loyalty account (legacy reach for context)"
                ),
              total_subscribers: z
                .number()
                .describe("Users who have favorited this shop (any category)"),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(audiencePreviewRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { category } = c.req.valid("query");

    const [subscribedCount, totalSubsResult, loyaltyResult] = await Promise.all(
      [
        getSubscribedCount(shop.id, category),
        supabase
          .from("user_shop_notification_preferences")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id),
        supabase
          .from("customer_loyalty_accounts")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id),
      ]
    );

    return c.json(
      standardResponse(200, "Audience preview", {
        category,
        subscribed_count: subscribedCount,
        total_with_loyalty: loyaltyResult.count ?? 0,
        total_subscribers: totalSubsResult.count ?? 0,
      })
    );
  } catch (error) {
    logger.error("Error getting audience preview", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// GET /notifications/quota — broadcast quota indicator for the dashboard
// =============================================================================
const quotaRoute = createRoute({
  method: "get",
  path: "/notifications/quota",
  summary: "Get current broadcast quota status",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Quota status",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              daily_limit: z.number(),
              daily_remaining: z.number(),
              hourly_limit: z.number(),
              can_send_now: z.boolean(),
              retry_after_seconds: z.number(),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(quotaRoute, async (c) => {
  const shop = c.get("shop");
  const quota = await checkBroadcastQuota(shop.id);
  return c.json(
    standardResponse(200, "Quota status", {
      daily_limit: DAILY_LIMIT,
      daily_remaining: quota.daily_remaining,
      hourly_limit: HOURLY_LIMIT,
      can_send_now: quota.allowed,
      retry_after_seconds: quota.retry_after_seconds,
    })
  );
});

// =============================================================================
// GET /notifications/scheduled — list upcoming scheduled sends
// =============================================================================
const listScheduledRoute = createRoute({
  method: "get",
  path: "/notifications/scheduled",
  summary: "List scheduled notifications",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      status: z
        .enum(["scheduled", "sending", "sent", "cancelled", "failed"])
        .optional(),
    }),
  },
  responses: {
    200: {
      description: "Scheduled notifications",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              scheduled: z.array(
                z.object({
                  id: z.string(),
                  notification_type: z.string(),
                  title: z.string(),
                  body: z.string(),
                  scheduled_for: z.string(),
                  status: z.string(),
                  recipient_count: z.number().nullable(),
                  sent_at: z.string().nullable(),
                  created_at: z.string().nullable(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(listScheduledRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { status } = c.req.valid("query");

    let query = supabase
      .from("scheduled_notifications")
      .select(
        "id, notification_type, title, body, scheduled_for, status, recipient_count, sent_at, created_at"
      )
      .eq("shop_id", shop.id)
      .order("scheduled_for", { ascending: true });

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      logger.error("Error fetching scheduled notifications", { error });
      return c.json(standardResponse(500, "Failed to fetch"), 500);
    }

    return c.json(
      standardResponse(200, "Scheduled notifications", {
        scheduled: data || [],
      })
    );
  } catch (error) {
    logger.error("Error listing scheduled notifications", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// DELETE /notifications/scheduled/:id — cancel a scheduled send
// =============================================================================
const cancelScheduledRoute = createRoute({
  method: "delete",
  path: "/notifications/scheduled/{id}",
  summary: "Cancel a scheduled notification",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Cancelled",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Not found or not cancellable",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(cancelScheduledRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { id } = c.req.valid("param");

    const { data, error } = await supabase
      .from("scheduled_notifications")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("shop_id", shop.id)
      .eq("status", "scheduled")
      .select("id")
      .single();

    if (error || !data) {
      return c.json(
        standardResponse(404, "Not found or already sent/cancelled"),
        404
      );
    }

    return c.json(standardResponse(200, "Cancelled"));
  } catch (error) {
    logger.error("Error cancelling scheduled notification", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// POST /notifications/birthday-template — unchanged externally
// =============================================================================
const setBirthdayNotificationRoute = createRoute({
  method: "post",
  path: "/notifications/birthday-template",
  summary: "Set birthday notification template",
  description:
    "Create or update the birthday notification template for this shop. " +
    "Only customers who have favorited the shop and opted in for birthday " +
    "messages will receive these notifications.",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            title: z.string().min(1).max(100).describe("Notification title"),
            body: z
              .string()
              .min(1)
              .max(500)
              .describe(
                "Notification message (e.g., 'Happy birthday! Spend $30 and get 20% off today')"
              ),
            data: z
              .record(z.any())
              .optional()
              .describe("Optional custom data payload"),
            is_active: z
              .boolean()
              .describe("Whether birthday notifications are enabled"),
            coupon_id: z
              .string()
              .uuid()
              .nullable()
              .optional()
              .describe(
                "Optional: coupon to attach to the birthday push. Should usually be an is_birthday_only coupon. Pass null to clear."
              ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Birthday notification template saved",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              id: z.string(),
              is_active: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(setBirthdayNotificationRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { title, body, data, is_active, coupon_id } = c.req.valid("json");

    // If a coupon_id was supplied, verify it belongs to this shop. Cheap
    // ownership check so a shop can't bind another shop's coupon.
    if (coupon_id) {
      const { data: coupon } = await supabase
        .from("coupons")
        .select("id")
        .eq("id", coupon_id)
        .eq("shop_id", shop.id)
        .single();
      if (!coupon) {
        return c.json(
          standardResponse(400, "coupon_id does not belong to this shop"),
          400
        );
      }
    }

    const { data: existing } = await supabase
      .from("notification_templates")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("type", "birthday")
      .single();

    let result;

    if (existing) {
      const updatePayload: Record<string, any> = {
        title,
        body,
        data: data || {},
        is_active,
        updated_at: new Date().toISOString(),
      };
      // coupon_id is optional in the schema; only touch it when the caller sent it.
      if (coupon_id !== undefined) updatePayload.coupon_id = coupon_id;

      const { data: updated, error } = await supabase
        .from("notification_templates")
        .update(updatePayload)
        .eq("id", existing.id)
        .select("id, is_active")
        .single();

      if (error) {
        logger.error("Error updating birthday template", { error });
        return c.json(
          standardResponse(500, "Failed to update birthday notification"),
          500
        );
      }

      result = updated;
    } else {
      const insertPayload: Record<string, any> = {
        shop_id: shop.id,
        name: "Birthday Notification",
        type: "birthday",
        title,
        body,
        data: data || {},
        is_active,
      };
      if (coupon_id !== undefined) insertPayload.coupon_id = coupon_id;

      const { data: created, error } = await supabase
        .from("notification_templates")
        .insert(insertPayload)
        .select("id, is_active")
        .single();

      if (error) {
        logger.error("Error creating birthday template", { error });
        return c.json(
          standardResponse(500, "Failed to create birthday notification"),
          500
        );
      }

      result = created;
    }

    return c.json(
      standardResponse(200, "Birthday notification template saved", result)
    );
  } catch (error) {
    logger.error("Error setting birthday notification", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// GET /notifications/birthday-template
// =============================================================================
const getBirthdayNotificationRoute = createRoute({
  method: "get",
  path: "/notifications/birthday-template",
  summary: "Get birthday notification template",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Birthday notification template retrieved",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z
              .object({
                id: z.string(),
                title: z.string(),
                body: z.string(),
                data: z.record(z.any()),
                is_active: z.boolean(),
                coupon_id: z.string().nullable(),
                coupon: z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    type: z.string(),
                    is_birthday_only: z.boolean(),
                  })
                  .nullable(),
              })
              .nullable(),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(getBirthdayNotificationRoute, async (c) => {
  try {
    const shop = c.get("shop");

    const { data: template, error } = await supabase
      .from("notification_templates")
      .select("id, title, body, data, is_active, coupon_id")
      .eq("shop_id", shop.id)
      .eq("type", "birthday")
      .single();

    if (error && error.code !== "PGRST116") {
      logger.error("Error fetching birthday template", { error });
      return c.json(
        standardResponse(500, "Failed to fetch birthday notification"),
        500
      );
    }

    let coupon: any = null;
    const couponId = (template as any)?.coupon_id;
    if (couponId) {
      const { data: c2 } = await supabase
        .from("coupons")
        .select("id, name, type, is_birthday_only")
        .eq("id", couponId)
        .single();
      coupon = c2 ?? null;
    }

    return c.json(
      standardResponse(
        200,
        template ? "Template found" : "No template configured",
        template ? { ...template, coupon } : null
      )
    );
  } catch (error) {
    logger.error("Error getting birthday notification", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// GET /notifications/history — extended with new categories + dry_run status
// =============================================================================
const HISTORY_TYPES = [
  "birthday",
  "manual",
  "points_earned",
  "coupon_ready",
  "daily_meal",
  "specials",
] as const;
const HISTORY_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "failed",
  "error",
  "dry_run",
] as const;

const getNotificationHistoryRoute = createRoute({
  method: "get",
  path: "/notifications/history",
  summary: "Get notification history",
  description:
    "History of push notifications sent (or recorded as dry_run when delivery is disabled).",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      page: z.string().optional().default("1"),
      limit: z.string().optional().default("50"),
      type: z.enum(HISTORY_TYPES).optional(),
      status: z.enum(HISTORY_STATUSES).optional(),
    }),
  },
  responses: {
    200: {
      description: "Notification history retrieved",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              notifications: z.array(
                z.object({
                  id: z.string(),
                  notification_type: z.string(),
                  title: z.string(),
                  body: z.string(),
                  status: z.string(),
                  sent_at: z.string().nullable(),
                  created_at: z.string().nullable(),
                })
              ),
              total: z.number(),
              page: z.number(),
              limit: z.number(),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(getNotificationHistoryRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { page, limit, type, status } = c.req.valid("query");

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from("push_notifications")
      .select(
        "id, notification_type, title, body, status, sent_at, created_at",
        { count: "exact" }
      )
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (type) query = query.eq("notification_type", type);
    if (status) query = query.eq("status", status);

    const { data: notifications, error, count } = await query;

    if (error) {
      logger.error("Error fetching notification history", { error });
      return c.json(
        standardResponse(500, "Failed to fetch notification history"),
        500
      );
    }

    return c.json(
      standardResponse(200, "Notification history retrieved", {
        notifications: notifications || [],
        total: count || 0,
        page: pageNum,
        limit: limitNum,
      })
    );
  } catch (error) {
    logger.error("Error getting notification history", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// GET /notifications/analytics — extended with subscribers + per-category rates
// =============================================================================
const getNotificationAnalyticsRoute = createRoute({
  method: "get",
  path: "/notifications/analytics",
  summary: "Get notification analytics",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Notification analytics retrieved",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              total_sent: z.number(),
              total_delivered: z.number(),
              total_failed: z.number(),
              total_dry_run: z.number(),
              delivery_rate: z
                .number()
                .describe("Percentage of delivered notifications"),
              by_type: z.record(z.number()),
              delivery_rate_by_type: z
                .record(z.number())
                .describe("Per-category delivery rate (0-100)"),
              subscriber_count: z
                .number()
                .describe(
                  "Customers who have favorited this shop (regardless of category)"
                ),
              subscriber_count_by_category: z
                .record(z.number())
                .describe("Opt-in counts per category"),
            }),
          }),
        },
      },
    },
  },
});

notificationsController.openapi(getNotificationAnalyticsRoute, async (c) => {
  try {
    const shop = c.get("shop");

    const [{ data: notifications, error: notifErr }, { data: subs, error: subErr }] =
      await Promise.all([
        supabase
          .from("push_notifications")
          .select("notification_type, status")
          .eq("shop_id", shop.id),
        supabase
          .from("user_shop_notification_preferences")
          .select("categories")
          .eq("shop_id", shop.id),
      ]);

    if (notifErr) {
      logger.error("Error fetching notification analytics", { error: notifErr });
      return c.json(
        standardResponse(500, "Failed to fetch notification analytics"),
        500
      );
    }
    if (subErr) {
      logger.error("Error fetching subscriber analytics", { error: subErr });
      return c.json(
        standardResponse(500, "Failed to fetch subscriber analytics"),
        500
      );
    }

    const all = notifications ?? [];
    const totalSent = all.filter((n) => n.status !== "pending").length;
    const totalDelivered = all.filter((n) => n.status === "delivered").length;
    const totalFailed = all.filter(
      (n) => n.status === "failed" || n.status === "error"
    ).length;
    const totalDryRun = all.filter((n) => n.status === "dry_run").length;
    const deliveryRate =
      totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;

    const byType: Record<string, number> = {};
    const deliveredByType: Record<string, number> = {};
    const sentByType: Record<string, number> = {};
    for (const n of all) {
      byType[n.notification_type] = (byType[n.notification_type] || 0) + 1;
      if (n.status !== "pending" && n.status !== "dry_run") {
        sentByType[n.notification_type] =
          (sentByType[n.notification_type] || 0) + 1;
        if (n.status === "delivered") {
          deliveredByType[n.notification_type] =
            (deliveredByType[n.notification_type] || 0) + 1;
        }
      }
    }
    const deliveryRateByType: Record<string, number> = {};
    for (const t of Object.keys(sentByType)) {
      const sent = sentByType[t] || 0;
      const delivered = deliveredByType[t] || 0;
      deliveryRateByType[t] =
        sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0;
    }

    const subscriberCount = subs?.length ?? 0;
    const byCategory: Record<string, number> = {};
    for (const row of subs ?? []) {
      const cats = (row.categories ?? {}) as Record<string, boolean>;
      for (const [k, v] of Object.entries(cats)) {
        if (v === true) byCategory[k] = (byCategory[k] || 0) + 1;
      }
    }

    return c.json(
      standardResponse(200, "Notification analytics retrieved", {
        total_sent: totalSent,
        total_delivered: totalDelivered,
        total_failed: totalFailed,
        total_dry_run: totalDryRun,
        delivery_rate: Math.round(deliveryRate * 10) / 10,
        by_type: byType,
        delivery_rate_by_type: deliveryRateByType,
        subscriber_count: subscriberCount,
        subscriber_count_by_category: byCategory,
      })
    );
  } catch (error) {
    logger.error("Error getting notification analytics", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

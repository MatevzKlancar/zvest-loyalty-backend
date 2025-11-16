import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { pushNotificationService } from "../../services/push-notifications";

export const notificationsController = new OpenAPIHono<UnifiedAuthContext>();

// Send manual notification to all customers
const sendBroadcastRoute = createRoute({
  method: "post",
  path: "/notifications/broadcast",
  summary: "Send notification to all customers",
  description: "Send a push notification to all customers of this shop",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            title: z.string().min(1).max(100).describe("Notification title"),
            body: z.string().min(1).max(500).describe("Notification message"),
            data: z
              .record(z.any())
              .optional()
              .describe("Optional custom data payload"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Notification sent successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              sent: z.number(),
              failed: z.number(),
              total: z.number(),
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
    const { title, body, data } = c.req.valid("json");

    logger.info("Broadcasting notification", {
      shopId: shop.id,
      title,
    });

    const result = await pushNotificationService.sendToShopCustomers(shop.id, {
      title,
      body,
      data,
      notificationType: "manual",
    });

    if (!result.success) {
      return c.json(standardResponse(400, result.message || "Failed to send notification"), 400);
    }

    return c.json(
      standardResponse(200, "Notification sent successfully", {
        sent: "sent" in result ? result.sent : 0,
        failed: "failed" in result ? result.failed : 0,
        total: "total" in result ? result.total : 0,
      })
    );
  } catch (error) {
    logger.error("Error broadcasting notification", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Create or update birthday notification template
const setBirthdayNotificationRoute = createRoute({
  method: "post",
  path: "/notifications/birthday-template",
  summary: "Set birthday notification template",
  description:
    "Create or update the birthday notification template for this shop. When active, customers will receive this notification on their birthday.",
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
    const { title, body, data, is_active } = c.req.valid("json");

    // Check if template already exists
    const { data: existing } = await supabase
      .from("notification_templates")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("type", "birthday")
      .single();

    let result;

    if (existing) {
      // Update existing template
      const { data: updated, error } = await supabase
        .from("notification_templates")
        .update({
          title,
          body,
          data: data || {},
          is_active,
          updated_at: new Date().toISOString(),
        })
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
      // Create new template
      const { data: created, error } = await supabase
        .from("notification_templates")
        .insert({
          shop_id: shop.id,
          name: "Birthday Notification",
          type: "birthday",
          title,
          body,
          data: data || {},
          is_active,
        })
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

// Get birthday notification template
const getBirthdayNotificationRoute = createRoute({
  method: "get",
  path: "/notifications/birthday-template",
  summary: "Get birthday notification template",
  description: "Get the current birthday notification template for this shop",
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
      .select("id, title, body, data, is_active")
      .eq("shop_id", shop.id)
      .eq("type", "birthday")
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "not found"
      logger.error("Error fetching birthday template", { error });
      return c.json(
        standardResponse(500, "Failed to fetch birthday notification"),
        500
      );
    }

    return c.json(
      standardResponse(
        200,
        template ? "Template found" : "No template configured",
        template || null
      )
    );
  } catch (error) {
    logger.error("Error getting birthday notification", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get notification history
const getNotificationHistoryRoute = createRoute({
  method: "get",
  path: "/notifications/history",
  summary: "Get notification history",
  description: "Get the history of all push notifications sent by this shop",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      page: z.string().optional().default("1"),
      limit: z.string().optional().default("50"),
      type: z
        .enum(["birthday", "manual", "points_earned", "coupon_ready"])
        .optional(),
      status: z.enum(["pending", "sent", "delivered", "failed", "error"]).optional(),
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
                  created_at: z.string(),
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

    // Build query
    let query = supabase
      .from("push_notifications")
      .select("id, notification_type, title, body, status, sent_at, created_at", {
        count: "exact",
      })
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (type) {
      query = query.eq("notification_type", type);
    }

    if (status) {
      query = query.eq("status", status);
    }

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

// Get notification analytics
const getNotificationAnalyticsRoute = createRoute({
  method: "get",
  path: "/notifications/analytics",
  summary: "Get notification analytics",
  description: "Get analytics about push notifications sent by this shop",
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
              delivery_rate: z.number().describe("Percentage of delivered notifications"),
              by_type: z.record(z.number()),
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

    const { data: notifications, error } = await supabase
      .from("push_notifications")
      .select("notification_type, status")
      .eq("shop_id", shop.id);

    if (error) {
      logger.error("Error fetching notification analytics", { error });
      return c.json(
        standardResponse(500, "Failed to fetch notification analytics"),
        500
      );
    }

    const totalSent =
      notifications?.filter((n) => n.status !== "pending").length || 0;
    const totalDelivered =
      notifications?.filter((n) => n.status === "delivered").length || 0;
    const totalFailed =
      notifications?.filter((n) => n.status === "failed" || n.status === "error")
        .length || 0;

    const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;

    // Count by type
    const byType: Record<string, number> = {};
    notifications?.forEach((n) => {
      byType[n.notification_type] = (byType[n.notification_type] || 0) + 1;
    });

    return c.json(
      standardResponse(200, "Notification analytics retrieved", {
        total_sent: totalSent,
        total_delivered: totalDelivered,
        total_failed: totalFailed,
        delivery_rate: Math.round(deliveryRate * 10) / 10,
        by_type: byType,
      })
    );
  } catch (error) {
    logger.error("Error getting notification analytics", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

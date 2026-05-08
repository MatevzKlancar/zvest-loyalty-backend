import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";

export const notificationPlansController =
  new OpenAPIHono<UnifiedAuthContext>();

const PLAN_CATEGORIES = ["manual", "daily_meal", "specials"] as const;

const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_active: z.boolean(),
  timezone: z.string(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const entrySchema = z.object({
  id: z.string().optional(),
  day_of_week: z.number().int().min(0).max(6),
  send_time_local: z
    .string()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
      "must be HH:MM or HH:MM:SS"
    ),
  notification_type: z.enum(PLAN_CATEGORIES),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  data: z.record(z.any()).optional(),
  is_active: z.boolean().optional().default(true),
});

// =============================================================================
// GET /notifications/plans
// =============================================================================
const listPlansRoute = createRoute({
  method: "get",
  path: "/notifications/plans",
  summary: "List recurring notification plans",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Plans",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({ plans: z.array(planSchema) }),
          }),
        },
      },
    },
  },
});

notificationPlansController.openapi(listPlansRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { data, error } = await supabase
      .from("notification_plans")
      .select("id, name, is_active, timezone, created_at, updated_at")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("Error listing plans", { error });
      return c.json(standardResponse(500, "Failed to list plans"), 500);
    }
    return c.json(standardResponse(200, "Plans", { plans: data ?? [] }));
  } catch (error) {
    logger.error("Error listing plans", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// POST /notifications/plans
// =============================================================================
const createPlanRoute = createRoute({
  method: "post",
  path: "/notifications/plans",
  summary: "Create a notification plan",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(120),
            timezone: z.string().optional(),
            is_active: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: planSchema,
          }),
        },
      },
    },
  },
});

notificationPlansController.openapi(createPlanRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { name, timezone, is_active } = c.req.valid("json");

    const { data, error } = await supabase
      .from("notification_plans")
      .insert({
        shop_id: shop.id,
        name,
        timezone: timezone ?? "Europe/Ljubljana",
        is_active: is_active ?? true,
      })
      .select("id, name, is_active, timezone, created_at, updated_at")
      .single();

    if (error || !data) {
      logger.error("Error creating plan", { error });
      return c.json(standardResponse(500, "Failed to create plan"), 500);
    }
    return c.json(standardResponse(200, "Plan created", data));
  } catch (error) {
    logger.error("Error creating plan", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// PATCH /notifications/plans/{id}
// =============================================================================
const updatePlanRoute = createRoute({
  method: "patch",
  path: "/notifications/plans/{id}",
  summary: "Update a notification plan",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(120).optional(),
            timezone: z.string().optional(),
            is_active: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: planSchema,
          }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), message: z.string() }),
        },
      },
    },
  },
});

notificationPlansController.openapi(updatePlanRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");

    const { data, error } = await supabase
      .from("notification_plans")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("shop_id", shop.id)
      .select("id, name, is_active, timezone, created_at, updated_at")
      .single();

    if (error || !data) {
      return c.json(standardResponse(404, "Plan not found"), 404);
    }
    return c.json(standardResponse(200, "Plan updated", data));
  } catch (error) {
    logger.error("Error updating plan", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// DELETE /notifications/plans/{id}
// =============================================================================
const deletePlanRoute = createRoute({
  method: "delete",
  path: "/notifications/plans/{id}",
  summary: "Delete a notification plan",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Deleted",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), message: z.string() }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), message: z.string() }),
        },
      },
    },
  },
});

notificationPlansController.openapi(deletePlanRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { id } = c.req.valid("param");

    const { data, error } = await supabase
      .from("notification_plans")
      .delete()
      .eq("id", id)
      .eq("shop_id", shop.id)
      .select("id")
      .single();

    if (error || !data) {
      return c.json(standardResponse(404, "Plan not found"), 404);
    }
    return c.json(standardResponse(200, "Plan deleted"));
  } catch (error) {
    logger.error("Error deleting plan", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// GET /notifications/plans/{id}/entries
// =============================================================================
const listEntriesRoute = createRoute({
  method: "get",
  path: "/notifications/plans/{id}/entries",
  summary: "List entries (Mon–Sun) for a plan",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Entries",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              entries: z.array(
                z.object({
                  id: z.string(),
                  day_of_week: z.number(),
                  send_time_local: z.string(),
                  notification_type: z.string(),
                  title: z.string(),
                  body: z.string(),
                  data: z.record(z.any()),
                  is_active: z.boolean(),
                })
              ),
            }),
          }),
        },
      },
    },
    404: {
      description: "Plan not found",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), message: z.string() }),
        },
      },
    },
  },
});

notificationPlansController.openapi(listEntriesRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { id } = c.req.valid("param");

    // Verify ownership before exposing entries.
    const { data: plan } = await supabase
      .from("notification_plans")
      .select("id")
      .eq("id", id)
      .eq("shop_id", shop.id)
      .single();
    if (!plan) {
      return c.json(standardResponse(404, "Plan not found"), 404);
    }

    const { data, error } = await supabase
      .from("notification_plan_entries")
      .select(
        "id, day_of_week, send_time_local, notification_type, title, body, data, is_active"
      )
      .eq("plan_id", id)
      .order("day_of_week", { ascending: true });

    if (error) {
      logger.error("Error listing entries", { error });
      return c.json(standardResponse(500, "Failed to list entries"), 500);
    }
    return c.json(standardResponse(200, "Entries", { entries: data ?? [] }));
  } catch (error) {
    logger.error("Error listing entries", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// =============================================================================
// PUT /notifications/plans/{id}/entries — bulk replace the week
// =============================================================================
const replaceEntriesRoute = createRoute({
  method: "put",
  path: "/notifications/plans/{id}/entries",
  summary: "Bulk-replace all entries for a plan",
  description:
    "Replaces the full set of day-of-week entries in one call. The dashboard saves the whole week as a unit; this avoids per-cell PATCHes.",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            entries: z.array(entrySchema).max(7),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Entries saved",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({ count: z.number() }),
          }),
        },
      },
    },
    404: {
      description: "Plan not found",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), message: z.string() }),
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), message: z.string() }),
        },
      },
    },
  },
});

notificationPlansController.openapi(replaceEntriesRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { id } = c.req.valid("param");
    const { entries } = c.req.valid("json");

    // Reject duplicate day_of_week up front (DB has a UNIQUE but error surface is friendlier here).
    const seen = new Set<number>();
    for (const e of entries) {
      if (seen.has(e.day_of_week)) {
        return c.json(
          standardResponse(
            400,
            `Duplicate day_of_week ${e.day_of_week}. Each day can have at most one entry per plan.`
          ),
          400
        );
      }
      seen.add(e.day_of_week);
    }

    const { data: plan } = await supabase
      .from("notification_plans")
      .select("id")
      .eq("id", id)
      .eq("shop_id", shop.id)
      .single();
    if (!plan) {
      return c.json(standardResponse(404, "Plan not found"), 404);
    }

    // Wipe + insert. There's no DB-level transaction available on the JS client,
    // but a partial failure leaves entries=0 which the dashboard can re-save against.
    const { error: deleteErr } = await supabase
      .from("notification_plan_entries")
      .delete()
      .eq("plan_id", id);
    if (deleteErr) {
      logger.error("Error wiping entries", { error: deleteErr });
      return c.json(standardResponse(500, "Failed to save entries"), 500);
    }

    if (entries.length === 0) {
      return c.json(
        standardResponse(200, "Entries cleared", { count: 0 })
      );
    }

    const rows = entries.map((e) => ({
      plan_id: id,
      day_of_week: e.day_of_week,
      send_time_local: e.send_time_local,
      notification_type: e.notification_type,
      title: e.title,
      body: e.body,
      data: e.data ?? {},
      is_active: e.is_active ?? true,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("notification_plan_entries")
      .insert(rows)
      .select("id");

    if (insertErr) {
      logger.error("Error inserting entries", { error: insertErr });
      return c.json(standardResponse(500, "Failed to save entries"), 500);
    }

    return c.json(
      standardResponse(200, "Entries saved", {
        count: inserted?.length ?? 0,
      })
    );
  } catch (error) {
    logger.error("Error replacing entries", { error });
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

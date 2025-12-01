import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import {
  importQRCodesSchema,
  articleQRCodeResponseSchema,
  importQRCodesResultSchema,
} from "./schemas";
import { hasFeature, FEATURE_TAGS } from "../../utils/features";

export const articleQRCodesController = new OpenAPIHono<UnifiedAuthContext>();

// Import QR codes for an article
const importQRCodesRoute = createRoute({
  method: "post",
  path: "/articles/{article_id}/qr-codes/import",
  summary: "Import external QR codes for an article",
  description:
    "Bulk import external QR codes (e.g., ski tickets) and link them to a specific article. One-time use codes that work like coupons at POS.",
  tags: ["Article QR Codes"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      article_id: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: importQRCodesSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "QR codes import completed with results",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: importQRCodesResultSchema,
          }),
        },
      },
    },
  },
});

articleQRCodesController.openapi(importQRCodesRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { article_id } = c.req.valid("param");
    const { qr_codes } = c.req.valid("json");

    // Check if shop has the feature enabled
    const { data: shopData, error: shopError } = await supabase
      .from("shops")
      .select("feature_tags")
      .eq("id", shop.id)
      .single();

    if (shopError || !shopData) {
      logger.error("Failed to fetch shop data:", shopError);
      return c.json(
        standardResponse(500, "Failed to verify shop settings"),
        500
      );
    }

    if (!hasFeature(shopData, FEATURE_TAGS.EXTERNAL_QR_CODES)) {
      return c.json(
        standardResponse(
          403,
          "External QR code feature is not enabled for your shop. Please contact support."
        ),
        403
      );
    }

    // Verify article exists and belongs to this shop
    const { data: article, error: articleError } = await supabase
      .from("articles")
      .select("id, name")
      .eq("id", article_id)
      .eq("shop_id", shop.id)
      .single();

    if (articleError || !article) {
      return c.json(
        standardResponse(
          404,
          `Article not found or does not belong to this shop`
        ),
        404
      );
    }

    // Check for existing QR codes in the system (duplicates)
    const { data: existingCodes, error: checkError } = await supabase
      .from("article_qr_codes")
      .select("qr_code")
      .in("qr_code", qr_codes);

    if (checkError) {
      logger.error("Failed to check for duplicate QR codes:", checkError);
      return c.json(
        standardResponse(500, "Failed to validate QR codes"),
        500
      );
    }

    const existingQRSet = new Set(
      existingCodes?.map((c) => c.qr_code) || []
    );
    const duplicates: string[] = [];
    const toImport: string[] = [];

    // Separate duplicates from new codes
    for (const code of qr_codes) {
      if (existingQRSet.has(code)) {
        duplicates.push(code);
      } else {
        toImport.push(code);
      }
    }

    let imported_count = 0;
    const errors: Array<{ qr_code: string; error: string }> = [];

    // Import new codes
    if (toImport.length > 0) {
      const recordsToInsert = toImport.map((code) => ({
        shop_id: shop.id,
        article_id: article_id,
        qr_code: code,
        status: "active" as const,
      }));

      const { data: insertedCodes, error: insertError } = await supabase
        .from("article_qr_codes")
        .insert(recordsToInsert)
        .select();

      if (insertError) {
        logger.error("Failed to insert QR codes:", insertError);
        // Try to insert one by one to identify problematic codes
        for (const code of toImport) {
          const { error: singleError } = await supabase
            .from("article_qr_codes")
            .insert({
              shop_id: shop.id,
              article_id: article_id,
              qr_code: code,
              status: "active" as const,
            });

          if (singleError) {
            errors.push({
              qr_code: code,
              error: singleError.message,
            });
          } else {
            imported_count++;
          }
        }
      } else {
        imported_count = insertedCodes?.length || 0;
      }
    }

    const result = {
      success: imported_count > 0 || duplicates.length > 0,
      imported_count,
      duplicate_count: duplicates.length,
      error_count: errors.length,
      ...(duplicates.length > 0 && { duplicates }),
      ...(errors.length > 0 && { errors }),
    };

    logger.info(
      `QR codes import completed for article ${article_id}: ${imported_count} imported, ${duplicates.length} duplicates, ${errors.length} errors`
    );

    return c.json(
      standardResponse(
        200,
        `Import completed: ${imported_count} codes imported${duplicates.length > 0 ? `, ${duplicates.length} duplicates skipped` : ""}${errors.length > 0 ? `, ${errors.length} failed` : ""}`,
        result
      ),
      200
    );
  } catch (error) {
    logger.error("Error importing QR codes:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get QR codes for an article
const getArticleQRCodesRoute = createRoute({
  method: "get",
  path: "/articles/{article_id}/qr-codes",
  summary: "Get QR codes for an article",
  description: "Retrieve all QR codes linked to a specific article",
  tags: ["Article QR Codes"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      article_id: z.string().uuid(),
    }),
    query: z.object({
      status: z.enum(["active", "used", "all"]).optional().default("all"),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "QR codes retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(articleQRCodeResponseSchema),
            meta: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          }),
        },
      },
    },
  },
});

articleQRCodesController.openapi(getArticleQRCodesRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { article_id } = c.req.valid("param");
    const query = c.req.valid("query");

    const limit = parseInt(query.limit || "50");
    const offset = parseInt(query.offset || "0");
    const status = query.status || "all";

    // Verify article belongs to this shop
    const { data: article, error: articleError } = await supabase
      .from("articles")
      .select("id")
      .eq("id", article_id)
      .eq("shop_id", shop.id)
      .single();

    if (articleError || !article) {
      return c.json(
        standardResponse(
          404,
          `Article not found or does not belong to this shop`
        ),
        404
      );
    }

    // Build query
    let dbQuery = supabase
      .from("article_qr_codes")
      .select("*", { count: "exact" })
      .eq("article_id", article_id)
      .order("created_at", { ascending: false });

    // Apply status filter if not "all"
    if (status !== "all") {
      dbQuery = dbQuery.eq("status", status);
    }

    // Apply pagination
    dbQuery = dbQuery.range(offset, offset + limit - 1);

    const { data: qrCodes, error, count } = await dbQuery;

    if (error) {
      logger.error("Failed to fetch QR codes:", error);
      return c.json(
        standardResponse(500, `Failed to fetch QR codes: ${error.message}`),
        500
      );
    }

    return c.json({
      success: true,
      message: "QR codes retrieved successfully",
      data: qrCodes,
      meta: {
        total: count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error("Error fetching QR codes:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Delete a QR code (only if not used)
const deleteQRCodeRoute = createRoute({
  method: "delete",
  path: "/qr-codes/{qr_code_id}",
  summary: "Delete an unused QR code",
  description: "Delete a QR code that has not been used yet",
  tags: ["Article QR Codes"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      qr_code_id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "QR code deleted successfully",
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

articleQRCodesController.openapi(deleteQRCodeRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { qr_code_id } = c.req.valid("param");

    // Verify QR code belongs to this shop and check status
    const { data: qrCode, error: fetchError } = await supabase
      .from("article_qr_codes")
      .select("id, status")
      .eq("id", qr_code_id)
      .eq("shop_id", shop.id)
      .single();

    if (fetchError || !qrCode) {
      return c.json(
        standardResponse(
          404,
          `QR code not found or does not belong to this shop`
        ),
        404
      );
    }

    if (qrCode.status === "used") {
      return c.json(
        standardResponse(400, "Cannot delete a QR code that has been used"),
        400
      );
    }

    // Delete the QR code
    const { error: deleteError } = await supabase
      .from("article_qr_codes")
      .delete()
      .eq("id", qr_code_id);

    if (deleteError) {
      logger.error("Failed to delete QR code:", deleteError);
      return c.json(
        standardResponse(500, `Failed to delete QR code: ${deleteError.message}`),
        500
      );
    }

    logger.info(`QR code deleted successfully: ${qr_code_id}`);
    return c.json(
      standardResponse(200, "QR code deleted successfully"),
      200
    );
  } catch (error) {
    logger.error("Error deleting QR code:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

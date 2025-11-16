import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { customerResponseSchema } from "./schemas";

export const customersController = new OpenAPIHono<UnifiedAuthContext>();

// Get top customers
const getTopCustomersRoute = createRoute({
  method: "get",
  path: "/customers/top",
  summary: "Get top customers",
  description: "Get top customers by various metrics for VIP treatment and targeted marketing",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      sort_by: z.string().optional().describe("Sort by: total_spent, visit_count, points_balance"),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Top customers retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(customerResponseSchema),
          }),
        },
      },
    },
  },
});

customersController.openapi(getTopCustomersRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { sort_by = "total_spent", limit = "20" } = c.req.valid("query");

    // Get customer loyalty accounts with user details
    const { data: loyaltyAccounts, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select(`
        id,
        app_user_id,
        points_balance,
        total_spent,
        last_visit_at,
        created_at,
        invoice_count,
        app_users (
          id,
          first_name,
          last_name,
          phone_number,
          email
        )
      `)
      .eq("shop_id", shop.id)
      .eq("is_active", true);

    if (loyaltyError) {
      logger.error("Failed to fetch top customers:", loyaltyError);
      return c.json(standardResponse(500, "Failed to fetch top customers"), 500);
    }

    const now = new Date();
    const customers = loyaltyAccounts?.map((account, index) => {
      const daysSinceLastVisit = account.last_visit_at
        ? Math.floor((now.getTime() - new Date(account.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        customer_id: account.app_user_id,
        first_name: account.app_users?.first_name || null,
        last_name: account.app_users?.last_name || null,
        phone_number: account.app_users?.phone_number || null,
        email: account.app_users?.email || null,
        total_spent: Number(account.total_spent || 0),
        visit_count: account.invoice_count || 0,
        points_balance: account.points_balance || 0,
        avg_transaction: account.invoice_count > 0
          ? Number(account.total_spent || 0) / account.invoice_count
          : 0,
        last_visit_at: account.last_visit_at,
        customer_since: account.created_at,
        days_since_last_visit: daysSinceLastVisit,
        customer_rank: 0, // Will be set after sorting
        percentile: 0, // Will be set after sorting
      };
    }) || [];

    // Sort based on selected metric
    const sortedCustomers = [...customers].sort((a, b) => {
      switch (sort_by) {
        case "visit_count":
          return b.visit_count - a.visit_count;
        case "points_balance":
          return b.points_balance - a.points_balance;
        default: // total_spent
          return b.total_spent - a.total_spent;
      }
    });

    // Add rank and percentile
    const totalCustomers = sortedCustomers.length;
    const topCustomers = sortedCustomers
      .slice(0, parseInt(limit))
      .map((customer, index) => ({
        ...customer,
        customer_rank: index + 1,
        percentile: totalCustomers > 0
          ? Math.round(((totalCustomers - index) / totalCustomers) * 100)
          : 100,
        avg_transaction: Math.round(customer.avg_transaction * 100) / 100,
        total_spent: Math.round(customer.total_spent * 100) / 100,
      }));

    return c.json(
      standardResponse(200, "Top customers retrieved successfully", topCustomers)
    );
  } catch (error) {
    logger.error("Error fetching top customers:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get customer segments
const getCustomerSegmentsRoute = createRoute({
  method: "get",
  path: "/customers/segments",
  summary: "Get customer segments",
  description: "Get detailed customer segmentation for targeted marketing and engagement",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Customer segments retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              vip_customers: z.array(z.object({
                customer_id: z.string(),
                name: z.string().nullable(),
                phone: z.string().nullable(),
                total_spent: z.number(),
                visit_count: z.number(),
                last_visit: z.string().nullable(),
              })),
              at_risk_customers: z.array(z.object({
                customer_id: z.string(),
                name: z.string().nullable(),
                phone: z.string().nullable(),
                days_since_visit: z.number(),
                total_spent: z.number(),
                avg_transaction: z.number(),
              })),
              new_customers: z.array(z.object({
                customer_id: z.string(),
                name: z.string().nullable(),
                phone: z.string().nullable(),
                first_visit: z.string(),
                total_spent: z.number(),
              })),
              loyal_customers: z.array(z.object({
                customer_id: z.string(),
                name: z.string().nullable(),
                phone: z.string().nullable(),
                visit_count: z.number(),
                loyalty_score: z.number(),
              })),
            }),
          }),
        },
      },
    },
  },
});

customersController.openapi(getCustomerSegmentsRoute, async (c) => {
  try {
    const shop = c.get("shop");

    // Get all customer loyalty accounts with user details
    const { data: loyaltyAccounts, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select(`
        id,
        app_user_id,
        points_balance,
        total_spent,
        last_visit_at,
        created_at,
        invoice_count,
        app_users (
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq("shop_id", shop.id)
      .eq("is_active", true);

    if (loyaltyError) {
      logger.error("Failed to fetch customer segments:", loyaltyError);
      return c.json(standardResponse(500, "Failed to fetch customer segments"), 500);
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Sort customers by total spent to identify VIPs (top 20%)
    const sortedBySpend = [...(loyaltyAccounts || [])].sort(
      (a, b) => (b.total_spent || 0) - (a.total_spent || 0)
    );
    const vipThreshold = Math.ceil(sortedBySpend.length * 0.2);

    // VIP Customers (top 20% by spending)
    const vipCustomers = sortedBySpend.slice(0, vipThreshold).map(account => ({
      customer_id: account.app_user_id,
      name: [account.app_users?.first_name, account.app_users?.last_name]
        .filter(Boolean).join(" ") || null,
      phone: account.app_users?.phone_number || null,
      total_spent: Math.round((account.total_spent || 0) * 100) / 100,
      visit_count: account.invoice_count || 0,
      last_visit: account.last_visit_at,
    }));

    // At-risk customers (30-60 days since last visit)
    const atRiskCustomers = (loyaltyAccounts || [])
      .filter(account => {
        if (!account.last_visit_at) return false;
        const lastVisit = new Date(account.last_visit_at);
        return lastVisit >= sixtyDaysAgo && lastVisit < thirtyDaysAgo;
      })
      .map(account => {
        const daysSinceVisit = account.last_visit_at
          ? Math.floor((now.getTime() - new Date(account.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          customer_id: account.app_user_id,
          name: [account.app_users?.first_name, account.app_users?.last_name]
            .filter(Boolean).join(" ") || null,
          phone: account.app_users?.phone_number || null,
          days_since_visit: daysSinceVisit,
          total_spent: Math.round((account.total_spent || 0) * 100) / 100,
          avg_transaction: account.invoice_count > 0
            ? Math.round(((account.total_spent || 0) / account.invoice_count) * 100) / 100
            : 0,
        };
      })
      .slice(0, 10);

    // New customers (joined in last 7 days)
    const newCustomers = (loyaltyAccounts || [])
      .filter(account => new Date(account.created_at) >= sevenDaysAgo)
      .map(account => ({
        customer_id: account.app_user_id,
        name: [account.app_users?.first_name, account.app_users?.last_name]
          .filter(Boolean).join(" ") || null,
        phone: account.app_users?.phone_number || null,
        first_visit: account.created_at,
        total_spent: Math.round((account.total_spent || 0) * 100) / 100,
      }))
      .slice(0, 10);

    // Loyal customers (high visit frequency, not VIP)
    const loyalCustomers = sortedBySpend
      .slice(vipThreshold) // Exclude VIPs
      .filter(account => (account.invoice_count || 0) >= 5) // At least 5 visits
      .map(account => {
        // Simple loyalty score: combination of visits and recency
        const recencyScore = account.last_visit_at
          ? Math.max(0, 100 - Math.floor((now.getTime() - new Date(account.last_visit_at).getTime()) / (1000 * 60 * 60 * 24)))
          : 0;
        const frequencyScore = Math.min(100, (account.invoice_count || 0) * 10);
        const loyaltyScore = Math.round((recencyScore + frequencyScore) / 2);

        return {
          customer_id: account.app_user_id,
          name: [account.app_users?.first_name, account.app_users?.last_name]
            .filter(Boolean).join(" ") || null,
          phone: account.app_users?.phone_number || null,
          visit_count: account.invoice_count || 0,
          loyalty_score: loyaltyScore,
        };
      })
      .sort((a, b) => b.loyalty_score - a.loyalty_score)
      .slice(0, 10);

    const segments = {
      vip_customers: vipCustomers.slice(0, 10),
      at_risk_customers: atRiskCustomers,
      new_customers: newCustomers,
      loyal_customers: loyalCustomers,
    };

    return c.json(
      standardResponse(200, "Customer segments retrieved successfully", segments)
    );
  } catch (error) {
    logger.error("Error fetching customer segments:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
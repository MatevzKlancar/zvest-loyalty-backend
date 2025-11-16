import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { analyticsResponseSchema } from "./schemas";

export const analyticsController = new OpenAPIHono<UnifiedAuthContext>();

// Get shop analytics (simple version with TypeScript logic)
const getAnalyticsRoute = createRoute({
  method: "get",
  path: "/analytics",
  summary: "Get shop analytics",
  description:
    "Get comprehensive analytics for the shop including transactions, revenue, and customer data",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Analytics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: analyticsResponseSchema,
          }),
        },
      },
    },
  },
});

analyticsController.openapi(getAnalyticsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get ALL transactions (not just completed)
    const { data: allTransactions, error: transError } = await supabase
      .from("transactions")
      .select("id, total_amount, created_at, app_user_id, status")
      .eq("shop_id", shop.id)
      .neq("status", "cancelled"); // Exclude cancelled transactions

    if (transError) {
      logger.error("Failed to fetch transactions:", transError);
      return c.json(standardResponse(500, "Failed to fetch analytics"), 500);
    }

    // Filter completed/scanned transactions separately
    const scannedTransactions = allTransactions?.filter(
      (t) => t.status === "completed"
    ) || [];

    // Get coupons data
    const { data: coupons, error: couponError } = await supabase
      .from("coupons")
      .select("id, is_active")
      .eq("shop_id", shop.id);

    if (couponError) {
      logger.error("Failed to fetch coupons:", couponError);
      return c.json(standardResponse(500, "Failed to fetch analytics"), 500);
    }

    // Get coupon redemptions
    const { data: redemptions, error: redemptionError } = await supabase
      .from("coupon_redemptions")
      .select("id, redeemed_at")
      .in("coupon_id", coupons?.map((c) => c.id) || []);

    if (redemptionError) {
      logger.error("Failed to fetch redemptions:", redemptionError);
    }

    // Calculate analytics for ALL transactions (pending + completed)
    const totalTransactions = allTransactions?.length || 0;
    const last30DaysTransactions =
      allTransactions?.filter((t) => new Date(t.created_at) >= thirtyDaysAgo)
        .length || 0;
    const last7DaysTransactions =
      allTransactions?.filter((t) => new Date(t.created_at) >= sevenDaysAgo)
        .length || 0;

    const totalRevenue =
      allTransactions?.reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;
    const last30DaysRevenue =
      allTransactions
        ?.filter((t) => new Date(t.created_at) >= thirtyDaysAgo)
        .reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;
    const last7DaysRevenue =
      allTransactions
        ?.filter((t) => new Date(t.created_at) >= sevenDaysAgo)
        .reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;

    const avgTransactionAmount =
      totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Calculate analytics for SCANNED transactions only (completed)
    const scannedTotal = scannedTransactions.length;
    const scanned30Days = scannedTransactions.filter(
      (t) => new Date(t.created_at) >= thirtyDaysAgo
    ).length;
    const scanned7Days = scannedTransactions.filter(
      (t) => new Date(t.created_at) >= sevenDaysAgo
    ).length;

    const scannedRevenue =
      scannedTransactions.reduce((sum, t) => sum + Number(t.total_amount), 0);
    const scannedRevenue30Days = scannedTransactions
      .filter((t) => new Date(t.created_at) >= thirtyDaysAgo)
      .reduce((sum, t) => sum + Number(t.total_amount), 0);
    const scannedRevenue7Days = scannedTransactions
      .filter((t) => new Date(t.created_at) >= sevenDaysAgo)
      .reduce((sum, t) => sum + Number(t.total_amount), 0);

    const uniqueCustomers = new Set(
      allTransactions?.map((t) => t.app_user_id).filter(Boolean)
    ).size;

    const totalCoupons = coupons?.length || 0;
    const activeCoupons = coupons?.filter((c) => c.is_active).length || 0;
    const totalCouponRedemptions = redemptions?.length || 0;

    const analytics = {
      shop_id: shop.id,
      shop_name: shop.name,
      // All transactions (pending + completed, excluding cancelled)
      total_transactions: totalTransactions,
      transactions_last_30_days: last30DaysTransactions,
      transactions_last_7_days: last7DaysTransactions,
      total_revenue: totalRevenue,
      revenue_last_30_days: last30DaysRevenue,
      revenue_last_7_days: last7DaysRevenue,
      avg_transaction_amount: avgTransactionAmount,
      // Scanned/completed transactions only
      scanned_transactions: scannedTotal,
      scanned_transactions_last_30_days: scanned30Days,
      scanned_transactions_last_7_days: scanned7Days,
      scanned_revenue: scannedRevenue,
      scanned_revenue_last_30_days: scannedRevenue30Days,
      scanned_revenue_last_7_days: scannedRevenue7Days,
      // Other metrics
      unique_customers: uniqueCustomers,
      total_coupons: totalCoupons,
      active_coupons: activeCoupons,
      total_coupon_redemptions: totalCouponRedemptions,
    };

    return c.json(
      standardResponse(200, "Analytics retrieved successfully", analytics)
    );
  } catch (error) {
    logger.error("Error fetching analytics:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get customer analytics
const getCustomerAnalyticsRoute = createRoute({
  method: "get",
  path: "/analytics/customers",
  summary: "Get customer analytics",
  description: "Get detailed customer behavior analytics including retention, lifetime value, and purchasing patterns",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      period: z.string().optional().describe("Time period: 7d, 30d, 90d, all"),
    }),
  },
  responses: {
    200: {
      description: "Customer analytics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              summary: z.object({
                total_customers: z.number(),
                new_customers: z.number(),
                returning_customers: z.number(),
                retention_rate: z.number(),
                avg_lifetime_value: z.number(),
                avg_purchases_per_customer: z.number(),
                avg_time_between_purchases_days: z.number(),
              }),
              segments: z.object({
                vip_customers: z.number().describe("Customers in top 20% by spend"),
                regular_customers: z.number(),
                at_risk_customers: z.number().describe("Haven't purchased in 30+ days"),
                lost_customers: z.number().describe("No purchase in 60+ days"),
              }),
              purchase_frequency: z.object({
                daily_active: z.number(),
                weekly_active: z.number(),
                monthly_active: z.number(),
              }),
            }),
          }),
        },
      },
    },
  },
});

analyticsController.openapi(getCustomerAnalyticsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { period = "30d" } = c.req.valid("query");

    // Parse period
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 9999;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all customer loyalty accounts for this shop
    const { data: loyaltyAccounts, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select(`
        id,
        app_user_id,
        points_balance,
        total_spent,
        last_visit_at,
        created_at,
        invoice_count
      `)
      .eq("shop_id", shop.id);

    if (loyaltyError) {
      logger.error("Failed to fetch loyalty accounts:", loyaltyError);
      return c.json(standardResponse(500, "Failed to fetch customer analytics"), 500);
    }

    // Get transactions for the period
    const { data: transactions, error: transError } = await supabase
      .from("transactions")
      .select("id, app_user_id, total_amount, created_at, status")
      .eq("shop_id", shop.id)
      .neq("status", "cancelled")
      .gte("created_at", startDate.toISOString());

    if (transError) {
      logger.error("Failed to fetch transactions:", transError);
      return c.json(standardResponse(500, "Failed to fetch customer analytics"), 500);
    }

    // Calculate analytics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalCustomers = loyaltyAccounts?.length || 0;

    // New customers (created in period)
    const newCustomers = loyaltyAccounts?.filter(
      acc => new Date(acc.created_at) >= startDate
    ).length || 0;

    const returningCustomers = totalCustomers - newCustomers;

    // Customer segments
    const sortedBySpend = [...(loyaltyAccounts || [])].sort(
      (a, b) => (b.total_spent || 0) - (a.total_spent || 0)
    );
    const vipThreshold = Math.ceil(totalCustomers * 0.2); // Top 20%
    const vipCustomers = sortedBySpend.slice(0, vipThreshold).length;

    const atRiskCustomers = loyaltyAccounts?.filter(acc => {
      if (!acc.last_visit_at) return false;
      const lastVisit = new Date(acc.last_visit_at);
      return lastVisit < thirtyDaysAgo && lastVisit >= sixtyDaysAgo;
    }).length || 0;

    const lostCustomers = loyaltyAccounts?.filter(acc => {
      if (!acc.last_visit_at) return true;
      return new Date(acc.last_visit_at) < sixtyDaysAgo;
    }).length || 0;

    const regularCustomers = totalCustomers - vipCustomers - atRiskCustomers - lostCustomers;

    // Purchase frequency
    const uniqueCustomersLastDay = new Set(
      transactions?.filter(t => new Date(t.created_at) >= new Date(now.getTime() - 24 * 60 * 60 * 1000))
        .map(t => t.app_user_id).filter(Boolean)
    ).size;

    const uniqueCustomersLastWeek = new Set(
      transactions?.filter(t => new Date(t.created_at) >= sevenDaysAgo)
        .map(t => t.app_user_id).filter(Boolean)
    ).size;

    const uniqueCustomersLastMonth = new Set(
      transactions?.filter(t => new Date(t.created_at) >= thirtyDaysAgo)
        .map(t => t.app_user_id).filter(Boolean)
    ).size;

    // Calculate averages
    const avgLifetimeValue = totalCustomers > 0
      ? (loyaltyAccounts?.reduce((sum, acc) => sum + (acc.total_spent || 0), 0) || 0) / totalCustomers
      : 0;

    const totalPurchases = loyaltyAccounts?.reduce((sum, acc) => sum + (acc.invoice_count || 0), 0) || 0;
    const avgPurchasesPerCustomer = totalCustomers > 0 ? totalPurchases / totalCustomers : 0;

    // Calculate average time between purchases (for customers with 2+ purchases)
    const customersWithMultiplePurchases = loyaltyAccounts?.filter(acc => (acc.invoice_count || 0) > 1) || [];
    let avgTimeBetweenPurchases = 0;

    if (customersWithMultiplePurchases.length > 0) {
      const timeDiffs = customersWithMultiplePurchases.map(acc => {
        const accountAge = new Date().getTime() - new Date(acc.created_at).getTime();
        const daysSinceCreation = accountAge / (1000 * 60 * 60 * 24);
        return daysSinceCreation / Math.max((acc.invoice_count || 1) - 1, 1);
      });
      avgTimeBetweenPurchases = timeDiffs.reduce((sum, diff) => sum + diff, 0) / timeDiffs.length;
    }

    const retentionRate = totalCustomers > 0
      ? ((totalCustomers - lostCustomers) / totalCustomers) * 100
      : 0;

    const analytics = {
      summary: {
        total_customers: totalCustomers,
        new_customers: newCustomers,
        returning_customers: returningCustomers,
        retention_rate: Math.round(retentionRate * 10) / 10,
        avg_lifetime_value: Math.round(avgLifetimeValue * 100) / 100,
        avg_purchases_per_customer: Math.round(avgPurchasesPerCustomer * 10) / 10,
        avg_time_between_purchases_days: Math.round(avgTimeBetweenPurchases),
      },
      segments: {
        vip_customers: vipCustomers,
        regular_customers: regularCustomers,
        at_risk_customers: atRiskCustomers,
        lost_customers: lostCustomers,
      },
      purchase_frequency: {
        daily_active: uniqueCustomersLastDay,
        weekly_active: uniqueCustomersLastWeek,
        monthly_active: uniqueCustomersLastMonth,
      },
    };

    return c.json(
      standardResponse(200, "Customer analytics retrieved successfully", analytics)
    );
  } catch (error) {
    logger.error("Error fetching customer analytics:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
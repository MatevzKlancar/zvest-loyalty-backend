import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { dashboardWidgetSchema } from "./schemas";

export const dashboardController = new OpenAPIHono<UnifiedAuthContext>();

// Dashboard widgets API
const getDashboardWidgetsRoute = createRoute({
  method: "get",
  path: "/dashboard/widgets",
  summary: "Get dashboard widgets data",
  description: "Get all dashboard widget data for the shop owner's dashboard",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Dashboard widgets data retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: dashboardWidgetSchema,
          }),
        },
      },
    },
  },
});

dashboardController.openapi(getDashboardWidgetsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get today's transactions
    const { data: todayTransactions, error: todayError } = await supabase
      .from("transactions")
      .select("id, total_amount, app_user_id, status, loyalty_points_awarded")
      .eq("shop_id", shop.id)
      .gte("created_at", todayStart.toISOString())
      .neq("status", "cancelled");

    if (todayError) {
      logger.error("Failed to fetch today's transactions:", todayError);
    }

    // Get yesterday's transactions
    const { data: yesterdayTransactions, error: yesterdayError } = await supabase
      .from("transactions")
      .select("total_amount")
      .eq("shop_id", shop.id)
      .gte("created_at", yesterdayStart.toISOString())
      .lt("created_at", todayStart.toISOString())
      .neq("status", "cancelled");

    if (yesterdayError) {
      logger.error("Failed to fetch yesterday's transactions:", yesterdayError);
    }

    // Get last 30 days transactions for average
    const { data: last30DaysTransactions, error: last30Error } = await supabase
      .from("transactions")
      .select("total_amount, created_at")
      .eq("shop_id", shop.id)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .neq("status", "cancelled");

    if (last30Error) {
      logger.error("Failed to fetch last 30 days transactions:", last30Error);
    }

    // Get month's transactions
    const { data: monthTransactions, error: monthError } = await supabase
      .from("transactions")
      .select("total_amount")
      .eq("shop_id", shop.id)
      .gte("created_at", monthStart.toISOString())
      .neq("status", "cancelled");

    if (monthError) {
      logger.error("Failed to fetch month's transactions:", monthError);
    }

    // Calculate revenue metrics
    const todayRevenue = todayTransactions?.reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;
    const yesterdayRevenue = yesterdayTransactions?.reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;

    // Calculate daily average (excluding today)
    const dailyRevenues: Record<string, number> = {};
    last30DaysTransactions?.forEach(t => {
      const date = new Date(t.created_at).toDateString();
      if (date !== todayStart.toDateString()) {
        dailyRevenues[date] = (dailyRevenues[date] || 0) + Number(t.total_amount);
      }
    });
    const avgDailyRevenue = Object.values(dailyRevenues).length > 0
      ? Object.values(dailyRevenues).reduce((sum, r) => sum + r, 0) / Object.values(dailyRevenues).length
      : 0;

    const vsYesterday = yesterdayRevenue > 0
      ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
      : 0;
    const vsAverage = avgDailyRevenue > 0
      ? ((todayRevenue - avgDailyRevenue) / avgDailyRevenue) * 100
      : 0;

    // Active customers today
    const uniqueCustomersToday = new Set(
      todayTransactions?.map(t => t.app_user_id).filter(Boolean)
    ).size;

    // Get new vs returning customers today
    const { data: newCustomersToday, error: newCustomersError } = await supabase
      .from("customer_loyalty_accounts")
      .select("app_user_id")
      .eq("shop_id", shop.id)
      .gte("created_at", todayStart.toISOString());

    if (newCustomersError) {
      logger.error("Failed to fetch new customers:", newCustomersError);
    }

    const newCustomerCount = newCustomersToday?.length || 0;
    const returningCustomerCount = Math.max(0, uniqueCustomersToday - newCustomerCount);

    // Get today's coupon redemptions
    const { data: coupons, error: couponsError } = await supabase
      .from("coupons")
      .select("id, name")
      .eq("shop_id", shop.id)
      .eq("is_active", true);

    if (couponsError) {
      logger.error("Failed to fetch coupons:", couponsError);
    }

    const { data: todayRedemptions, error: redemptionsError } = await supabase
      .from("coupon_redemptions")
      .select("coupon_id")
      .in("coupon_id", coupons?.map(c => c.id) || [])
      .gte("redeemed_at", todayStart.toISOString())
      .eq("status", "used");

    if (redemptionsError) {
      logger.error("Failed to fetch today's redemptions:", redemptionsError);
    }

    // Count redemptions by coupon
    const redemptionCounts: Record<string, number> = {};
    todayRedemptions?.forEach(r => {
      redemptionCounts[r.coupon_id] = (redemptionCounts[r.coupon_id] || 0) + 1;
    });

    // Get total redemptions for popular coupons
    const popularCouponIds = Object.keys(redemptionCounts).slice(0, 3);
    const { data: totalRedemptions, error: totalRedemptionsError } = await supabase
      .from("coupon_redemptions")
      .select("coupon_id")
      .in("coupon_id", popularCouponIds)
      .eq("status", "used");

    if (totalRedemptionsError) {
      logger.error("Failed to fetch total redemptions:", totalRedemptionsError);
    }

    const totalRedemptionCounts: Record<string, number> = {};
    totalRedemptions?.forEach(r => {
      totalRedemptionCounts[r.coupon_id] = (totalRedemptionCounts[r.coupon_id] || 0) + 1;
    });

    const popularCouponsToday = Object.entries(redemptionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([couponId, count]) => {
        const coupon = coupons?.find(c => c.id === couponId);
        return {
          coupon_id: couponId,
          name: coupon?.name || "Unknown",
          redemptions_today: count,
          redemptions_total: totalRedemptionCounts[couponId] || count,
        };
      });

    // Quick stats
    const avgTransactionToday = todayTransactions?.length > 0
      ? todayRevenue / todayTransactions.length
      : 0;

    const pointsAwardedToday = todayTransactions?.reduce(
      (sum, t) => sum + (t.loyalty_points_awarded || 0), 0
    ) || 0;

    const scannedTransactionsToday = todayTransactions?.filter(t => t.status === "completed").length || 0;
    const conversionRate = todayTransactions?.length > 0
      ? (scannedTransactionsToday / todayTransactions.length) * 100
      : 0;

    // Generate alerts
    const alerts: Array<{
      type: "warning" | "info" | "success";
      title: string;
      message: string;
      action?: string;
    }> = [];

    // Low conversion rate alert
    if (conversionRate < 50 && todayTransactions?.length >= 5) {
      alerts.push({
        type: "warning",
        title: "Low QR Scan Rate",
        message: `Only ${Math.round(conversionRate)}% of customers are scanning QR codes`,
        action: "Consider staff training on QR promotion",
      });
    }

    // No active coupons alert
    if (coupons?.length === 0) {
      alerts.push({
        type: "warning",
        title: "No Active Coupons",
        message: "Create coupons to boost customer engagement",
        action: "Create your first coupon",
      });
    }

    // Good performance alert
    if (vsAverage > 20) {
      alerts.push({
        type: "success",
        title: "Great Performance!",
        message: `Revenue is ${Math.round(vsAverage)}% above average today`,
      });
    }

    // Calculate goals (simple example - could be configured per shop)
    const estimatedDailyGoal = avgDailyRevenue * 1.1; // 10% above average
    const estimatedMonthlyGoal = estimatedDailyGoal * 30;
    const monthRevenue = monthTransactions?.reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;

    const widgets = {
      revenue_today: {
        amount: Math.round(todayRevenue * 100) / 100,
        vs_yesterday: Math.round(vsYesterday * 10) / 10,
        vs_average: Math.round(vsAverage * 10) / 10,
        transaction_count: todayTransactions?.length || 0,
      },
      active_customers_today: {
        count: uniqueCustomersToday,
        new_customers: newCustomerCount,
        returning_customers: returningCustomerCount,
      },
      popular_coupons_today: popularCouponsToday,
      quick_stats: {
        avg_transaction_today: Math.round(avgTransactionToday * 100) / 100,
        points_awarded_today: pointsAwardedToday,
        coupons_active: coupons?.length || 0,
        conversion_rate: Math.round(conversionRate * 10) / 10,
      },
      alerts: alerts,
      goals: {
        daily_revenue_goal: Math.round(estimatedDailyGoal * 100) / 100,
        daily_revenue_progress: Math.round((todayRevenue / estimatedDailyGoal) * 100),
        monthly_revenue_goal: Math.round(estimatedMonthlyGoal * 100) / 100,
        monthly_revenue_progress: Math.round((monthRevenue / estimatedMonthlyGoal) * 100),
      },
    };

    return c.json(
      standardResponse(200, "Dashboard widgets data retrieved successfully", widgets)
    );
  } catch (error) {
    logger.error("Error fetching dashboard widgets:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";

export const analyticsAdvancedController = new OpenAPIHono<UnifiedAuthContext>();

// Get coupon performance analytics
const getCouponPerformanceRoute = createRoute({
  method: "get",
  path: "/analytics/coupons",
  summary: "Get coupon performance analytics",
  description: "Analyze coupon effectiveness including redemption rates, revenue impact, and ROI",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      period: z.string().optional().describe("Time period: 7d, 30d, 90d, all"),
    }),
  },
  responses: {
    200: {
      description: "Coupon performance analytics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              summary: z.object({
                total_coupons: z.number(),
                active_coupons: z.number(),
                total_redemptions: z.number(),
                redemptions_in_period: z.number(),
                avg_redemption_rate: z.number(),
                total_discount_given: z.number(),
                revenue_from_coupon_transactions: z.number(),
                roi_percentage: z.number(),
              }),
              top_performers: z.array(z.object({
                coupon_id: z.string(),
                name: z.string(),
                type: z.string(),
                redemptions: z.number(),
                redemption_rate: z.number(),
                total_discount: z.number(),
                revenue_generated: z.number(),
                points_required: z.number().nullable(),
                is_active: z.boolean(),
              })),
              underperformers: z.array(z.object({
                coupon_id: z.string(),
                name: z.string(),
                redemptions: z.number(),
                days_since_created: z.number(),
                points_required: z.number().nullable(),
                expires_at: z.string().nullable(),
              })),
              expiring_soon: z.array(z.object({
                coupon_id: z.string(),
                name: z.string(),
                expires_at: z.string(),
                days_until_expiry: z.number(),
                redemptions: z.number(),
                is_active: z.boolean(),
              })),
            }),
          }),
        },
      },
    },
  },
});

analyticsAdvancedController.openapi(getCouponPerformanceRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { period = "30d" } = c.req.valid("query");

    // Parse period
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 9999;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all coupons for the shop
    const { data: coupons, error: couponError } = await supabase
      .from("coupons")
      .select("*")
      .eq("shop_id", shop.id);

    if (couponError) {
      logger.error("Failed to fetch coupons:", couponError);
      return c.json(standardResponse(500, "Failed to fetch coupon analytics"), 500);
    }

    // Get all redemptions
    const { data: redemptions, error: redemptionError } = await supabase
      .from("coupon_redemptions")
      .select(`
        id,
        coupon_id,
        points_deducted,
        discount_applied,
        redeemed_at,
        status,
        transaction_id
      `)
      .in("coupon_id", coupons?.map((c) => c.id) || []);

    if (redemptionError) {
      logger.error("Failed to fetch redemptions:", redemptionError);
      return c.json(standardResponse(500, "Failed to fetch coupon analytics"), 500);
    }

    // Get transactions associated with coupon redemptions
    const transactionIds = redemptions?.map(r => r.transaction_id).filter(Boolean) || [];
    const { data: couponTransactions, error: transError } = await supabase
      .from("transactions")
      .select("id, total_amount")
      .in("id", transactionIds);

    if (transError) {
      logger.error("Failed to fetch coupon transactions:", transError);
    }

    // Calculate analytics
    const totalCoupons = coupons?.length || 0;
    const activeCoupons = coupons?.filter(c => c.is_active).length || 0;
    const totalRedemptions = redemptions?.filter(r => r.status === "used").length || 0;
    const redemptionsInPeriod = redemptions?.filter(
      r => r.status === "used" && new Date(r.redeemed_at) >= startDate
    ).length || 0;

    const totalDiscountGiven = redemptions?.reduce((sum, r) => sum + (r.discount_applied || 0), 0) || 0;

    // Calculate revenue from coupon transactions
    const revenueFromCouponTransactions = couponTransactions?.reduce(
      (sum, t) => sum + Number(t.total_amount), 0
    ) || 0;

    // ROI: (Revenue - Discounts) / Discounts * 100
    const roiPercentage = totalDiscountGiven > 0
      ? ((revenueFromCouponTransactions - totalDiscountGiven) / totalDiscountGiven) * 100
      : 0;

    // Calculate per-coupon metrics
    const couponMetrics = coupons?.map(coupon => {
      const couponRedemptions = redemptions?.filter(
        r => r.coupon_id === coupon.id && r.status === "used"
      ) || [];
      const redemptionCount = couponRedemptions.length;
      const totalDiscount = couponRedemptions.reduce((sum, r) => sum + (r.discount_applied || 0), 0);

      // Calculate revenue generated from this coupon
      const couponTransactionIds = couponRedemptions.map(r => r.transaction_id).filter(Boolean);
      const revenueGenerated = couponTransactions
        ?.filter(t => couponTransactionIds.includes(t.id))
        .reduce((sum, t) => sum + Number(t.total_amount), 0) || 0;

      // Calculate redemption rate (redemptions per month since creation)
      const daysSinceCreated = Math.max(
        1,
        (new Date().getTime() - new Date(coupon.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      const monthsSinceCreated = daysSinceCreated / 30;
      const redemptionRate = redemptionCount / monthsSinceCreated;

      return {
        coupon_id: coupon.id,
        name: coupon.name,
        type: coupon.type,
        redemptions: redemptionCount,
        redemption_rate: Math.round(redemptionRate * 10) / 10,
        total_discount: totalDiscount,
        revenue_generated: revenueGenerated,
        points_required: coupon.points_required,
        is_active: coupon.is_active,
        created_at: coupon.created_at,
        expires_at: coupon.expires_at,
        days_since_created: Math.round(daysSinceCreated),
      };
    }) || [];

    // Sort to find top performers and underperformers
    const sortedByPerformance = [...couponMetrics].sort((a, b) => b.redemptions - a.redemptions);
    const topPerformers = sortedByPerformance
      .slice(0, 5)
      .map(({ days_since_created, created_at, ...rest }) => rest);

    const underperformers = sortedByPerformance
      .filter(c => c.is_active && c.redemptions < 5 && c.days_since_created > 14)
      .slice(-5)
      .reverse()
      .map(({ redemption_rate, total_discount, revenue_generated, is_active, type, created_at, ...rest }) => rest);

    // Find expiring soon coupons
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringSoon = couponMetrics
      .filter(c => c.expires_at && new Date(c.expires_at) <= thirtyDaysFromNow && new Date(c.expires_at) > now)
      .map(c => ({
        coupon_id: c.coupon_id,
        name: c.name,
        expires_at: c.expires_at!,
        days_until_expiry: Math.ceil(
          (new Date(c.expires_at!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        ),
        redemptions: c.redemptions,
        is_active: c.is_active,
      }))
      .sort((a, b) => a.days_until_expiry - b.days_until_expiry)
      .slice(0, 5);

    const avgRedemptionRate = totalCoupons > 0
      ? couponMetrics.reduce((sum, c) => sum + c.redemption_rate, 0) / totalCoupons
      : 0;

    const analytics = {
      summary: {
        total_coupons: totalCoupons,
        active_coupons: activeCoupons,
        total_redemptions: totalRedemptions,
        redemptions_in_period: redemptionsInPeriod,
        avg_redemption_rate: Math.round(avgRedemptionRate * 10) / 10,
        total_discount_given: Math.round(totalDiscountGiven * 100) / 100,
        revenue_from_coupon_transactions: Math.round(revenueFromCouponTransactions * 100) / 100,
        roi_percentage: Math.round(roiPercentage * 10) / 10,
      },
      top_performers: topPerformers,
      underperformers: underperformers,
      expiring_soon: expiringSoon,
    };

    return c.json(
      standardResponse(200, "Coupon performance analytics retrieved successfully", analytics)
    );
  } catch (error) {
    logger.error("Error fetching coupon performance:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get trends analytics
const getTrendsAnalyticsRoute = createRoute({
  method: "get",
  path: "/analytics/trends",
  summary: "Get business trends analytics",
  description: "Analyze business trends including peak hours, weekly patterns, and growth metrics",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      period: z.string().optional().describe("Time period: 7d, 30d, 90d"),
    }),
  },
  responses: {
    200: {
      description: "Trends analytics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              peak_hours: z.array(z.object({
                hour: z.number(),
                transaction_count: z.number(),
                revenue: z.number(),
                is_peak: z.boolean(),
              })),
              weekly_pattern: z.array(z.object({
                day_of_week: z.string(),
                day_number: z.number(),
                transaction_count: z.number(),
                revenue: z.number(),
                avg_transaction: z.number(),
              })),
              growth_metrics: z.object({
                revenue_growth_percentage: z.number(),
                transaction_growth_percentage: z.number(),
                customer_growth_percentage: z.number(),
                current_period_revenue: z.number(),
                previous_period_revenue: z.number(),
                current_period_transactions: z.number(),
                previous_period_transactions: z.number(),
              }),
              monthly_trend: z.array(z.object({
                month: z.string(),
                revenue: z.number(),
                transactions: z.number(),
                unique_customers: z.number(),
              })),
            }),
          }),
        },
      },
    },
  },
});

analyticsAdvancedController.openapi(getTrendsAnalyticsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { period = "30d" } = c.req.valid("query");

    // Parse period
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get comparison period
    const previousStartDate = new Date();
    previousStartDate.setDate(previousStartDate.getDate() - (days * 2));

    // Get transactions for analysis
    const { data: transactions, error: transError } = await supabase
      .from("transactions")
      .select("id, total_amount, created_at, app_user_id, status")
      .eq("shop_id", shop.id)
      .neq("status", "cancelled")
      .gte("created_at", previousStartDate.toISOString());

    if (transError) {
      logger.error("Failed to fetch transactions for trends:", transError);
      return c.json(standardResponse(500, "Failed to fetch trends analytics"), 500);
    }

    // Separate current and previous period transactions
    const currentTransactions = transactions?.filter(
      t => new Date(t.created_at) >= startDate
    ) || [];
    const previousTransactions = transactions?.filter(
      t => new Date(t.created_at) >= previousStartDate && new Date(t.created_at) < startDate
    ) || [];

    // Calculate peak hours (24-hour format)
    const hourlyData: Record<number, { count: number; revenue: number }> = {};
    for (let hour = 0; hour < 24; hour++) {
      hourlyData[hour] = { count: 0, revenue: 0 };
    }

    currentTransactions.forEach(t => {
      const hour = new Date(t.created_at).getHours();
      hourlyData[hour].count++;
      hourlyData[hour].revenue += Number(t.total_amount);
    });

    const avgTransactionsPerHour = currentTransactions.length / 24;
    const peakHours = Object.entries(hourlyData).map(([hour, data]) => ({
      hour: parseInt(hour),
      transaction_count: data.count,
      revenue: Math.round(data.revenue * 100) / 100,
      is_peak: data.count > avgTransactionsPerHour * 1.5, // 50% above average
    }));

    // Calculate weekly pattern
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const weeklyData: Record<number, { count: number; revenue: number }> = {};
    for (let day = 0; day < 7; day++) {
      weeklyData[day] = { count: 0, revenue: 0 };
    }

    currentTransactions.forEach(t => {
      const dayOfWeek = new Date(t.created_at).getDay();
      weeklyData[dayOfWeek].count++;
      weeklyData[dayOfWeek].revenue += Number(t.total_amount);
    });

    const weeklyPattern = Object.entries(weeklyData).map(([day, data]) => ({
      day_of_week: daysOfWeek[parseInt(day)],
      day_number: parseInt(day),
      transaction_count: data.count,
      revenue: Math.round(data.revenue * 100) / 100,
      avg_transaction: data.count > 0 ? Math.round((data.revenue / data.count) * 100) / 100 : 0,
    }));

    // Calculate growth metrics
    const currentRevenue = currentTransactions.reduce((sum, t) => sum + Number(t.total_amount), 0);
    const previousRevenue = previousTransactions.reduce((sum, t) => sum + Number(t.total_amount), 0);
    const currentTransactionCount = currentTransactions.length;
    const previousTransactionCount = previousTransactions.length;

    const currentUniqueCustomers = new Set(
      currentTransactions.map(t => t.app_user_id).filter(Boolean)
    ).size;
    const previousUniqueCustomers = new Set(
      previousTransactions.map(t => t.app_user_id).filter(Boolean)
    ).size;

    const revenueGrowth = previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : 0;
    const transactionGrowth = previousTransactionCount > 0
      ? ((currentTransactionCount - previousTransactionCount) / previousTransactionCount) * 100
      : 0;
    const customerGrowth = previousUniqueCustomers > 0
      ? ((currentUniqueCustomers - previousUniqueCustomers) / previousUniqueCustomers) * 100
      : 0;

    // Calculate monthly trend (last 6 months)
    const monthlyTrend: Array<{
      month: string;
      revenue: number;
      transactions: number;
      unique_customers: number;
    }> = [];

    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const monthTransactions = transactions?.filter(
        t => new Date(t.created_at) >= monthStart && new Date(t.created_at) < monthEnd
      ) || [];

      const monthName = monthStart.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthlyTrend.push({
        month: monthName,
        revenue: Math.round(
          monthTransactions.reduce((sum, t) => sum + Number(t.total_amount), 0) * 100
        ) / 100,
        transactions: monthTransactions.length,
        unique_customers: new Set(
          monthTransactions.map(t => t.app_user_id).filter(Boolean)
        ).size,
      });
    }

    const analytics = {
      peak_hours: peakHours,
      weekly_pattern: weeklyPattern,
      growth_metrics: {
        revenue_growth_percentage: Math.round(revenueGrowth * 10) / 10,
        transaction_growth_percentage: Math.round(transactionGrowth * 10) / 10,
        customer_growth_percentage: Math.round(customerGrowth * 10) / 10,
        current_period_revenue: Math.round(currentRevenue * 100) / 100,
        previous_period_revenue: Math.round(previousRevenue * 100) / 100,
        current_period_transactions: currentTransactionCount,
        previous_period_transactions: previousTransactionCount,
      },
      monthly_trend: monthlyTrend,
    };

    return c.json(
      standardResponse(200, "Trends analytics retrieved successfully", analytics)
    );
  } catch (error) {
    logger.error("Error fetching trends analytics:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
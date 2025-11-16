import { z } from "zod";

// Shop Management Schemas
export const updateShopSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  shop_category: z.enum(["bar", "restaurant", "bakery", "wellness", "pastry", "cafe", "retail", "other"]).optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Brand color must be a valid hex color (e.g., #FF5733)").optional(),
  loyalty_type: z
    .union([
      z.enum(["points", "coupons"]),
      z.literal("").transform(() => undefined),
    ])
    .optional(),
  points_per_euro: z.number().int().min(1).max(1000).optional(),
  opening_hours: z.string().optional(),
  image_url: z.string().url().optional(),
  tag: z.string().optional(),
  qr_display_text: z.string().max(200).optional(),
});

export const shopResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  type: z.string().nullable(),
  shop_category: z.string().nullable(),
  brand_color: z.string().nullable(),
  loyalty_type: z.string().nullable(),
  points_per_euro: z.number().nullable(),
  opening_hours: z.string().nullable(),
  image_url: z.string().nullable(),
  tag: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const uploadImageSchema = z.object({
  image_url: z.string().url("Invalid image URL format"),
});

// Coupon Management Schemas
export const createCouponSchema = z.object({
  type: z.enum(["percentage", "fixed"]),
  articles: z
    .array(
      z.object({
        article_id: z.string().uuid().nullable(),
        article_name: z.string().nullable(),
        discount_value: z.number().min(0, "Discount value must be positive"),
      })
    )
    .min(1, "At least one article is required"),
  points_required: z.number().min(0, "Points required must be positive"),
  name: z.string().min(1, "Coupon name is required"),
  description: z.string().optional(),
  expires_at: z
    .union([z.string().datetime(), z.literal("").transform(() => undefined)])
    .optional(),
  image_url: z
    .union([z.string().url(), z.literal("").transform(() => undefined)])
    .optional(),
  is_active: z.boolean().default(true),
});

export const updateCouponSchema = createCouponSchema.partial();

export const couponResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  type: z.string(),
  articles: z.array(
    z.object({
      article_id: z.string().uuid().nullable(),
      article_name: z.string().nullable(),
      discount_value: z.number(),
    })
  ),
  points_required: z.number().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  expires_at: z.string().nullable(),
  used_count: z.number(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Article Schemas
export const articleResponseSchema = z.object({
  id: z.string().uuid(),
  pos_article_id: z.string(),
  name: z.string(),
  base_price: z.number(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  type: z.string().nullable(),
  tax_rate: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
});

// Transaction Schemas
export const transactionResponseSchema = z.object({
  id: z.string().uuid(),
  pos_invoice_id: z.string(),
  total_amount: z.number(),
  tax_amount: z.number(),
  status: z.string(),
  loyalty_points_awarded: z.number(),
  created_at: z.string(),
  app_user: z
    .object({
      first_name: z.string().nullable(),
      last_name: z.string().nullable(),
      phone_number: z.string().nullable(),
    })
    .nullable(),
});

// Customer Schemas
export const customerResponseSchema = z.object({
  customer_id: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone_number: z.string().nullable(),
  email: z.string().nullable(),
  total_spent: z.number(),
  visit_count: z.number(),
  points_balance: z.number(),
  avg_transaction: z.number(),
  last_visit_at: z.string().nullable(),
  customer_since: z.string(),
  days_since_last_visit: z.number().nullable(),
  customer_rank: z.number(),
  percentile: z.number(),
});

export const customerSegmentSchema = z.object({
  customer_id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  total_spent: z.number(),
  visit_count: z.number(),
  last_visit: z.string().nullable(),
});

// Analytics Response Schemas
export const analyticsResponseSchema = z.object({
  shop_id: z.string().uuid(),
  shop_name: z.string(),
  total_transactions: z.number(),
  transactions_last_30_days: z.number(),
  transactions_last_7_days: z.number(),
  total_revenue: z.number(),
  revenue_last_30_days: z.number(),
  revenue_last_7_days: z.number(),
  avg_transaction_amount: z.number(),
  scanned_transactions: z.number(),
  scanned_transactions_last_30_days: z.number(),
  scanned_transactions_last_7_days: z.number(),
  scanned_revenue: z.number(),
  scanned_revenue_last_30_days: z.number(),
  scanned_revenue_last_7_days: z.number(),
  unique_customers: z.number(),
  total_coupons: z.number(),
  active_coupons: z.number(),
  total_coupon_redemptions: z.number(),
});

// Dashboard Widget Schemas
export const dashboardWidgetSchema = z.object({
  revenue_today: z.object({
    amount: z.number(),
    vs_yesterday: z.number(),
    vs_average: z.number(),
    transaction_count: z.number(),
  }),
  active_customers_today: z.object({
    count: z.number(),
    new_customers: z.number(),
    returning_customers: z.number(),
  }),
  popular_coupons_today: z.array(z.object({
    coupon_id: z.string(),
    name: z.string(),
    redemptions_today: z.number(),
    redemptions_total: z.number(),
  })),
  quick_stats: z.object({
    avg_transaction_today: z.number(),
    points_awarded_today: z.number(),
    coupons_active: z.number(),
    conversion_rate: z.number().describe("Percentage of scanned transactions"),
  }),
  alerts: z.array(z.object({
    type: z.enum(["warning", "info", "success"]),
    title: z.string(),
    message: z.string(),
    action: z.string().optional(),
  })),
  goals: z.object({
    daily_revenue_goal: z.number(),
    daily_revenue_progress: z.number(),
    monthly_revenue_goal: z.number(),
    monthly_revenue_progress: z.number(),
  }),
});
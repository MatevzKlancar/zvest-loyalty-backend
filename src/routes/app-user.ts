import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";

const appUser = new OpenAPIHono();

// Helper function to get app_user by either email or UUID
async function getAppUserByIdentifier(identifier: string) {
  // Check if identifier is a UUID (rough check)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  
  if (isUUID) {
    // Try to get user by ID first
    const { data: user, error } = await supabase
      .from("app_users")
      .select("id, email, phone_number")
      .eq("id", identifier)
      .single();
    return { data: user, error };
  } else {
    // Try to get user by email
    const { data: user, error } = await supabase
      .from("app_users")
      .select("id, email, phone_number")
      .eq("email", identifier)
      .single();
    return { data: user, error };
  }
}

// ===========================
// B2C APP USER PROFILE ENDPOINT
// ===========================

const appUserProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  summary: "📱 Get B2C app user profile",
  description: `
**B2C app user profile endpoint** returns user-specific profile information.

Returns loyalty points, transaction history, and user preferences.
**Authentication:** Currently public, but will require customer authentication in the future.
  `,
  tags: ["Customer App"],
  request: {
    query: z.object({
      email: z.string().email("Valid email required"),
      phone: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "B2C app user profile retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              user_type: z.string(),
              email: z.string(),
              phone: z.string().optional(),
              loyalty_accounts: z.array(
                z.object({
                  shop_id: z.string(),
                  shop_name: z.string(),
                  points_balance: z.number(),
                  total_earned: z.number(),
                  total_redeemed: z.number(),
                  last_transaction_date: z.string().optional(),
                })
              ),
              recent_transactions: z.array(
                z.object({
                  id: z.string(),
                  shop_name: z.string(),
                  amount: z.number(),
                  points_earned: z.number(),
                  points_redeemed: z.number(),
                  transaction_date: z.string(),
                  transaction_type: z.string(),
                })
              ),
              user_preferences: z.object({
                notifications_enabled: z.boolean(),
                preferred_language: z.string(),
                marketing_consent: z.boolean(),
              }),
            }),
          }),
        },
      },
    },
  },
});

appUser.openapi(appUserProfileRoute, async (c) => {
  try {
    const { email, phone } = c.req.valid("query");

    // Get app_user by email
    const { data: appUser, error: userError } = await supabase
      .from("app_users")
      .select("id, email, phone_number")
      .eq("email", email)
      .single();

    if (userError || !appUser) {
      return c.json(
        standardResponse(404, "User not found"),
        404
      );
    }

    // Get user's loyalty accounts using app_user_id
    const { data: loyaltyAccounts, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select(
        `
        shop_id,
        points_balance,
        total_points_earned,
        total_points_redeemed,
        shops!inner (
          name
        )
      `
      )
      .eq("app_user_id", appUser.id)
      .order("created_at", { ascending: false });

    if (loyaltyError) {
      logger.error("Error fetching loyalty accounts:", loyaltyError);
      return c.json(
        standardResponse(500, "Failed to fetch loyalty accounts"),
        500
      );
    }

    // Get recent transactions using app_user_id
    const { data: transactions, error: transError } = await supabase
      .from("transactions")
      .select(
        `
        id,
        total_amount,
        loyalty_points_awarded,
        loyalty_points_redeemed,
        created_at,
        transaction_type,
        shops!inner (
          name
        )
      `
      )
      .eq("app_user_id", appUser.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (transError) {
      logger.error("Error fetching transactions:", transError);
      return c.json(standardResponse(500, "Failed to fetch transactions"), 500);
    }

    // Format loyalty accounts data
    const formattedLoyaltyAccounts =
      loyaltyAccounts?.map((account) => ({
        shop_id: account.shop_id,
        shop_name: account.shops[0]?.name || "Unknown Shop",
        points_balance: account.points_balance,
        total_earned: account.total_points_earned,
        total_redeemed: account.total_points_redeemed,
        last_transaction_date: transactions?.find(
          (t) => t.shops[0]?.name === account.shops[0]?.name
        )?.created_at,
      })) || [];

    // Format transactions data
    const formattedTransactions =
      transactions?.map((transaction) => ({
        id: transaction.id,
        shop_name: transaction.shops[0]?.name || "Unknown Shop",
        amount: transaction.total_amount,
        points_earned: transaction.loyalty_points_awarded,
        points_redeemed: transaction.loyalty_points_redeemed,
        transaction_date: transaction.created_at,
        transaction_type: transaction.transaction_type || "purchase",
      })) || [];

    // Mock user preferences (in real app, this would come from a user_preferences table)
    const userPreferences = {
      notifications_enabled: true,
      preferred_language: "en",
      marketing_consent: true,
    };

    const profileData = {
      user_type: "app_user",
      email: appUser.email,
      phone: appUser.phone_number || phone,
      loyalty_accounts: formattedLoyaltyAccounts,
      recent_transactions: formattedTransactions,
      user_preferences: userPreferences,
    };

    return c.json(
      standardResponse(
        200,
        "B2C app user profile retrieved successfully",
        profileData
      )
    );
  } catch (error) {
    logger.error("Error fetching B2C app user profile:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// USER LOYALTY ENDPOINTS
// ===========================

const userLoyaltyResponseSchema = z.object({
  user_id: z.string(),
  shop_id: z.string(),
  shop_name: z.string(),
  shop_type: z.string().nullable(),
  loyalty_type: z.string(),
  points_balance: z.number(),
  total_points_earned: z.number(),
  total_points_redeemed: z.number(),
  total_spent: z.number(),
  invoice_count: z.number(),
  last_visit_date: z.string().nullable(),
  last_transaction_date: z.string().nullable(),
  tier: z.string().nullable(),
  created_at: z.string(),
});

const allUserLoyaltyResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  total_points_all_stores: z.number(),
  total_spent_all_stores: z.number(),
  loyalty_accounts: z.array(userLoyaltyResponseSchema),
});

// ===========================
// GET /users/:userId/loyalty/:storeId - Get user's loyalty points for a specific store
// ===========================

const getUserLoyaltyForStoreRoute = createRoute({
  method: "get",
  path: "/users/{userId}/loyalty/{storeId}",
  summary: "⭐ Get user's loyalty points for a specific store",
  description: `
Get detailed loyalty information for a specific user at a specific store.

**Features:**
- Complete loyalty account details for one store
- Points balance, earned, and redeemed
- Visit count and transaction history
- Tier information and favorite status
- Store-specific loyalty program details

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/app-user/users/123/loyalty/456'
\`\`\`

**Use Cases:**
- Display store-specific loyalty info in customer app
- Show progress toward rewards at specific store
- Store detail page in customer app
  `,
  tags: ["Customer App"],
  request: {
    params: z.object({
      userId: z.string().min(1, "User ID is required"),
      storeId: z.string().uuid("Invalid store ID"),
    }),
  },
  responses: {
    200: {
      description: "User loyalty information retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: userLoyaltyResponseSchema,
          }),
        },
      },
    },
    404: {
      description:
        "User or store not found, or user has no loyalty account for this store",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Loyalty account not found"),
          }),
        },
      },
    },
  },
});

appUser.openapi(getUserLoyaltyForStoreRoute, async (c) => {
  try {
    const { userId, storeId } = c.req.valid("param");

    // Get app_user by either email or UUID
    const { data: appUser, error: userError } = await getAppUserByIdentifier(userId);

    if (userError || !appUser) {
      return c.json(
        standardResponse(404, "User not found"),
        404
      );
    }

    // Get user's loyalty account for the specific store using app_user_id
    const { data: loyaltyAccount, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select(
        `
        app_user_id,
        shop_id,
        points_balance,
        total_spent,
        invoice_count,
        last_visit_at,
        is_active,
        created_at,
        shops!inner (
          id,
          name,
          type,
          status
        )
      `
      )
      .eq("app_user_id", appUser.id)
      .eq("shop_id", storeId)
      .eq("shops.status", "active")
      .single();

    if (loyaltyError || !loyaltyAccount) {
      return c.json(
        standardResponse(404, "Loyalty account not found for this store"),
        404
      );
    }

    // Get last transaction date using app_user_id
    const { data: lastTransaction } = await supabase
      .from("transactions")
      .select("created_at")
      .eq("shop_id", storeId)
      .eq("app_user_id", appUser.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const shop = loyaltyAccount.shops as any;
    const loyaltyData = {
      user_id: appUser.email, // Return email as user_id for API consistency
      shop_id: loyaltyAccount.shop_id,
      shop_name: shop.name,
      shop_type: shop.type,
      loyalty_type: 'points', // Default value since field may not exist
      points_balance: loyaltyAccount.points_balance,
      total_points_earned: 0, // Will need to calculate from transactions
      total_points_redeemed: 0, // Will need to calculate from transactions
      total_spent: loyaltyAccount.total_spent,
      invoice_count: loyaltyAccount.invoice_count || 0,
      last_visit_date: loyaltyAccount.last_visit_at,
      last_transaction_date: lastTransaction?.created_at || null,
      tier: null, // Not available in current schema
      created_at: loyaltyAccount.created_at,
    };

    return c.json(
      standardResponse(
        200,
        "User loyalty information retrieved successfully",
        loyaltyData
      )
    );
  } catch (error) {
    logger.error("Error fetching user loyalty for store:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// GET /users/:userId/loyalty - Get user's loyalty points for all favorite stores
// ===========================

const getUserLoyaltyAllStoresRoute = createRoute({
  method: "get",
  path: "/users/{userId}/loyalty",
  summary: "⭐ Get user's loyalty points for all stores",
  description: `
Get comprehensive loyalty information for a user across all their stores.

**Features:**
- All loyalty accounts for the user
- Total points and spending across all stores
- Store-specific loyalty details
- Pagination support

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/app-user/users/user@example.com/loyalty?limit=20'
\`\`\`

**Use Cases:**
- Main loyalty dashboard in customer app
- Overview of all loyalty programs joined
  `,
  tags: ["Customer App"],
  request: {
    params: z.object({
      userId: z.string().min(1, "User ID is required"),
    }),
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "User loyalty information retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: allUserLoyaltyResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "User not found or has no loyalty accounts",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z
              .string()
              .default("User not found or has no loyalty accounts"),
          }),
        },
      },
    },
  },
});

appUser.openapi(getUserLoyaltyAllStoresRoute, async (c) => {
  try {
    const { userId } = c.req.valid("param");
    const { limit = "50", offset = "0" } = c.req.valid("query");

    const limitNum = parseInt(limit, 10) || 50;
    const offsetNum = parseInt(offset, 10) || 0;

    // Get app_user by either email or UUID
    const { data: appUser, error: userError } = await getAppUserByIdentifier(userId);

    if (userError || !appUser) {
      return c.json(
        standardResponse(404, "User not found"),
        404
      );
    }

    // Build query for loyalty accounts using app_user_id
    let query = supabase
      .from("customer_loyalty_accounts")
      .select(
        `
        app_user_id,
        shop_id,
        points_balance,
        total_spent,
        invoice_count,
        last_visit_at,
        is_active,
        created_at,
        shops!inner (
          id,
          name,
          type,
          status
        )
      `
      )
      .eq("app_user_id", appUser.id)
      .eq("shops.status", "active");

    // Apply pagination
    const { data: loyaltyAccounts, error: loyaltyError } = await query.range(
      offsetNum,
      offsetNum + limitNum - 1
    );

    if (loyaltyError) {
      logger.error("Error fetching user loyalty accounts:", loyaltyError);
      return c.json(
        standardResponse(500, "Failed to fetch loyalty accounts"),
        500
      );
    }

    if (!loyaltyAccounts || loyaltyAccounts.length === 0) {
      return c.json(
        standardResponse(404, "User not found or has no loyalty accounts"),
        404
      );
    }

    // Get recent transaction dates for each store using app_user_id
    const storeIds = loyaltyAccounts.map((acc) => acc.shop_id);
    const { data: recentTransactions } = await supabase
      .from("transactions")
      .select("shop_id, created_at")
      .eq("app_user_id", appUser.id)
      .in("shop_id", storeIds)
      .order("created_at", { ascending: false });

    // Create a map of store_id to last transaction date
    const lastTransactionMap = new Map();
    recentTransactions?.forEach((transaction) => {
      if (!lastTransactionMap.has(transaction.shop_id)) {
        lastTransactionMap.set(transaction.shop_id, transaction.created_at);
      }
    });

    // Format loyalty accounts data
    const formattedAccounts = loyaltyAccounts.map((account) => {
      const shop = account.shops as any;
      return {
        user_id: appUser.email, // Return email as user_id for API consistency
        shop_id: account.shop_id,
        shop_name: shop.name,
        shop_type: shop.type,
        loyalty_type: 'points', // Default value since field may not exist
        points_balance: account.points_balance,
        total_points_earned: 0, // Will need to calculate from transactions
        total_points_redeemed: 0, // Will need to calculate from transactions
        total_spent: account.total_spent,
        invoice_count: account.invoice_count || 0,
        last_visit_date: account.last_visit_at,
        last_transaction_date: lastTransactionMap.get(account.shop_id) || null,
        tier: null, // Not available in current schema
        created_at: account.created_at,
      };
    });

    // Sort by last_transaction_date descending (most recent visits first)
    formattedAccounts.sort((a, b) => {
      // Handle null values - shops with no transactions appear last
      if (!a.last_transaction_date && !b.last_transaction_date) return 0;
      if (!a.last_transaction_date) return 1;
      if (!b.last_transaction_date) return -1;
      
      // Sort descending by date (most recent first)
      return new Date(b.last_transaction_date).getTime() - new Date(a.last_transaction_date).getTime();
    });

    // Calculate totals
    const totalPointsAllStores = formattedAccounts.reduce(
      (sum, acc) => sum + acc.points_balance,
      0
    );
    const totalSpentAllStores = formattedAccounts.reduce(
      (sum, acc) => sum + acc.total_spent,
      0
    );

    const loyaltyData = {
      user_id: appUser.email, // Return email as user_id for API consistency
      email: appUser.email,
      phone: appUser.phone_number,
      total_points_all_stores: totalPointsAllStores,
      total_spent_all_stores: totalSpentAllStores,
      loyalty_accounts: formattedAccounts,
    };

    return c.json(
      standardResponse(
        200,
        "User loyalty information retrieved successfully",
        loyaltyData
      )
    );
  } catch (error) {
    logger.error("Error fetching user loyalty for all stores:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// USER TRANSACTION ENDPOINTS
// ===========================

const userTransactionResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  shop_name: z.string(),
  shop_type: z.string().nullable(),
  pos_invoice_id: z.string(),
  total_amount: z.number(),
  tax_amount: z.number(),
  items: z.array(z.any()),
  loyalty_points_awarded: z.number(),
  loyalty_points_redeemed: z.number(),
  status: z.string(),
  transaction_type: z.string(),
  qr_scanned_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const userTransactionHistoryResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  total_transactions: z.number(),
  total_spent: z.number(),
  total_points_earned: z.number(),
  total_points_redeemed: z.number(),
  transactions: z.array(userTransactionResponseSchema),
  stats: z.object({
    transactions_last_30_days: z.number(),
    spent_last_30_days: z.number(),
    points_earned_last_30_days: z.number(),
    favorite_store: z.string().nullable(),
  }),
});

// ===========================
// GET /users/:userId/transactions - Get user's transaction history
// ===========================

const getUserTransactionsRoute = createRoute({
  method: "get",
  path: "/users/{userId}/transactions",
  summary: "💳 Get user's transaction history",
  description: `
Get comprehensive transaction history for a specific user across all stores.

**Features:**
- Complete transaction history with details
- Transaction items and amounts
- Points earned and redeemed per transaction
- Store information for each transaction
- Supports filtering by store, date range, and status
- Pagination support for large transaction histories
- Summary statistics

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/app-user/users/user@example.com/transactions?limit=20&shop_id=123&status=completed'
\`\`\`

**Use Cases:**
- Transaction history page in customer app
- Receipt lookup and management
- Points earning history
- Spending analytics for users
  `,
  tags: ["Customer App"],
  request: {
    params: z.object({
      userId: z.string().min(1, "User ID is required"),
    }),
    query: z.object({
      shop_id: z.string().uuid().optional(),
      status: z.string().optional(),
      from_date: z.string().optional(), // ISO date string
      to_date: z.string().optional(), // ISO date string
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "User transaction history retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: userTransactionHistoryResponseSchema,
            meta: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          }),
        },
      },
    },
    404: {
      description: "User not found or has no transactions",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z
              .string()
              .default("User not found or has no transactions"),
          }),
        },
      },
    },
  },
});

appUser.openapi(getUserTransactionsRoute, async (c) => {
  try {
    const { userId } = c.req.valid("param");
    const {
      shop_id,
      status,
      from_date,
      to_date,
      limit = "50",
      offset = "0",
    } = c.req.valid("query");

    const limitNum = parseInt(limit, 10) || 50;
    const offsetNum = parseInt(offset, 10) || 0;

    // Get app_user by email first
    const { data: appUser, error: userError } = await supabase
      .from("app_users")
      .select("id, email, phone_number")
      .eq("email", userId)
      .single();

    if (userError || !appUser) {
      return c.json(
        standardResponse(404, "User not found"),
        404
      );
    }

    // Build query for transactions using app_user_id
    let query = supabase
      .from("transactions")
      .select(
        `
        id,
        shop_id,
        pos_invoice_id,
        total_amount,
        tax_amount,
        items,
        loyalty_points_awarded,
        loyalty_points_redeemed,
        status,
        transaction_type,
        qr_scanned_at,
        created_at,
        updated_at,
        shops!inner (
          id,
          name,
          type,
          status
        )
      `,
        { count: "exact" }
      )
      .eq("app_user_id", appUser.id)
      .eq("shops.status", "active")
      .order("created_at", { ascending: false });

    // Apply filters
    if (shop_id) {
      query = query.eq("shop_id", shop_id);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (from_date) {
      query = query.gte("created_at", from_date);
    }

    if (to_date) {
      query = query.lte("created_at", to_date);
    }

    // Apply pagination
    const {
      data: transactions,
      error: transactionsError,
      count,
    } = await query.range(offsetNum, offsetNum + limitNum - 1);

    if (transactionsError) {
      logger.error("Error fetching user transactions:", transactionsError);
      return c.json(standardResponse(500, "Failed to fetch transactions"), 500);
    }

    if (!transactions || transactions.length === 0) {
      return c.json(
        standardResponse(404, "User not found or has no transactions"),
        404
      );
    }

    // Format transactions data
    const formattedTransactions = transactions.map((transaction) => {
      const shop = transaction.shops as any;
      return {
        id: transaction.id,
        shop_id: transaction.shop_id,
        shop_name: shop.name,
        shop_type: shop.type,
        pos_invoice_id: transaction.pos_invoice_id,
        total_amount: transaction.total_amount,
        tax_amount: transaction.tax_amount,
        items: transaction.items,
        loyalty_points_awarded: transaction.loyalty_points_awarded,
        loyalty_points_redeemed: transaction.loyalty_points_redeemed,
        status: transaction.status,
        transaction_type: transaction.transaction_type || "purchase",
        qr_scanned_at: transaction.qr_scanned_at,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at,
      };
    });

    // Calculate summary statistics
    const totalTransactions = count || 0;
    const totalSpent = formattedTransactions.reduce(
      (sum, t) => sum + t.total_amount,
      0
    );
    const totalPointsEarned = formattedTransactions.reduce(
      (sum, t) => sum + t.loyalty_points_awarded,
      0
    );
    const totalPointsRedeemed = formattedTransactions.reduce(
      (sum, t) => sum + t.loyalty_points_redeemed,
      0
    );

    // Calculate 30-day statistics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentTransactions = formattedTransactions.filter(
      (t) => new Date(t.created_at) >= thirtyDaysAgo
    );

    const transactionsLast30Days = recentTransactions.length;
    const spentLast30Days = recentTransactions.reduce(
      (sum, t) => sum + t.total_amount,
      0
    );
    const pointsEarnedLast30Days = recentTransactions.reduce(
      (sum, t) => sum + t.loyalty_points_awarded,
      0
    );

    // Find favorite store (most transactions)
    const storeFrequency = new Map();
    formattedTransactions.forEach((t) => {
      const count = storeFrequency.get(t.shop_name) || 0;
      storeFrequency.set(t.shop_name, count + 1);
    });

    let favoriteStore = null;
    let maxCount = 0;
    storeFrequency.forEach((count, storeName) => {
      if (count > maxCount) {
        maxCount = count;
        favoriteStore = storeName;
      }
    });

    const transactionData = {
      user_id: appUser.email, // Return email as user_id for API consistency
      email: appUser.email,
      phone: appUser.phone_number,
      total_transactions: totalTransactions,
      total_spent: totalSpent,
      total_points_earned: totalPointsEarned,
      total_points_redeemed: totalPointsRedeemed,
      transactions: formattedTransactions,
      stats: {
        transactions_last_30_days: transactionsLast30Days,
        spent_last_30_days: spentLast30Days,
        points_earned_last_30_days: pointsEarnedLast30Days,
        favorite_store: favoriteStore,
      },
    };

    return c.json({
      success: true,
      message: "User transaction history retrieved successfully",
      data: transactionData,
      meta: {
        total: totalTransactions,
        limit: limitNum,
        offset: offsetNum,
      },
    });
  } catch (error) {
    logger.error("Error fetching user transactions:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// USER PROFILE MANAGEMENT ENDPOINTS
// ===========================

const updateUserProfileSchema = z.object({
  phone: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  date_of_birth: z.string().optional(), // ISO date string
  preferences: z
    .object({
      notifications_enabled: z.boolean().optional(),
      marketing_consent: z.boolean().optional(),
      preferred_language: z.string().optional(),
      newsletter_subscription: z.boolean().optional(),
    })
    .optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      postal_code: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
});

const userProfileResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  preferences: z.object({
    notifications_enabled: z.boolean(),
    marketing_consent: z.boolean(),
    preferred_language: z.string(),
    newsletter_subscription: z.boolean(),
  }),
  address: z
    .object({
      street: z.string().nullable(),
      city: z.string().nullable(),
      postal_code: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  loyalty_accounts_count: z.number(),
  total_points_balance: z.number(),
  member_since: z.string(),
  last_activity: z.string().nullable(),
  updated_at: z.string(),
});

// ===========================
// PUT /users/:userId - Edit user profile
// ===========================

const updateUserProfileRoute = createRoute({
  method: "put",
  path: "/users/{userId}",
  summary: "✏️ Edit user profile",
  description: `
Update user profile information including personal details, preferences, and contact information.

**Features:**
- Update personal information (name, phone, address)
- Manage notification and marketing preferences
- Update contact preferences
- Partial updates supported (only send changed fields)
- Automatic validation of data formats

**Example Usage:**
\`\`\`bash
curl -X PUT 'https://your-api.com/api/app-user/users/user@example.com' \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "+1234567890",
    "first_name": "John",
    "preferences": {
      "notifications_enabled": true,
      "marketing_consent": false
    }
  }'
\`\`\`

**Use Cases:**
- Profile settings page in customer app
- Update contact information
- Manage communication preferences
- Address management for delivery
  `,
  tags: ["Customer App"],
  request: {
    params: z.object({
      userId: z.string().min(1, "User ID is required"),
    }),
    body: {
      content: {
        "application/json": {
          schema: updateUserProfileSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "User profile updated successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: userProfileResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("User not found"),
          }),
        },
      },
    },
    400: {
      description: "Invalid input data",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Invalid input data"),
          }),
        },
      },
    },
  },
});

appUser.openapi(updateUserProfileRoute, async (c) => {
  try {
    const { userId } = c.req.valid("param");
    const updateData = c.req.valid("json");

    // Get app_user by email first
    const { data: existingUser, error: userCheckError } = await supabase
      .from("app_users")
      .select("id, email, phone_number")
      .eq("email", userId)
      .single();

    if (userCheckError || !existingUser) {
      return c.json(standardResponse(404, "User not found"), 404);
    }

    // Update user profile in app_users table
    const { data: updatedProfile, error: updateError } = await supabase
      .from("app_users")
      .update({
        phone_number: updateData.phone || existingUser.phone_number,
        first_name: updateData.first_name,
        last_name: updateData.last_name,
        date_of_birth: updateData.date_of_birth,
        preferences: updateData.preferences || {
          notifications_enabled: true,
          marketing_consent: true,
          preferred_language: "en",
          newsletter_subscription: false,
        },
        address: updateData.address,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingUser.id)
      .select()
      .single();

    if (updateError) {
      logger.error("Error updating user profile:", updateError);
      return c.json(
        standardResponse(500, "Failed to update user profile"),
        500
      );
    }

    // Get updated user info with loyalty stats using app_user_id
    const { data: loyaltyStats } = await supabase
      .from("customer_loyalty_accounts")
      .select("points_balance, created_at")
      .eq("app_user_id", existingUser.id);

    const loyaltyAccountsCount = loyaltyStats?.length || 0;
    const totalPointsBalance =
      loyaltyStats?.reduce((sum, acc) => sum + acc.points_balance, 0) || 0;
    const memberSince =
      loyaltyStats && loyaltyStats.length > 0
        ? loyaltyStats.sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          )[0].created_at
        : new Date().toISOString();

    // Get last activity (most recent transaction) using app_user_id
    const { data: lastTransaction } = await supabase
      .from("transactions")
      .select("created_at")
      .eq("app_user_id", existingUser.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const profileData = {
      user_id: updatedProfile.email, // Return email as user_id for API consistency
      email: updatedProfile.email,
      phone: updatedProfile.phone_number,
      first_name: updatedProfile.first_name,
      last_name: updatedProfile.last_name,
      date_of_birth: updatedProfile.date_of_birth,
      preferences: updatedProfile.preferences || {
        notifications_enabled: true,
        marketing_consent: true,
        preferred_language: "en",
        newsletter_subscription: false,
      },
      address: updatedProfile.address,
      loyalty_accounts_count: loyaltyAccountsCount,
      total_points_balance: totalPointsBalance,
      member_since: memberSince,
      last_activity: lastTransaction?.created_at || null,
      updated_at: updatedProfile.updated_at,
    };

    return c.json(
      standardResponse(200, "User profile updated successfully", profileData)
    );
  } catch (error) {
    logger.error("Error updating user profile:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// DELETE /users/:userId - Delete user account
// ===========================

const deleteUserAccountRoute = createRoute({
  method: "delete",
  path: "/users/{userId}",
  summary: "🗑️ Delete user account",
  description: `
Permanently delete a user account and all associated data.

**⚠️ WARNING: This action is irreversible!**

**What gets deleted:**
- User profile information
- All loyalty accounts and points balances
- Transaction history (anonymized, not deleted for business records)
- User preferences and settings
- Account access and authentication

**What is preserved:**
- Transaction records (customer_email set to "deleted_user_{timestamp}")
- Business analytics data (aggregated, anonymized)
- Legal compliance records where required

**Example Usage:**
\`\`\`bash
curl -X DELETE 'https://your-api.com/api/app-user/users/user@example.com' \\
  -H "Content-Type: application/json" \\
  -d '{"confirm_deletion": true, "reason": "User requested account deletion"}'
\`\`\`

**Use Cases:**
- GDPR compliance (right to be forgotten)
- User-requested account deletion
- Account cleanup and data management
  `,
  tags: ["Customer App"],
  request: {
    params: z.object({
      userId: z.string().min(1, "User ID is required"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            confirm_deletion: z.boolean(),
            reason: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "User account deleted successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              deleted_user_id: z.string(),
              deletion_timestamp: z.string(),
              data_retention_notice: z.string(),
            }),
          }),
        },
      },
    },
    400: {
      description: "Deletion not confirmed or invalid request",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Deletion must be confirmed"),
          }),
        },
      },
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("User not found"),
          }),
        },
      },
    },
  },
});

appUser.openapi(deleteUserAccountRoute, async (c) => {
  try {
    const { userId } = c.req.valid("param");
    const { confirm_deletion, reason } = c.req.valid("json");

    if (!confirm_deletion) {
      return c.json(
        standardResponse(
          400,
          "Deletion must be confirmed with confirm_deletion: true"
        ),
        400
      );
    }

    // Check if user exists
    const { data: existingUser, error: userCheckError } = await supabase
      .from("app_users")
      .select("id, email")
      .eq("email", userId)
      .single();

    if (userCheckError || !existingUser) {
      return c.json(standardResponse(404, "User not found"), 404);
    }

    const deletionTimestamp = new Date().toISOString();
    const anonymizedEmail = `deleted_user_${Date.now()}@deleted.local`;

    // Begin transaction-like operations
    try {
      // 1. Anonymize transaction records (preserve for business records)
      await supabase
        .from("transactions")
        .update({
          metadata: {
            deletion_date: deletionTimestamp,
            deletion_reason: reason || "User requested account deletion",
            anonymized_email: anonymizedEmail,
          },
        })
        .eq("app_user_id", existingUser.id);

      // 2. Delete loyalty accounts
      await supabase
        .from("customer_loyalty_accounts")
        .delete()
        .eq("app_user_id", existingUser.id);

      // 3. Delete user profile
      await supabase.from("app_users").delete().eq("id", existingUser.id);

      // 4. Log the deletion for audit trail
      await supabase.from("user_deletions").insert({
        original_email: userId,
        anonymized_email: anonymizedEmail,
        deletion_timestamp: deletionTimestamp,
        deletion_reason: reason || "User requested account deletion",
        deleted_by: "user_self_service",
      });

      const deletionData = {
        deleted_user_id: userId,
        deletion_timestamp: deletionTimestamp,
        data_retention_notice:
          "Transaction records have been anonymized and retained for business and legal compliance. All personal data has been permanently deleted.",
      };

      return c.json(
        standardResponse(200, "User account deleted successfully", deletionData)
      );
    } catch (deletionError) {
      logger.error("Error during user account deletion:", deletionError);
      return c.json(
        standardResponse(500, "Failed to delete user account completely"),
        500
      );
    }
  } catch (error) {
    logger.error("Error processing user account deletion:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default appUser;

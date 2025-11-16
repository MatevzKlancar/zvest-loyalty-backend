import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";

export const productsAnalyticsController = new OpenAPIHono<UnifiedAuthContext>();

// Product analytics schema
const productAnalyticsSchema = z.object({
  product_id: z.string(),
  pos_article_id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  units_sold: z.number(),
  total_revenue: z.number(),
  avg_price: z.number(),
  transaction_count: z.number(),
  rank: z.number(),
  performance: z.enum(["best_seller", "good", "average", "slow", "dead_stock"]),
  last_sold: z.string().nullable(),
  days_since_last_sale: z.number().nullable(),
});

// Get product sales analytics
const getProductAnalyticsRoute = createRoute({
  method: "get",
  path: "/analytics/products",
  summary: "Get product sales analytics",
  description: "Analyze product performance including best sellers, slow movers, and dead stock",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      period: z.string().optional().describe("Time period: 7d, 30d, 90d, all"),
      category: z.string().optional(),
      sort_by: z.string().optional().describe("Sort by: units_sold, revenue, last_sold"),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Product analytics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              summary: z.object({
                total_products: z.number(),
                products_sold_in_period: z.number(),
                total_units_sold: z.number(),
                total_revenue: z.number(),
                avg_basket_size: z.number(),
                best_seller_threshold: z.number(),
              }),
              products: z.array(productAnalyticsSchema),
              categories: z.array(z.object({
                category: z.string(),
                units_sold: z.number(),
                revenue: z.number(),
                product_count: z.number(),
              })),
              performance_breakdown: z.object({
                best_sellers: z.number(),
                good_performers: z.number(),
                average_performers: z.number(),
                slow_movers: z.number(),
                dead_stock: z.number(),
              }),
              frequently_bought_together: z.array(z.object({
                product_1: z.string(),
                product_2: z.string(),
                frequency: z.number(),
              })),
            }),
          }),
        },
      },
    },
  },
});

productsAnalyticsController.openapi(getProductAnalyticsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const {
      period = "30d",
      category,
      sort_by = "units_sold",
      limit = "50"
    } = c.req.valid("query");

    // Parse period
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 9999;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all articles for the shop
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select("id, pos_article_id, name, category")
      .eq("shop_id", shop.id);

    if (articlesError) {
      logger.error("Failed to fetch articles:", articlesError);
      return c.json(standardResponse(500, "Failed to fetch product analytics"), 500);
    }

    // Get transactions with items for the period
    let transactionQuery = supabase
      .from("transactions")
      .select("id, items, created_at, total_amount, status")
      .eq("shop_id", shop.id)
      .neq("status", "cancelled")
      .gte("created_at", startDate.toISOString());

    const { data: transactions, error: transError } = await transactionQuery;

    if (transError) {
      logger.error("Failed to fetch transactions:", transError);
      return c.json(standardResponse(500, "Failed to fetch product analytics"), 500);
    }

    // Process line items to calculate product metrics
    const productMetrics: Map<string, {
      pos_article_id: string;
      name: string;
      category: string | null;
      units_sold: number;
      total_revenue: number;
      transaction_count: number;
      last_sold: Date | null;
      transactions: string[];
    }> = new Map();

    // Initialize metrics for all products
    articles?.forEach(article => {
      productMetrics.set(article.pos_article_id, {
        pos_article_id: article.pos_article_id,
        name: article.name,
        category: article.category,
        units_sold: 0,
        total_revenue: 0,
        transaction_count: 0,
        last_sold: null,
        transactions: [],
      });
    });

    // Process transactions to extract line items
    const basketAnalysis: Map<string, string[]> = new Map();

    transactions?.forEach(transaction => {
      if (!transaction.items || !Array.isArray(transaction.items)) return;

      const transactionDate = new Date(transaction.created_at);
      const productIds: string[] = [];

      transaction.items.forEach((item: any) => {
        const productId = item.pos_article_id || item.article_id;
        if (!productId) return;

        productIds.push(productId);

        if (!productMetrics.has(productId)) {
          // Product not in articles table, create entry from transaction data
          productMetrics.set(productId, {
            pos_article_id: productId,
            name: item.name || productId,
            category: item.category || null,
            units_sold: 0,
            total_revenue: 0,
            transaction_count: 0,
            last_sold: null,
            transactions: [],
          });
        }

        const metrics = productMetrics.get(productId)!;
        metrics.units_sold += item.quantity || 1;
        metrics.total_revenue += item.total_price || (item.unit_price * (item.quantity || 1));
        metrics.transaction_count += 1;
        metrics.transactions.push(transaction.id);

        if (!metrics.last_sold || transactionDate > metrics.last_sold) {
          metrics.last_sold = transactionDate;
        }
      });

      // Store basket for frequently bought together analysis
      if (productIds.length > 1) {
        basketAnalysis.set(transaction.id, productIds);
      }
    });

    // Calculate frequently bought together
    const pairFrequency: Map<string, number> = new Map();
    basketAnalysis.forEach(products => {
      for (let i = 0; i < products.length; i++) {
        for (let j = i + 1; j < products.length; j++) {
          const pair = [products[i], products[j]].sort().join('|');
          pairFrequency.set(pair, (pairFrequency.get(pair) || 0) + 1);
        }
      }
    });

    const frequentPairs = Array.from(pairFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pair, frequency]) => {
        const [product1, product2] = pair.split('|');
        const name1 = productMetrics.get(product1)?.name || product1;
        const name2 = productMetrics.get(product2)?.name || product2;
        return {
          product_1: name1,
          product_2: name2,
          frequency,
        };
      });

    // Convert to array and calculate performance
    const now = new Date();
    const productsArray = Array.from(productMetrics.values())
      .filter(p => category ? p.category === category : true)
      .map(product => {
        const daysSinceLastSale = product.last_sold
          ? Math.floor((now.getTime() - product.last_sold.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        const avgPrice = product.units_sold > 0
          ? product.total_revenue / product.units_sold
          : 0;

        return {
          ...product,
          avg_price: Math.round(avgPrice * 100) / 100,
          total_revenue: Math.round(product.total_revenue * 100) / 100,
          last_sold: product.last_sold?.toISOString() || null,
          days_since_last_sale: daysSinceLastSale,
          transactions: undefined, // Remove internal field
        };
      });

    // Sort products
    productsArray.sort((a, b) => {
      switch (sort_by) {
        case "revenue":
          return b.total_revenue - a.total_revenue;
        case "last_sold":
          const aTime = a.last_sold ? new Date(a.last_sold).getTime() : 0;
          const bTime = b.last_sold ? new Date(b.last_sold).getTime() : 0;
          return bTime - aTime;
        default: // units_sold
          return b.units_sold - a.units_sold;
      }
    });

    // Determine performance categories
    const totalUnits = productsArray.reduce((sum, p) => sum + p.units_sold, 0);
    const avgUnitsPerProduct = totalUnits / Math.max(productsArray.length, 1);

    const rankedProducts = productsArray.map((product, index) => {
      let performance: "best_seller" | "good" | "average" | "slow" | "dead_stock";

      if (product.units_sold === 0 || product.days_since_last_sale === null) {
        performance = "dead_stock";
      } else if (product.days_since_last_sale && product.days_since_last_sale > 30) {
        performance = "slow";
      } else if (product.units_sold > avgUnitsPerProduct * 2) {
        performance = "best_seller";
      } else if (product.units_sold > avgUnitsPerProduct) {
        performance = "good";
      } else if (product.units_sold > avgUnitsPerProduct * 0.5) {
        performance = "average";
      } else {
        performance = "slow";
      }

      return {
        product_id: articles?.find(a => a.pos_article_id === product.pos_article_id)?.id || product.pos_article_id,
        ...product,
        rank: index + 1,
        performance,
      };
    });

    // Category breakdown
    const categoryStats: Map<string, {
      units_sold: number;
      revenue: number;
      product_count: number;
    }> = new Map();

    rankedProducts.forEach(product => {
      const cat = product.category || "Uncategorized";
      if (!categoryStats.has(cat)) {
        categoryStats.set(cat, { units_sold: 0, revenue: 0, product_count: 0 });
      }
      const stats = categoryStats.get(cat)!;
      stats.units_sold += product.units_sold;
      stats.revenue += product.total_revenue;
      stats.product_count += 1;
    });

    const categories = Array.from(categoryStats.entries())
      .map(([category, stats]) => ({
        category,
        units_sold: stats.units_sold,
        revenue: Math.round(stats.revenue * 100) / 100,
        product_count: stats.product_count,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Performance breakdown
    const performanceBreakdown = {
      best_sellers: rankedProducts.filter(p => p.performance === "best_seller").length,
      good_performers: rankedProducts.filter(p => p.performance === "good").length,
      average_performers: rankedProducts.filter(p => p.performance === "average").length,
      slow_movers: rankedProducts.filter(p => p.performance === "slow").length,
      dead_stock: rankedProducts.filter(p => p.performance === "dead_stock").length,
    };

    // Calculate summary
    const totalRevenue = rankedProducts.reduce((sum, p) => sum + p.total_revenue, 0);
    const avgBasketSize = transactions?.length > 0
      ? totalUnits / transactions.length
      : 0;

    const analytics = {
      summary: {
        total_products: articles?.length || 0,
        products_sold_in_period: rankedProducts.filter(p => p.units_sold > 0).length,
        total_units_sold: totalUnits,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        avg_basket_size: Math.round(avgBasketSize * 10) / 10,
        best_seller_threshold: Math.round(avgUnitsPerProduct * 2),
      },
      products: rankedProducts.slice(0, parseInt(limit)),
      categories,
      performance_breakdown: performanceBreakdown,
      frequently_bought_together: frequentPairs,
    };

    return c.json(
      standardResponse(200, "Product analytics retrieved successfully", analytics)
    );
  } catch (error) {
    logger.error("Error fetching product analytics:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
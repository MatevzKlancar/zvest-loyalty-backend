import { supabase } from "../config/database";
import { logger } from "../config/logger";
import type { Database } from "../types/database";

type Shop = Database["public"]["Tables"]["shops"]["Row"];
type ShopInsert = Database["public"]["Tables"]["shops"]["Insert"];
type ShopUpdate = Database["public"]["Tables"]["shops"]["Update"];
type Article = Database["public"]["Tables"]["articles"]["Row"];
type ArticleInsert = Database["public"]["Tables"]["articles"]["Insert"];
type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type Coupon = Database["public"]["Tables"]["coupons"]["Row"];

export class POSService {
  async validateCoupon(
    shopId: string,
    couponId: string,
    posProviderId: string
  ) {
    try {
      // First verify the shop belongs to this POS provider and is active
      const { data: shop, error: shopError } = await supabase
        .from("shops")
        .select("id")
        .eq("id", shopId)
        .eq("pos_provider_id", posProviderId)
        .eq("status", "active")
        .single();

      if (shopError || !shop) {
        logger.warn(
          `Shop not found, inactive, or doesn't belong to POS provider: ${shopId}`
        );
        return {
          success: false,
          message: "Shop not found or inactive",
          errorSource: "client" as const,
        };
      }

      // Get and validate the coupon
      const { data: coupon, error: couponError } = await supabase
        .from("coupons")
        .select("*")
        .eq("id", couponId)
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .single();

      if (couponError || !coupon) {
        logger.info(`Coupon not found or inactive: ${couponId}`);
        return {
          success: false,
          message: "Coupon not found or inactive",
          errorSource: "client" as const,
        };
      }

      // Check expiry
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return {
          success: false,
          message: "Coupon has expired",
          errorSource: "client" as const,
        };
      }

      // Check usage limit
      if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
        return {
          success: false,
          message: "Coupon usage limit reached",
          errorSource: "client" as const,
        };
      }

      // Increment usage count
      const { error: updateError } = await supabase
        .from("coupons")
        .update({ used_count: coupon.used_count + 1 })
        .eq("id", couponId);

      if (updateError) {
        logger.error("Failed to update coupon usage:", updateError);
        return {
          success: false,
          message: "Failed to update coupon",
          errorSource: "server" as const,
        };
      }

      logger.info(`Coupon validated successfully: ${couponId}`);
      return {
        success: true,
        message: "Coupon is valid",
        data: {
          type: coupon.type,
          value: coupon.value,
          description: coupon.description,
        },
      };
    } catch (error) {
      logger.error("Error validating coupon:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }

  async getShopsForProvider(posProviderId: string) {
    try {
      const { data: shops, error } = await supabase
        .from("shops")
        .select(
          "id, pos_shop_id, name, description, type, status, pos_synced_at, created_at, updated_at"
        )
        .eq("pos_provider_id", posProviderId)
        .eq("status", "active");

      if (error) {
        logger.error("Failed to fetch shops:", error);
        return {
          success: false,
          message: "Failed to fetch shops",
          errorSource: "server" as const,
        };
      }

      logger.info(
        `Retrieved ${shops.length} active shops for provider: ${posProviderId}`
      );
      return {
        success: true,
        message: "Shops retrieved successfully",
        data: shops,
      };
    } catch (error) {
      logger.error("Error fetching shops:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }

  async syncShop(
    syncData: {
      shop_uuid: string;
      pos_shop_id: string;
      pos_data: any;
    },
    posProviderId: string
  ) {
    try {
      // Check if shop exists and belongs to this POS provider
      const { data: existingShop, error: shopError } = await supabase
        .from("shops")
        .select("*")
        .eq("id", syncData.shop_uuid)
        .eq("pos_provider_id", posProviderId)
        .single();

      if (shopError || !existingShop) {
        logger.warn(
          `Shop not found or doesn't belong to POS provider: ${syncData.shop_uuid}`
        );
        return {
          success: false,
          message: "Shop not found or access denied",
          errorSource: "client" as const,
        };
      }

      // Check if shop is active
      if (existingShop.status !== "active") {
        return {
          success: false,
          message: "Shop is not active",
          errorSource: "client" as const,
        };
      }

      // Check if pos_shop_id is already used by another shop for this provider
      if (existingShop.pos_shop_id !== syncData.pos_shop_id) {
        const { data: duplicateShop } = await supabase
          .from("shops")
          .select("id")
          .eq("pos_provider_id", posProviderId)
          .eq("pos_shop_id", syncData.pos_shop_id)
          .neq("id", syncData.shop_uuid)
          .single();

        if (duplicateShop) {
          return {
            success: false,
            message: "POS shop ID already in use",
            errorSource: "client" as const,
          };
        }
      }

      // Update shop with POS sync data
      const shopUpdate: ShopUpdate = {
        pos_shop_id: syncData.pos_shop_id,
        pos_synced_at: new Date().toISOString(),
        pos_sync_data: syncData.pos_data,
      };

      const { data: updatedShop, error } = await supabase
        .from("shops")
        .update(shopUpdate)
        .eq("id", syncData.shop_uuid)
        .select()
        .single();

      if (error) {
        logger.error("Failed to sync shop:", error);
        return {
          success: false,
          message: "Failed to sync shop",
          errorSource: "server" as const,
        };
      }

      logger.info(`Shop synced successfully: ${updatedShop.id}`);
      return {
        success: true,
        message: "Shop synced successfully",
        data: updatedShop,
      };
    } catch (error) {
      logger.error("Error syncing shop:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }

  async getActiveCouponsForShop(shopId: string, posProviderId: string) {
    try {
      // Verify shop belongs to POS provider and is active
      const { data: shop, error: shopError } = await supabase
        .from("shops")
        .select("id")
        .eq("id", shopId)
        .eq("pos_provider_id", posProviderId)
        .eq("status", "active")
        .single();

      if (shopError || !shop) {
        return {
          success: false,
          message: "Shop not found or inactive",
          errorSource: "client" as const,
        };
      }

      const { data: coupons, error } = await supabase
        .from("coupons")
        .select(
          "id, code, type, value, description, expires_at, usage_limit, used_count"
        )
        .eq("shop_id", shopId)
        .eq("is_active", true);

      if (error) {
        logger.error("Failed to fetch coupons:", error);
        return {
          success: false,
          message: "Failed to fetch coupons",
          errorSource: "server" as const,
        };
      }

      // Filter out expired coupons and those that reached usage limit
      const activeCoupons = coupons.filter((coupon) => {
        const notExpired =
          !coupon.expires_at || new Date(coupon.expires_at) >= new Date();
        const hasUsagesLeft =
          !coupon.usage_limit || coupon.used_count < coupon.usage_limit;
        return notExpired && hasUsagesLeft;
      });

      logger.info(
        `Retrieved ${activeCoupons.length} active coupons for shop: ${shopId}`
      );
      return {
        success: true,
        message: "Coupons retrieved successfully",
        data: activeCoupons,
      };
    } catch (error) {
      logger.error("Error fetching coupons:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }

  async updateShopArticles(
    shopId: string,
    articles: any[],
    posProviderId: string
  ) {
    try {
      // Verify shop belongs to POS provider and is active
      const { data: shop, error: shopError } = await supabase
        .from("shops")
        .select("id")
        .eq("id", shopId)
        .eq("pos_provider_id", posProviderId)
        .eq("status", "active")
        .single();

      if (shopError || !shop) {
        return {
          success: false,
          message: "Shop not found or inactive",
          errorSource: "client" as const,
        };
      }

      // Delete existing articles for this shop
      const { error: deleteError } = await supabase
        .from("articles")
        .delete()
        .eq("shop_id", shopId);

      if (deleteError) {
        logger.error("Failed to delete existing articles:", deleteError);
        return {
          success: false,
          message: "Failed to update articles",
          errorSource: "server" as const,
        };
      }

      // Insert new articles
      const articleInserts: ArticleInsert[] = articles.map((article) => ({
        shop_id: shopId,
        pos_article_id: article.id,
        name: article.name,
        price: article.price,
        description: article.description || null,
        type: article.type || null,
        tax_type: article.tax_type || null,
      }));

      if (articleInserts.length > 0) {
        const { error: insertError } = await supabase
          .from("articles")
          .insert(articleInserts);

        if (insertError) {
          logger.error("Failed to insert new articles:", insertError);
          return {
            success: false,
            message: "Failed to update articles",
            errorSource: "server" as const,
          };
        }
      }

      logger.info(`Updated ${articles.length} articles for shop: ${shopId}`);
      return { success: true, message: "Articles updated successfully" };
    } catch (error) {
      logger.error("Error updating articles:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }

  async createTransaction(
    transactionData: {
      shop_id: string;
      pos_invoice_id: string;
      total_amount: number;
      items: any[];
    },
    posProviderId: string
  ) {
    try {
      // Verify shop belongs to POS provider and is active
      const { data: shop, error: shopError } = await supabase
        .from("shops")
        .select("id")
        .eq("id", transactionData.shop_id)
        .eq("pos_provider_id", posProviderId)
        .eq("status", "active")
        .single();

      if (shopError || !shop) {
        return {
          success: false,
          message: "Shop not found or inactive",
          errorSource: "client" as const,
        };
      }

      // Check if transaction with this invoice ID already exists
      const { data: existingTransaction } = await supabase
        .from("transactions")
        .select("id")
        .eq("pos_invoice_id", transactionData.pos_invoice_id)
        .eq("shop_id", transactionData.shop_id)
        .single();

      if (existingTransaction) {
        return {
          success: false,
          message: "Transaction already exists",
          errorSource: "client" as const,
        };
      }

      const newTransaction: TransactionInsert = {
        shop_id: transactionData.shop_id,
        pos_invoice_id: transactionData.pos_invoice_id,
        total_amount: transactionData.total_amount,
        items: transactionData.items,
      };

      const { data: transaction, error } = await supabase
        .from("transactions")
        .insert(newTransaction)
        .select()
        .single();

      if (error) {
        logger.error("Failed to create transaction:", error);
        return {
          success: false,
          message: "Failed to create transaction",
          errorSource: "server" as const,
        };
      }

      logger.info(`Transaction created successfully: ${transaction.id}`);
      return {
        success: true,
        message: "Transaction created successfully",
        data: transaction,
      };
    } catch (error) {
      logger.error("Error creating transaction:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }
}

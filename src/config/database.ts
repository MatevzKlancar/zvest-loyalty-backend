import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { logger } from "./logger";

// Database connection interface
interface DatabaseConfig {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
}

// Platform database (shared for all platform customers)
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export const supabaseAnon = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY
);

// Database connection manager for multi-tenancy
class DatabaseConnectionManager {
  private connections: Map<string, SupabaseClient> = new Map();

  // Get database connection based on customer type and config
  async getConnection(
    customerId?: string,
    databaseConfig?: any
  ): Promise<SupabaseClient> {
    // If no customer ID or config provided, use platform database
    if (!customerId || !databaseConfig) {
      return supabase;
    }

    // For enterprise customers, create dedicated connection
    const connectionKey = `enterprise_${customerId}`;

    if (!this.connections.has(connectionKey)) {
      try {
        const enterpriseClient = createClient(
          databaseConfig.url,
          databaseConfig.serviceRoleKey,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          }
        );

        this.connections.set(connectionKey, enterpriseClient);
        logger.info(
          `Created enterprise database connection for customer: ${customerId}`
        );
      } catch (error) {
        logger.error(
          `Failed to create enterprise database connection for customer ${customerId}:`,
          error
        );
        // Fallback to platform database
        return supabase;
      }
    }

    return this.connections.get(connectionKey) || supabase;
  }

  // Get connection specifically for a shop
  async getConnectionForShop(
    shopId: string
  ): Promise<{
    client: SupabaseClient;
    customerType: "platform" | "enterprise";
  }> {
    try {
      // First, get shop details including customer info
      const { data: shop, error } = await supabase
        .from("shops")
        .select(
          `
          id,
          customer_id,
          customers (
            id,
            type,
            database_config
          )
        `
        )
        .eq("id", shopId)
        .single();

      if (error || !shop) {
        logger.warn(`Shop not found: ${shopId}`);
        return { client: supabase, customerType: "platform" };
      }

      const customer = shop.customers as any;

      if (customer.type === "enterprise" && customer.database_config) {
        const enterpriseClient = await this.getConnection(
          customer.id,
          customer.database_config
        );
        return { client: enterpriseClient, customerType: "enterprise" };
      }

      return { client: supabase, customerType: "platform" };
    } catch (error) {
      logger.error(
        `Error getting database connection for shop ${shopId}:`,
        error
      );
      return { client: supabase, customerType: "platform" };
    }
  }

  // Close all enterprise connections
  closeAllConnections(): void {
    this.connections.clear();
    logger.info("Closed all enterprise database connections");
  }
}

// Export singleton instance
export const dbConnectionManager = new DatabaseConnectionManager();

// Helper function to get platform database specifically
export const getPlatformDatabase = (): SupabaseClient => supabase;

// Helper function to get database for a specific shop
export const getDatabaseForShop = async (shopId: string) => {
  return await dbConnectionManager.getConnectionForShop(shopId);
};

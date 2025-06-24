export interface Database {
  public: {
    Tables: {
      pos_providers: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          api_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          api_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          api_key?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      shops: {
        Row: {
          id: string;
          pos_provider_id: string;
          pos_shop_id: string | null;
          name: string;
          description: string | null;
          type: string | null;
          status: "pending" | "active" | "suspended";
          approved_by: string | null;
          approved_at: string | null;
          pos_synced_at: string | null;
          pos_sync_data: any | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          pos_provider_id: string;
          pos_shop_id?: string | null;
          name: string;
          description?: string | null;
          type?: string | null;
          status?: "pending" | "active" | "suspended";
          approved_by?: string | null;
          approved_at?: string | null;
          pos_synced_at?: string | null;
          pos_sync_data?: any | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          pos_provider_id?: string;
          pos_shop_id?: string | null;
          name?: string;
          description?: string | null;
          type?: string | null;
          status?: "pending" | "active" | "suspended";
          approved_by?: string | null;
          approved_at?: string | null;
          pos_synced_at?: string | null;
          pos_sync_data?: any | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      articles: {
        Row: {
          id: string;
          shop_id: string;
          pos_article_id: string;
          name: string;
          base_price: number;
          description: string | null;
          category: string | null;
          type: string | null;
          tax_type: string | null;
          tax_rate: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shop_id: string;
          pos_article_id: string;
          name: string;
          base_price: number;
          description?: string | null;
          category?: string | null;
          type?: string | null;
          tax_type?: string | null;
          tax_rate?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          shop_id?: string;
          pos_article_id?: string;
          name?: string;
          base_price?: number;
          description?: string | null;
          category?: string | null;
          type?: string | null;
          tax_type?: string | null;
          tax_rate?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      article_pricing: {
        Row: {
          id: string;
          article_id: string;
          price: number;
          start_time: string | null;
          end_time: string | null;
          start_date: string | null;
          end_date: string | null;
          days_of_week: number[] | null;
          priority: number;
          name: string | null;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          article_id: string;
          price: number;
          start_time?: string | null;
          end_time?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          days_of_week?: number[] | null;
          priority?: number;
          name?: string | null;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          article_id?: string;
          price?: number;
          start_time?: string | null;
          end_time?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          days_of_week?: number[] | null;
          priority?: number;
          name?: string | null;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      loyalty_programs: {
        Row: {
          id: string;
          shop_id: string;
          type: "points" | "stamps";
          name: string;
          description: string | null;
          points_per_euro: number | null;
          stamps_required: number | null;
          reward_description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shop_id: string;
          type: "points" | "stamps";
          name: string;
          description?: string | null;
          points_per_euro?: number | null;
          stamps_required?: number | null;
          reward_description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          shop_id?: string;
          type?: "points" | "stamps";
          name?: string;
          description?: string | null;
          points_per_euro?: number | null;
          stamps_required?: number | null;
          reward_description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      coupons: {
        Row: {
          id: string;
          shop_id: string;
          code: string;
          type: "percentage" | "fixed" | "free_item";
          value: number;
          description: string | null;
          expires_at: string | null;
          usage_limit: number | null;
          used_count: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shop_id: string;
          code: string;
          type: "percentage" | "fixed" | "free_item";
          value: number;
          description?: string | null;
          expires_at?: string | null;
          usage_limit?: number | null;
          used_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          shop_id?: string;
          code?: string;
          type?: "percentage" | "fixed" | "free_item";
          value?: number;
          description?: string | null;
          expires_at?: string | null;
          usage_limit?: number | null;
          used_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      transactions: {
        Row: {
          id: string;
          shop_id: string;
          pos_invoice_id: string;
          total_amount: number;
          items: any; // JSON
          customer_id: string | null;
          loyalty_points_awarded: number | null;
          loyalty_stamps_awarded: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shop_id: string;
          pos_invoice_id: string;
          total_amount: number;
          items: any; // JSON
          customer_id?: string | null;
          loyalty_points_awarded?: number | null;
          loyalty_stamps_awarded?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          shop_id?: string;
          pos_invoice_id?: string;
          total_amount?: number;
          items?: any; // JSON
          customer_id?: string | null;
          loyalty_points_awarded?: number | null;
          loyalty_stamps_awarded?: number | null;
          created_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}

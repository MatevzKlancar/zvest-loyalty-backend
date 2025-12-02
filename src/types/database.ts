export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string | null
          email: string
          first_name: string
          id: string
          is_active: boolean | null
          last_name: string
          role: string
          supabase_user_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name: string
          id?: string
          is_active?: boolean | null
          last_name: string
          role: string
          supabase_user_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          is_active?: boolean | null
          last_name?: string
          role?: string
          supabase_user_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          first_name: string | null
          id: string
          is_verified: boolean | null
          last_name: string | null
          phone_number: string | null
          preferences: Json | null
          push_token: string | null
          reservation_blocked_until: string | null
          reservation_no_show_count: number | null
          updated_at: string | null
          verification_code: string | null
          verification_expires_at: string | null
        }
        Insert: {
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_verified?: boolean | null
          last_name?: string | null
          phone_number?: string | null
          preferences?: Json | null
          push_token?: string | null
          reservation_blocked_until?: string | null
          reservation_no_show_count?: number | null
          updated_at?: string | null
          verification_code?: string | null
          verification_expires_at?: string | null
        }
        Update: {
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_verified?: boolean | null
          last_name?: string | null
          phone_number?: string | null
          preferences?: Json | null
          push_token?: string | null
          reservation_blocked_until?: string | null
          reservation_no_show_count?: number | null
          updated_at?: string | null
          verification_code?: string | null
          verification_expires_at?: string | null
        }
        Relationships: []
      }
      article_pricing: {
        Row: {
          article_id: string
          created_at: string | null
          days_of_week: number[] | null
          description: string | null
          end_date: string | null
          end_time: string | null
          id: string
          is_active: boolean | null
          name: string | null
          price: number
          priority: number | null
          start_date: string | null
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          article_id: string
          created_at?: string | null
          days_of_week?: number[] | null
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          price: number
          priority?: number | null
          start_date?: string | null
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          article_id?: string
          created_at?: string | null
          days_of_week?: number[] | null
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          price?: number
          priority?: number | null
          start_date?: string | null
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_pricing_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_qr_codes: {
        Row: {
          article_id: string
          created_at: string | null
          id: string
          qr_code: string
          shop_id: string
          status: string
          used_at: string | null
        }
        Insert: {
          article_id: string
          created_at?: string | null
          id?: string
          qr_code: string
          shop_id: string
          status?: string
          used_at?: string | null
        }
        Update: {
          article_id?: string
          created_at?: string | null
          id?: string
          qr_code?: string
          shop_id?: string
          status?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_qr_codes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_qr_codes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          base_price: number
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          pos_article_id: string
          shop_id: string
          tax_rate: number | null
          tax_type: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          base_price: number
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          pos_article_id: string
          shop_id: string
          tax_rate?: number | null
          tax_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          base_price?: number
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          pos_article_id?: string
          shop_id?: string
          tax_rate?: number | null
          tax_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          app_user_id: string
          coupon_id: string
          discount_applied: number | null
          id: string
          points_deducted: number | null
          redeemed_at: string | null
          redemption_code: string | null
          status: string | null
          transaction_id: string | null
        }
        Insert: {
          app_user_id: string
          coupon_id: string
          discount_applied?: number | null
          id?: string
          points_deducted?: number | null
          redeemed_at?: string | null
          redemption_code?: string | null
          status?: string | null
          transaction_id?: string | null
        }
        Update: {
          app_user_id?: string
          coupon_id?: string
          discount_applied?: number | null
          id?: string
          points_deducted?: number | null
          redeemed_at?: string | null
          redemption_code?: string | null
          status?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          articles_data: Json
          created_at: string | null
          description: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          points_required: number | null
          shop_id: string
          type: string
          updated_at: string | null
          used_count: number | null
        }
        Insert: {
          articles_data: Json
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          points_required?: number | null
          shop_id: string
          type: string
          updated_at?: string | null
          used_count?: number | null
        }
        Update: {
          articles_data?: Json
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          points_required?: number | null
          shop_id?: string
          type?: string
          updated_at?: string | null
          used_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_loyalty_accounts: {
        Row: {
          app_user_id: string
          created_at: string | null
          id: string
          invoice_count: number | null
          is_active: boolean | null
          last_visit_at: string | null
          points_balance: number | null
          shop_id: string
          total_points_earned: number | null
          total_points_redeemed: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          app_user_id: string
          created_at?: string | null
          id?: string
          invoice_count?: number | null
          is_active?: boolean | null
          last_visit_at?: string | null
          points_balance?: number | null
          shop_id: string
          total_points_earned?: number | null
          total_points_redeemed?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          app_user_id?: string
          created_at?: string | null
          id?: string
          invoice_count?: number | null
          is_active?: boolean | null
          last_visit_at?: string | null
          points_balance?: number | null
          shop_id?: string
          total_points_earned?: number | null
          total_points_redeemed?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_loyalty_accounts_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_loyalty_accounts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          database_config: Json | null
          id: string
          is_active: boolean | null
          name: string
          settings: Json | null
          subscription_tier: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          database_config?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          settings?: Json | null
          subscription_tier?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          database_config?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          settings?: Json | null
          subscription_tier?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_programs: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          points_per_euro: number | null
          reward_description: string | null
          reward_value: number | null
          shop_id: string
          stamps_required: number | null
          type: string
          updated_at: string | null
          visits_required: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          points_per_euro?: number | null
          reward_description?: string | null
          reward_value?: number | null
          shop_id: string
          stamps_required?: number | null
          type: string
          updated_at?: string | null
          visits_required?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          points_per_euro?: number | null
          reward_description?: string | null
          reward_value?: number | null
          shop_id?: string
          stamps_required?: number | null
          type?: string
          updated_at?: string | null
          visits_required?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_programs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          created_at: string | null
          data: Json | null
          id: string
          is_active: boolean | null
          name: string
          shop_id: string
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          data?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          shop_id: string
          title: string
          type: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          data?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          shop_id?: string
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_providers: {
        Row: {
          api_key: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          api_key: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      push_notifications: {
        Row: {
          app_user_id: string | null
          body: string
          created_at: string | null
          data: Json | null
          error_message: string | null
          expo_ticket_id: string | null
          id: string
          notification_type: string
          sent_at: string | null
          shop_id: string | null
          status: string | null
          title: string
        }
        Insert: {
          app_user_id?: string | null
          body: string
          created_at?: string | null
          data?: Json | null
          error_message?: string | null
          expo_ticket_id?: string | null
          id?: string
          notification_type: string
          sent_at?: string | null
          shop_id?: string | null
          status?: string | null
          title: string
        }
        Update: {
          app_user_id?: string | null
          body?: string
          created_at?: string | null
          data?: Json | null
          error_message?: string | null
          expo_ticket_id?: string | null
          id?: string
          notification_type?: string
          sent_at?: string | null
          shop_id?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notifications_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_notifications_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          app_user_id: string
          created_at: string | null
          device_info: Json | null
          expo_push_token: string
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          app_user_id: string
          created_at?: string | null
          device_info?: Json | null
          expo_push_token: string
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          app_user_id?: string
          created_at?: string | null
          device_info?: Json | null
          expo_push_token?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_availability: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean | null
          resource_id: string | null
          shop_id: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean | null
          resource_id?: string | null
          shop_id: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean | null
          resource_id?: string | null
          shop_id?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_availability_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "reservation_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_availability_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_blocks: {
        Row: {
          block_type: string | null
          created_at: string | null
          end_datetime: string
          id: string
          reason: string | null
          resource_id: string | null
          shop_id: string
          start_datetime: string
        }
        Insert: {
          block_type?: string | null
          created_at?: string | null
          end_datetime: string
          id?: string
          reason?: string | null
          resource_id?: string | null
          shop_id: string
          start_datetime: string
        }
        Update: {
          block_type?: string | null
          created_at?: string | null
          end_datetime?: string
          id?: string
          reason?: string | null
          resource_id?: string | null
          shop_id?: string
          start_datetime?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_blocks_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "reservation_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_blocks_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_reminders: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          reservation_id: string
          scheduled_for: string
          sent_at: string | null
          status: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          reservation_id: string
          scheduled_for: string
          sent_at?: string | null
          status?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          reservation_id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_reminders_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_resource_services: {
        Row: {
          created_at: string | null
          duration_override: number | null
          id: string
          is_active: boolean | null
          price_override: number | null
          resource_id: string
          service_id: string
        }
        Insert: {
          created_at?: string | null
          duration_override?: number | null
          id?: string
          is_active?: boolean | null
          price_override?: number | null
          resource_id: string
          service_id: string
        }
        Update: {
          created_at?: string | null
          duration_override?: number | null
          id?: string
          is_active?: boolean | null
          price_override?: number | null
          resource_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_resource_services_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "reservation_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_resource_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "reservation_services"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_resources: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          shop_id: string
          sort_order: number | null
          specialties: Json | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          shop_id: string
          sort_order?: number | null
          specialties?: Json | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          shop_id?: string
          sort_order?: number | null
          specialties?: Json | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_resources_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_services: {
        Row: {
          capacity: number | null
          created_at: string | null
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean | null
          name: string
          price: number | null
          requires_resource: boolean | null
          shop_id: string
          sort_order: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          price?: number | null
          requires_resource?: boolean | null
          shop_id: string
          sort_order?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          capacity?: number | null
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number | null
          requires_resource?: boolean | null
          shop_id?: string
          sort_order?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_services_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          app_user_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmation_mode: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          customer_notes: string | null
          end_time: string | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          internal_notes: string | null
          metadata: Json | null
          no_show_marked_at: string | null
          no_show_marked_by: string | null
          party_size: number | null
          price: number | null
          resource_id: string | null
          service_id: string
          shop_id: string
          start_time: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          app_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmation_mode?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          customer_notes?: string | null
          end_time?: string | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          internal_notes?: string | null
          metadata?: Json | null
          no_show_marked_at?: string | null
          no_show_marked_by?: string | null
          party_size?: number | null
          price?: number | null
          resource_id?: string | null
          service_id: string
          shop_id: string
          start_time: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          app_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmation_mode?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          customer_notes?: string | null
          end_time?: string | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          internal_notes?: string | null
          metadata?: Json | null
          no_show_marked_at?: string | null
          no_show_marked_by?: string | null
          party_size?: number | null
          price?: number | null
          resource_id?: string | null
          service_id?: string
          shop_id?: string
          start_time?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "reservation_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "reservation_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_owner_invitations: {
        Row: {
          completed_at: string | null
          created_at: string | null
          email: string
          expires_at: string
          first_name: string
          id: string
          invitation_token: string
          invited_by: string | null
          invited_by_admin: string | null
          last_name: string
          phone: string | null
          shop_id: string
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          email: string
          expires_at: string
          first_name: string
          id?: string
          invitation_token: string
          invited_by?: string | null
          invited_by_admin?: string | null
          last_name: string
          phone?: string | null
          shop_id: string
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          first_name?: string
          id?: string
          invitation_token?: string
          invited_by?: string | null
          invited_by_admin?: string | null
          last_name?: string
          phone?: string | null
          shop_id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_owner_invitations_invited_by_admin_fkey"
            columns: ["invited_by_admin"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_owner_invitations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string | null
          approved_at: string | null
          approved_by: string | null
          brand_color: string | null
          created_at: string | null
          customer_id: string
          description: string | null
          email: string | null
          external_qr_codes_enabled: boolean | null
          id: string
          image_url: string | null
          loyalty_type: string | null
          name: string
          opening_hours: string | null
          owner_user_id: string | null
          phone: string | null
          points_per_euro: number | null
          pos_provider_id: string
          pos_shop_id: string | null
          pos_sync_data: Json | null
          pos_synced_at: string | null
          qr_display_text: string | null
          reservation_settings: Json | null
          reservations_enabled: boolean | null
          settings: Json | null
          shop_category: string | null
          social_media: Json | null
          status: string | null
          tag: string | null
          type: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          brand_color?: string | null
          created_at?: string | null
          customer_id: string
          description?: string | null
          email?: string | null
          external_qr_codes_enabled?: boolean | null
          id?: string
          image_url?: string | null
          loyalty_type?: string | null
          name: string
          opening_hours?: string | null
          owner_user_id?: string | null
          phone?: string | null
          points_per_euro?: number | null
          pos_provider_id: string
          pos_shop_id?: string | null
          pos_sync_data?: Json | null
          pos_synced_at?: string | null
          qr_display_text?: string | null
          reservation_settings?: Json | null
          reservations_enabled?: boolean | null
          settings?: Json | null
          shop_category?: string | null
          social_media?: Json | null
          status?: string | null
          tag?: string | null
          type?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          brand_color?: string | null
          created_at?: string | null
          customer_id?: string
          description?: string | null
          email?: string | null
          external_qr_codes_enabled?: boolean | null
          id?: string
          image_url?: string | null
          loyalty_type?: string | null
          name?: string
          opening_hours?: string | null
          owner_user_id?: string | null
          phone?: string | null
          points_per_euro?: number | null
          pos_provider_id?: string
          pos_shop_id?: string | null
          pos_sync_data?: Json | null
          pos_synced_at?: string | null
          qr_display_text?: string | null
          reservation_settings?: Json | null
          reservations_enabled?: boolean | null
          settings?: Json | null
          shop_category?: string | null
          social_media?: Json | null
          status?: string | null
          tag?: string | null
          type?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shops_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shops_pos_provider_id_fkey"
            columns: ["pos_provider_id"]
            isOneToOne: false
            referencedRelation: "pos_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          performed_by: string | null
          transaction_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          performed_by?: string | null
          transaction_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          performed_by?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          app_user_id: string | null
          coupon_used_id: string | null
          created_at: string | null
          discount_amount: number | null
          id: string
          items: Json
          loyalty_account_id: string | null
          loyalty_points_awarded: number | null
          loyalty_stamps_awarded: number | null
          metadata: Json | null
          pos_invoice_id: string
          qr_code_data: string | null
          qr_scanned_at: string | null
          shop_id: string
          status: string | null
          tax_amount: number | null
          total_amount: number
          transaction_number: number
          updated_at: string | null
        }
        Insert: {
          app_user_id?: string | null
          coupon_used_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          items: Json
          loyalty_account_id?: string | null
          loyalty_points_awarded?: number | null
          loyalty_stamps_awarded?: number | null
          metadata?: Json | null
          pos_invoice_id: string
          qr_code_data?: string | null
          qr_scanned_at?: string | null
          shop_id: string
          status?: string | null
          tax_amount?: number | null
          total_amount: number
          transaction_number?: number
          updated_at?: string | null
        }
        Update: {
          app_user_id?: string | null
          coupon_used_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          items?: Json
          loyalty_account_id?: string | null
          loyalty_points_awarded?: number | null
          loyalty_stamps_awarded?: number | null
          metadata?: Json | null
          pos_invoice_id?: string
          qr_code_data?: string | null
          qr_scanned_at?: string | null
          shop_id?: string
          status?: string | null
          tax_amount?: number | null
          total_amount?: number
          transaction_number?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_coupon_used_id_fkey"
            columns: ["coupon_used_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_loyalty_account_id_fkey"
            columns: ["loyalty_account_id"]
            isOneToOne: false
            referencedRelation: "customer_loyalty_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_qr_code_data: {
        Args: { shop_id: string; transaction_id: string }
        Returns: string
      }
      get_current_article_price: {
        Args: { p_article_id: string; p_check_time?: string }
        Returns: number
      }
      get_shop_current_pricing: {
        Args: { p_check_time?: string; p_shop_id: string }
        Returns: {
          active_pricing_rule: string
          base_price: number
          current_price: number
          id: string
          name: string
          pos_article_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

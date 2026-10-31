/**
 * Typed shape of the BookishBae Postgres schema.
 *
 * Hand-maintained to match `supabase/migrations/*.sql`. When you change a
 * migration, change this file in the same commit — the Supabase client derives
 * all of its inference from here, so a drift shows up as silently wrong types
 * rather than a compile error.
 *
 * You can regenerate it instead once the project exists:
 *   npx supabase gen types typescript --project-id <ref> --schema public
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'customer' | 'admin';
export type ProductStatus = 'draft' | 'published' | 'archived';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
export type PaymentStatus =
  | 'created'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';
export type DiscountType = 'percent' | 'flat';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type DownloadKind = 'full' | 'sample' | 'watermarked';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          phone: string | null;
          role: UserRole;
          marketing_opt_in: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          phone?: string | null;
          role?: UserRole;
          marketing_opt_in?: boolean;
          notes?: string | null;
        };
        Update: {
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          phone?: string | null;
          role?: UserRole;
          marketing_opt_in?: boolean;
          notes?: string | null;
        };
        Relationships: [];
      };

      categories: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          sort_order?: number;
        };
        Update: {
          slug?: string;
          name?: string;
          description?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };

      products: {
        Row: {
          id: string;
          slug: string;
          title: string;
          subtitle: string | null;
          description: string;
          excerpt: string | null;
          author_name: string;
          category_id: string | null;
          sample_preview: Json;
          price_paise: number;
          discount_price_paise: number | null;
          currency: string;
          cover_key: string | null;
          cover_width: number | null;
          cover_height: number | null;
          cover_alt: string | null;
          /** PRIVATE bucket key. Service role only — never select this from the browser. */
          sample_pdf_key: string | null;
          /** PRIVATE bucket key. Service role only — never select this from the browser. */
          main_pdf_key: string | null;
          main_pdf_bytes: number | null;
          main_pdf_sha256: string | null;
          page_count: number | null;
          language: string;
          isbn: string | null;
          status: ProductStatus;
          is_featured: boolean;
          watermark_enabled: boolean;
          download_limit: number;
          sales_count: number;
          rating_avg: number | null;
          rating_count: number;
          meta_title: string | null;
          meta_description: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          subtitle?: string | null;
          description?: string;
          excerpt?: string | null;
          author_name?: string;
          category_id?: string | null;
          sample_preview?: Json;
          price_paise: number;
          discount_price_paise?: number | null;
          currency?: string;
          cover_key?: string | null;
          cover_width?: number | null;
          cover_height?: number | null;
          cover_alt?: string | null;
          sample_pdf_key?: string | null;
          main_pdf_key?: string | null;
          main_pdf_bytes?: number | null;
          main_pdf_sha256?: string | null;
          page_count?: number | null;
          language?: string;
          isbn?: string | null;
          status?: ProductStatus;
          is_featured?: boolean;
          watermark_enabled?: boolean;
          download_limit?: number;
          meta_title?: string | null;
          meta_description?: string | null;
          published_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };

      coupon_products: {
        Row: { coupon_id: string; product_id: string };
        Insert: { coupon_id: string; product_id: string };
        Update: never;
        Relationships: [];
      };
      coupons: {
        Row: {
          id: string;
          code: string;
          description: string | null;
          discount_type: DiscountType;
          discount_value: number;
          max_discount_paise: number | null;
          min_order_paise: number;
          usage_limit: number | null;
          usage_limit_per_user: number | null;
          times_used: number;
          starts_at: string;
          expires_at: string | null;
          product_id: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          description?: string | null;
          discount_type: DiscountType;
          discount_value: number;
          max_discount_paise?: number | null;
          min_order_paise?: number;
          usage_limit?: number | null;
          usage_limit_per_user?: number | null;
          starts_at?: string;
          expires_at?: string | null;
          product_id?: string | null;
          is_active?: boolean;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['coupons']['Insert']> & {
          times_used?: number;
        };
        Relationships: [];
      };

      orders: {
        Row: {
          id: string;
          order_number: string;
          user_id: string | null;
          email: string;
          full_name: string | null;
          status: OrderStatus;
          currency: string;
          subtotal_paise: number;
          discount_paise: number;
          total_paise: number;
          coupon_id: string | null;
          coupon_code: string | null;
          razorpay_order_id: string | null;
          ip_hash: string | null;
          user_agent: string | null;
          metadata: Json;
          paid_at: string | null;
          failed_at: string | null;
          refunded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_number?: string;
          user_id?: string | null;
          email: string;
          full_name?: string | null;
          status?: OrderStatus;
          currency?: string;
          subtotal_paise: number;
          discount_paise?: number;
          total_paise: number;
          coupon_id?: string | null;
          coupon_code?: string | null;
          razorpay_order_id?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          metadata?: Json;
          paid_at?: string | null;
          failed_at?: string | null;
          refunded_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
        Relationships: [];
      };

      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          title_snapshot: string;
          slug_snapshot: string;
          unit_price_paise: number;
          quantity: number;
          total_paise: number;
          download_limit: number;
          download_limit_override: number | null;
          downloads_used: number;
          last_downloaded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          title_snapshot: string;
          slug_snapshot: string;
          unit_price_paise: number;
          quantity?: number;
          total_paise: number;
          download_limit?: number;
          download_limit_override?: number | null;
        };
        Update: {
          download_limit?: number;
          download_limit_override?: number | null;
          downloads_used?: number;
          last_downloaded_at?: string | null;
        };
        Relationships: [];
      };

      payments: {
        Row: {
          id: string;
          order_id: string;
          razorpay_payment_id: string;
          razorpay_order_id: string | null;
          status: PaymentStatus;
          method: string | null;
          amount_paise: number;
          currency: string;
          fee_paise: number | null;
          tax_paise: number | null;
          error_code: string | null;
          error_description: string | null;
          refund_id: string | null;
          refunded_amount_paise: number | null;
          gateway_snapshot: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          razorpay_payment_id: string;
          razorpay_order_id?: string | null;
          status: PaymentStatus;
          method?: string | null;
          amount_paise: number;
          currency?: string;
          fee_paise?: number | null;
          tax_paise?: number | null;
          error_code?: string | null;
          error_description?: string | null;
          refund_id?: string | null;
          refunded_amount_paise?: number | null;
          gateway_snapshot?: Json;
        };
        Update: Partial<Database['public']['Tables']['payments']['Insert']>;
        Relationships: [];
      };

      webhook_events: {
        Row: {
          id: string;
          provider: string;
          event_id: string;
          event_type: string;
          payload: Json | null;
          received_at: string;
          processed_at: string | null;
          attempts: number;
          error: string | null;
        };
        Insert: {
          id?: string;
          provider?: string;
          event_id: string;
          event_type: string;
          payload?: Json | null;
          processed_at?: string | null;
          attempts?: number;
          error?: string | null;
        };
        Update: {
          payload?: Json | null;
          processed_at?: string | null;
          attempts?: number;
          error?: string | null;
        };
        Relationships: [];
      };

      downloads: {
        Row: {
          id: string;
          user_id: string | null;
          order_id: string | null;
          order_item_id: string | null;
          product_id: string;
          kind: DownloadKind;
          object_key: string;
          ip_hash: string | null;
          user_agent: string | null;
          succeeded: boolean;
          refusal_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          product_id: string;
          kind?: DownloadKind;
          object_key: string;
          ip_hash?: string | null;
          user_agent?: string | null;
          succeeded?: boolean;
          refusal_reason?: string | null;
        };
        Update: never;
        Relationships: [];
      };

      coupon_redemptions: {
        Row: {
          id: string;
          coupon_id: string;
          order_id: string;
          user_id: string | null;
          email: string;
          discount_paise: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          coupon_id: string;
          order_id: string;
          user_id?: string | null;
          email: string;
          discount_paise: number;
        };
        Update: never;
        Relationships: [];
      };

      reviews: {
        Row: {
          id: string;
          product_id: string;
          user_id: string | null;
          order_id: string | null;
          author_name: string;
          rating: number;
          title: string | null;
          body: string | null;
          status: ReviewStatus;
          is_verified_purchase: boolean;
          moderated_by: string | null;
          moderated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          user_id?: string | null;
          order_id?: string | null;
          author_name: string;
          rating: number;
          title?: string | null;
          body?: string | null;
          status?: ReviewStatus;
          is_verified_purchase?: boolean;
        };
        Update: {
          author_name?: string;
          rating?: number;
          title?: string | null;
          body?: string | null;
          status?: ReviewStatus;
          moderated_by?: string | null;
          moderated_at?: string | null;
        };
        Relationships: [];
      };

      testimonials: {
        Row: {
          id: string;
          author_name: string;
          author_title: string | null;
          avatar_url: string | null;
          quote: string;
          rating: number | null;
          sort_order: number;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_name: string;
          author_title?: string | null;
          avatar_url?: string | null;
          quote: string;
          rating?: number | null;
          sort_order?: number;
          is_published?: boolean;
        };
        Update: Partial<Database['public']['Tables']['testimonials']['Insert']>;
        Relationships: [];
      };

      site_settings: {
        Row: {
          key: string;
          value: Json;
          is_public: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value?: Json;
          is_public?: boolean;
          updated_by?: string | null;
        };
        Update: {
          value?: Json;
          is_public?: boolean;
          updated_by?: string | null;
        };
        Relationships: [];
      };

      newsletter_subscribers: {
        Row: {
          id: string;
          email: string;
          source: string | null;
          confirmed_at: string | null;
          unsubscribed_at: string | null;
          ip_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          source?: string | null;
          confirmed_at?: string | null;
          unsubscribed_at?: string | null;
          ip_hash?: string | null;
        };
        Update: {
          confirmed_at?: string | null;
          unsubscribed_at?: string | null;
        };
        Relationships: [];
      };

      email_log: {
        Row: {
          id: string;
          to_email: string;
          template: string;
          subject: string | null;
          provider_id: string | null;
          order_id: string | null;
          status: 'sent' | 'failed' | 'skipped';
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          to_email: string;
          template: string;
          subject?: string | null;
          provider_id?: string | null;
          order_id?: string | null;
          status?: 'sent' | 'failed' | 'skipped';
          error?: string | null;
        };
        Update: never;
        Relationships: [];
      };

      rate_limits: {
        Row: { bucket: string; window_start: string; count: number };
        Insert: { bucket: string; window_start: string; count?: number };
        Update: { count?: number };
        Relationships: [];
      };
    };

    Views: {
      /** Published products with every R2 object key omitted. Read this, not `products`. */
      products_public: {
        Row: {
          id: string;
          slug: string;
          title: string;
          subtitle: string | null;
          description: string;
          excerpt: string | null;
          author_name: string;
          category_id: string | null;
          category_slug: string | null;
          category_name: string | null;
          price_paise: number;
          discount_price_paise: number | null;
          effective_price_paise: number;
          discount_percent: number;
          currency: string;
          cover_key: string | null;
          cover_width: number | null;
          cover_height: number | null;
          cover_alt: string | null;
          has_sample: boolean;
          page_count: number | null;
          language: string;
          isbn: string | null;
          status: ProductStatus;
          is_featured: boolean;
          sales_count: number;
          rating_avg: number | null;
          rating_count: number;
          meta_title: string | null;
          meta_description: string | null;
          published_at: string | null;
          created_at: string;
        };
        Relationships: [];
      };
    };

    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      set_user_role: {
        Args: { p_user_id: string; p_role: UserRole };
        Returns: Database['public']['Tables']['profiles']['Row'];
      };
      admin_dashboard_stats: { Args: { p_days?: number }; Returns: Json };
      save_coupon: { Args: { p_id: string | null; p_coupon: Json }; Returns: Json };
      delete_coupon: { Args: { p_id: string }; Returns: Json };
      create_checkout_order: { Args: { p_product_id: string; p_email: string; p_full_name: string; p_coupon_code?: string | null; p_user_id?: string | null; p_metadata?: Json; p_ip_hash?: string | null; p_user_agent?: string | null }; Returns: Json };
      mark_order_paid: { Args: { p_order_id: string; p_paid_at?: string }; Returns: Json };
      refund_order: { Args: { p_order_id: string; p_refunded_at?: string }; Returns: Json };
      claim_download: { Args: { p_user_id: string; p_product_id: string }; Returns: Json };
      release_download: { Args: { p_order_item_id: string }; Returns: number };
      validate_coupon: {
        Args: {
          p_code: string;
          p_subtotal_paise: number;
          p_product_id?: string | null;
          p_email?: string | null;
          p_user_id?: string | null;
        };
        Returns: Json;
      };
      consume_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: { allowed: boolean; used: number; remaining: number; reset_at: string }[];
      };
      prune_rate_limits: { Args: { p_older_than?: string }; Returns: number };
      hash_ip: { Args: { p_ip: string; p_salt: string }; Returns: string | null };
    };

    Enums: {
      user_role: UserRole;
      product_status: ProductStatus;
      order_status: OrderStatus;
      payment_status: PaymentStatus;
      discount_type: DiscountType;
      review_status: ReviewStatus;
      download_kind: DownloadKind;
    };

    CompositeTypes: Record<string, never>;
  };
}

// ---------------------------------------------------------------------------
// Convenience aliases used across the app
// ---------------------------------------------------------------------------

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Views<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row'];

export type Profile = Tables<'profiles'>;
export type Category = Tables<'categories'>;
export type Product = Tables<'products'>;
export type PublicProduct = Views<'products_public'>;
export type Coupon = Tables<'coupons'>;
export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type Payment = Tables<'payments'>;
export type Review = Tables<'reviews'>;
export type Testimonial = Tables<'testimonials'>;
export type DownloadLog = Tables<'downloads'>;

// ---------------------------------------------------------------------------
// Shapes returned by the jsonb-returning RPCs. These are contracts with
// 0002_functions.sql; keep them in step with the `jsonb_build_object` calls.
// ---------------------------------------------------------------------------

export type ClaimDownloadResult =
  | {
      allowed: true;
      order_item_id: string;
      order_id: string;
      order_number: string;
      downloads_used: number;
      download_limit: number;
      remaining: number;
    }
  | {
      allowed: false;
      reason: 'not_purchased' | 'limit_reached' | 'bad_request';
      order_item_id?: string;
      downloads_used?: number;
      download_limit?: number;
    };

export type ValidateCouponResult =
  | {
      valid: true;
      coupon_id: string;
      code: string;
      description: string | null;
      discount_type: DiscountType;
      discount_paise: number;
      total_paise: number;
    }
  | {
      valid: false;
      reason:
        | 'bad_request'
        | 'not_found'
        | 'not_started'
        | 'expired'
        | 'exhausted'
        | 'not_applicable'
        | 'below_minimum'
        | 'already_used';
      min_order_paise?: number;
    };

export type MarkOrderPaidResult =
  | {
      ok: true;
      already_paid: boolean;
      order_id: string;
      order_number: string;
      email?: string;
      full_name?: string | null;
      total_paise?: number;
      items?: {
        order_item_id: string;
        product_id: string;
        title: string;
        slug: string;
        unit_price_paise: number;
        quantity: number;
        total_paise: number;
      }[];
    }
  | { ok: false; reason: 'order_not_found' | 'order_refunded' };

export type RefundOrderResult =
  | { ok: true; already_refunded: boolean; order_id: string; order_number?: string; email?: string }
  | { ok: false; reason: 'order_not_found' };

export interface DashboardStats {
  window_days: number;
  generated_at: string;
  all_time: { revenue_paise: number; orders: number; aov_paise: number };
  period: { revenue_paise: number; orders: number; aov_paise: number };
  series: { day: string; revenue_paise: number; orders: number }[];
  top_products: {
    product_id: string;
    title: string;
    slug: string;
    cover_key: string | null;
    units: number;
    revenue_paise: number;
  }[];
  recent_orders: {
    order_id: string;
    order_number: string;
    email: string;
    full_name: string | null;
    total_paise: number;
    status: OrderStatus;
    paid_at: string | null;
    created_at: string;
  }[];
  counts: {
    customers: number;
    products_published: number;
    products_draft: number;
    orders_pending: number;
    orders_failed: number;
    orders_refunded: number;
    reviews_pending: number;
    downloads_total: number;
    downloads_refused: number;
  };
}

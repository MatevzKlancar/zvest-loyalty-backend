import { supabase } from "../config/database";
import { standardResponse } from "./error";

export interface UnifiedAuthContext {
  Variables: {
    userType: "admin" | "shop_owner" | "app_user";
    userRole: "super_admin" | "platform_admin" | "shop_owner" | "customer";
    user: any; // Supabase Auth user
    adminUser?: any; // Admin user data
    shop?: any; // Shop data for shop owners
    appUser?: any; // App user data for customers
  };
}

// Main authentication middleware
export const authenticateUser = async (c: any, next: any) => {
  const authHeader = c.req.header("authorization");

  console.log("🔍 AUTH DEBUG: Authorization header:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("🔍 AUTH DEBUG: Missing or invalid auth header");
    return c.json(standardResponse(401, "Authentication required"), 401);
  }

  const token = authHeader.substring(7);
  console.log(
    "🔍 AUTH DEBUG: Extracted token:",
    token?.substring(0, 20) + "..."
  );

  // Verify Supabase Auth token
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  console.log("🔍 AUTH DEBUG: Supabase auth result:", {
    user: user?.id,
    error: error?.message,
  });

  if (error || !user) {
    console.log("🔍 AUTH DEBUG: Invalid token or user not found");
    return c.json(standardResponse(401, "Invalid token"), 401);
  }

  // Check if user is admin first
  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, role, first_name, last_name, is_active")
    .eq("supabase_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  // Only log admin errors that are not "no rows found"
  if (adminError && adminError.code !== "PGRST116") {
    console.log("🔍 AUTH DEBUG: Admin user lookup error:", {
      supabase_user_id: user.id,
      adminError: adminError?.message,
    });
  }

  if (adminUser) {
    // User is admin
    c.set("userType", "admin");
    c.set("userRole", adminUser.role);
    c.set("adminUser", adminUser);
    c.set("user", user);

    // Admins can also access shop features if they have a shop
    const { data: adminShop } = await supabase
      .from("shops")
      .select("id, name, status")
      .eq("owner_user_id", user.id)
      .eq("status", "active")
      .single();

    if (adminShop) {
      c.set("shop", adminShop);
    }
  } else {
    // Check if user is shop owner
    const { data: shop } = await supabase
      .from("shops")
      .select("id, name, status, email")
      .eq("owner_user_id", user.id)
      .eq("status", "active")
      .single();

    if (shop) {
      // User is shop owner
      c.set("userType", "shop_owner");
      c.set("userRole", "shop_owner");
      c.set("shop", shop);
      c.set("user", user);
    } else {
      // Check if user is app user (customer)
      const { data: appUser } = await supabase
        .from("app_users")
        .select("id, email, first_name, last_name, is_verified")
        .eq("email", user.email)
        .eq("is_verified", true)
        .single();

      if (appUser) {
        // User is verified app user (customer)
        c.set("userType", "app_user");
        c.set("userRole", "customer");
        c.set("appUser", appUser);
        c.set("user", user);
      } else {
        return c.json(
          standardResponse(
            403,
            "Access denied - no active shop, admin, or customer access found"
          ),
          403
        );
      }
    }
  }

  await next();
};

// Require admin access (platform_admin or super_admin)
export const requireAdmin = async (c: any, next: any) => {
  const userType = c.get("userType");
  if (userType !== "admin") {
    return c.json(standardResponse(403, "Admin access required"), 403);
  }
  await next();
};

// Require super admin access
export const requireSuperAdmin = async (c: any, next: any) => {
  const userType = c.get("userType");
  const userRole = c.get("userRole");

  if (userType !== "admin" || userRole !== "super_admin") {
    return c.json(standardResponse(403, "Super admin access required"), 403);
  }
  await next();
};

// Require shop owner access (for shop-specific endpoints)
export const requireShopOwner = async (c: any, next: any) => {
  const shop = c.get("shop");
  if (!shop) {
    return c.json(standardResponse(403, "Shop owner access required"), 403);
  }
  await next();
};

// Require customer access (for app user endpoints)
export const requireCustomer = async (c: any, next: any) => {
  const userType = c.get("userType");
  const appUser = c.get("appUser");

  if (userType !== "app_user" || !appUser) {
    return c.json(standardResponse(403, "Customer access required"), 403);
  }
  await next();
};

// Helper to get user permissions based on role
export const getUserPermissions = (
  userType: string,
  userRole: string
): string[] => {
  const permissions: string[] = [];

  // Base shop owner permissions
  if (userType === "shop_owner" || userType === "admin") {
    permissions.push(
      "view_own_shop",
      "edit_own_shop",
      "manage_own_coupons",
      "view_own_analytics",
      "view_own_transactions"
    );
  }

  // Admin permissions
  if (userType === "admin") {
    permissions.push(
      "create_customers",
      "manage_all_shops",
      "invite_shop_owners",
      "view_all_analytics",
      "manage_invitations",
      "view_system_data"
    );
  }

  // Super admin permissions
  if (userRole === "super_admin") {
    permissions.push(
      "manage_admin_users",
      "system_configuration",
      "view_audit_logs",
      "manage_system_settings"
    );
  }

  // Customer permissions
  if (userType === "app_user") {
    permissions.push(
      "scan_qr_codes",
      "activate_coupons",
      "view_own_transactions",
      "view_own_loyalty_points",
      "manage_own_profile"
    );
  }

  return permissions;
};

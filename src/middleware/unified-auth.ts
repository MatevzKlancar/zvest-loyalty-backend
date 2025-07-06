import { supabase } from "../config/database";
import { standardResponse } from "./error";

export interface UnifiedAuthContext {
  Variables: {
    userType: "admin" | "shop_owner";
    userRole: "super_admin" | "platform_admin" | "shop_owner";
    user: any; // Supabase Auth user
    adminUser?: any; // Admin user data
    shop?: any; // Shop data for shop owners
  };
}

// Main authentication middleware
export const authenticateUser = async (c: any, next: any) => {
  const authHeader = c.req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(standardResponse(401, "Authentication required"), 401);
  }

  const token = authHeader.substring(7);

  // Verify Supabase Auth token
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return c.json(standardResponse(401, "Invalid token"), 401);
  }

  // Check if user is admin first
  const { data: adminUser } = await supabase
    .from("admin_users")
    .select("id, role, first_name, last_name, is_active")
    .eq("supabase_user_id", user.id)
    .eq("is_active", true)
    .single();

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
      return c.json(
        standardResponse(
          403,
          "Access denied - no active shop or admin access found"
        ),
        403
      );
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

  return permissions;
};

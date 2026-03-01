import { OpenAPIHono } from "@hono/zod-openapi";
import { UnifiedAuthContext, authenticateUser, requireShopOwner } from "../../middleware/unified-auth";
import { shopController } from "./shop.controller";
import { couponsController } from "./coupons.controller";
import { analyticsController } from "./analytics.controller";
import { analyticsAdvancedController } from "./analytics-advanced.controller";
import { productsAnalyticsController } from "./products-analytics.controller";
import { transactionsController } from "./transactions.controller";
import { customersController } from "./customers.controller";
import { dashboardController } from "./dashboard.controller";
import { notificationsController } from "./notifications.controller";
import { articleQRCodesController } from "./article-qr-codes.controller";
import { ratingsController } from "./ratings.controller";

const shopAdmin = new OpenAPIHono<UnifiedAuthContext>();

// Apply unified auth middleware to all routes
shopAdmin.use("*", authenticateUser);
shopAdmin.use("*", requireShopOwner);

// Mount sub-routers
shopAdmin.route("/", shopController);
shopAdmin.route("/", couponsController);
shopAdmin.route("/", analyticsController);
shopAdmin.route("/", analyticsAdvancedController);
shopAdmin.route("/", productsAnalyticsController);
shopAdmin.route("/", transactionsController);
shopAdmin.route("/", customersController);
shopAdmin.route("/", dashboardController);
shopAdmin.route("/", notificationsController);
shopAdmin.route("/", articleQRCodesController);
shopAdmin.route("/", ratingsController);

export default shopAdmin;
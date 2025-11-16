import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { logger } from "../config/logger";
import { supabase } from "../config/database";

export class PushNotificationService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo({
      useFcmV1: true, // Use FCM v1 (required for 2025+)
    });
  }

  /**
   * Send notification to specific users by their IDs
   */
  async sendToUsers(
    userIds: string[],
    notification: {
      title: string;
      body: string;
      data?: Record<string, any>;
      shopId?: string;
      notificationType: string;
    }
  ) {
    try {
      // Get active push tokens for users
      const { data: tokens, error: tokenError } = await supabase
        .from("push_tokens")
        .select("expo_push_token, app_user_id")
        .in("app_user_id", userIds)
        .eq("is_active", true);

      if (tokenError) {
        logger.error("Error fetching push tokens", { error: tokenError });
        return { success: false, message: "Error fetching push tokens" };
      }

      if (!tokens || tokens.length === 0) {
        logger.warn("No push tokens found for users", { userIds });
        return { success: false, message: "No push tokens found" };
      }

      // Validate tokens and create messages
      const messages: ExpoPushMessage[] = [];
      const validTokens: typeof tokens = [];

      for (const token of tokens) {
        if (!Expo.isExpoPushToken(token.expo_push_token)) {
          logger.error("Invalid push token", { token: token.expo_push_token });
          // Mark invalid token as inactive
          await supabase
            .from("push_tokens")
            .update({ is_active: false })
            .eq("expo_push_token", token.expo_push_token);
          continue;
        }

        messages.push({
          to: token.expo_push_token,
          sound: "default",
          title: notification.title,
          body: notification.body,
          data: notification.data || {},
          priority: "high",
        });
        validTokens.push(token);
      }

      if (messages.length === 0) {
        return { success: false, message: "No valid push tokens found" };
      }

      // Send notifications in batches (Expo handles max 100 per request)
      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk =
            await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
          logger.info("Sent push notification chunk", {
            count: chunk.length,
          });
        } catch (error) {
          logger.error("Error sending push notification chunk", { error });
        }
      }

      // Store notification records in database
      const notificationRecords = tickets.map((ticket, index) => ({
        app_user_id: validTokens[index]?.app_user_id,
        shop_id: notification.shopId,
        notification_type: notification.notificationType,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        expo_ticket_id: ticket.status === "ok" ? ticket.id : null,
        status: ticket.status === "ok" ? "sent" : "error",
        error_message:
          ticket.status === "error"
            ? (ticket.message ?? "Unknown error")
            : null,
        sent_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from("push_notifications")
        .insert(notificationRecords);

      if (insertError) {
        logger.error("Error saving notification records", {
          error: insertError,
        });
      }

      const successCount = tickets.filter((t) => t.status === "ok").length;
      const failedCount = tickets.filter((t) => t.status === "error").length;

      logger.info("Push notifications sent", {
        total: tickets.length,
        success: successCount,
        failed: failedCount,
      });

      return {
        success: true,
        sent: successCount,
        failed: failedCount,
        total: tickets.length,
      };
    } catch (error) {
      logger.error("Error in sendToUsers", { error });
      return { success: false, message: "Internal error sending notifications" };
    }
  }

  /**
   * Send notification to all customers of a shop
   */
  async sendToShopCustomers(
    shopId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, any>;
      notificationType: string;
    }
  ) {
    try {
      // Get all app users who have loyalty accounts with this shop
      const { data: loyaltyAccounts, error } = await supabase
        .from("customer_loyalty_accounts")
        .select("app_user_id")
        .eq("shop_id", shopId);

      if (error) {
        logger.error("Error fetching loyalty accounts", { error });
        return { success: false, message: "Error fetching customers" };
      }

      if (!loyaltyAccounts || loyaltyAccounts.length === 0) {
        return { success: false, message: "No customers found for shop" };
      }

      const userIds = loyaltyAccounts.map((acc) => acc.app_user_id);
      return this.sendToUsers(userIds, { ...notification, shopId });
    } catch (error) {
      logger.error("Error in sendToShopCustomers", { error });
      return { success: false, message: "Internal error" };
    }
  }

  /**
   * Send birthday notifications to customers whose birthday is today
   */
  async sendBirthdayNotifications() {
    try {
      const today = new Date();
      const todayMonth = today.getMonth() + 1; // JavaScript months are 0-indexed
      const todayDay = today.getDate();

      logger.info("Checking for birthday notifications", {
        month: todayMonth,
        day: todayDay,
      });

      // Get all active birthday notification templates
      const { data: templates, error: templateError } = await supabase
        .from("notification_templates")
        .select("*, shops!inner(id, name)")
        .eq("type", "birthday")
        .eq("is_active", true);

      if (templateError) {
        logger.error("Error fetching birthday templates", {
          error: templateError,
        });
        return;
      }

      if (!templates || templates.length === 0) {
        logger.info("No active birthday notification templates found");
        return;
      }

      // For each shop with birthday notifications enabled
      for (const template of templates) {
        const shopId = template.shop_id;

        // Find customers whose birthday is today in this shop
        const { data: customers, error: customerError } = await supabase
          .from("customer_loyalty_accounts")
          .select("app_user_id, app_users!inner(date_of_birth)")
          .eq("shop_id", shopId);

        if (customerError) {
          logger.error("Error fetching customers for birthday check", {
            error: customerError,
            shopId,
          });
          continue;
        }

        if (!customers || customers.length === 0) {
          continue;
        }

        // Filter customers whose birthday is today
        const birthdayCustomers = customers.filter((customer: any) => {
          if (!customer.app_users?.date_of_birth) return false;

          const dob = new Date(customer.app_users.date_of_birth);
          return (
            dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDay
          );
        });

        if (birthdayCustomers.length === 0) {
          logger.info("No birthdays today for shop", { shopId });
          continue;
        }

        // Send birthday notifications
        const userIds = birthdayCustomers.map((c) => c.app_user_id);
        logger.info("Sending birthday notifications", {
          shopId,
          count: userIds.length,
        });

        await this.sendToUsers(userIds, {
          title: template.title,
          body: template.body,
          data: template.data || {},
          shopId,
          notificationType: "birthday",
        });
      }

      logger.info("Birthday notifications check completed");
    } catch (error) {
      logger.error("Error in sendBirthdayNotifications", { error });
    }
  }

  /**
   * Check receipts for delivered status (run this ~15 minutes after sending)
   */
  async checkReceipts() {
    try {
      // Get notifications with tickets but no delivery confirmation yet
      const { data: pendingNotifications, error } = await supabase
        .from("push_notifications")
        .select("id, expo_ticket_id")
        .eq("status", "sent")
        .not("expo_ticket_id", "is", null)
        .order("sent_at", { ascending: true })
        .limit(1000); // Check up to 1000 at a time

      if (error) {
        logger.error("Error fetching pending notifications", { error });
        return;
      }

      if (!pendingNotifications || pendingNotifications.length === 0) {
        return;
      }

      const ticketIds = pendingNotifications
        .map((n) => n.expo_ticket_id)
        .filter((id): id is string => id !== null);

      if (ticketIds.length === 0) return;

      // Check receipts in chunks
      const chunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);

      for (const chunk of chunks) {
        try {
          const receipts = await this.expo.getPushNotificationReceiptsAsync(
            chunk
          );

          // Update notification records based on receipts
          for (const [ticketId, receipt] of Object.entries(receipts)) {
            if (receipt.status === "ok") {
              await supabase
                .from("push_notifications")
                .update({
                  status: "delivered",
                })
                .eq("expo_ticket_id", ticketId);
            } else if (receipt.status === "error") {
              await supabase
                .from("push_notifications")
                .update({
                  status: "error",
                  error_message: receipt.message ?? "Unknown error",
                })
                .eq("expo_ticket_id", ticketId);

              // Handle DeviceNotRegistered error by deactivating token
              if (receipt.details?.error === "DeviceNotRegistered") {
                logger.warn("Device not registered, deactivating token", {
                  ticketId,
                });
                // Note: We'd need to store the token with the notification to do this properly
                // For now, we'll just log it
              }
            }
          }
        } catch (error) {
          logger.error("Error checking receipts chunk", { error });
        }
      }

      logger.info("Receipt check completed", {
        checked: pendingNotifications.length,
      });
    } catch (error) {
      logger.error("Error in checkReceipts", { error });
    }
  }
}

// Export singleton instance
export const pushNotificationService = new PushNotificationService();

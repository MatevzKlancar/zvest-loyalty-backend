import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { logger } from "../config/logger";
import { supabase } from "../config/database";
import { env } from "../config/env";

const RECIPIENT_PAGE_SIZE = 1000;

type NotificationCategory =
  | "manual"
  | "daily_meal"
  | "specials"
  | "birthday"
  | "coupon_ready"
  | "points_earned";

export class PushNotificationService {
  private expo: Expo;
  private deliveryEnabled: boolean;

  constructor() {
    this.expo = new Expo({
      useFcmV1: true, // Use FCM v1 (required for 2025+)
    });
    this.deliveryEnabled = env.PUSH_NOTIFICATIONS_DELIVERY_ENABLED;
    if (!this.deliveryEnabled) {
      logger.warn(
        "Push notification delivery is DISABLED — messages will be recorded with status='dry_run'. Set PUSH_NOTIFICATIONS_DELIVERY_ENABLED=true to enable."
      );
    }
  }

  /**
   * Send notification to specific users by their IDs.
   * Honours the global PUSH_NOTIFICATIONS_DELIVERY_ENABLED kill switch:
   * when off, builds + records the messages but skips the Expo dispatch.
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

      const messages: ExpoPushMessage[] = [];
      const validTokens: typeof tokens = [];

      for (const token of tokens) {
        if (!Expo.isExpoPushToken(token.expo_push_token)) {
          logger.error("Invalid push token", { token: token.expo_push_token });
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

      // Kill switch: record but do not dispatch.
      if (!this.deliveryEnabled) {
        const dryRunRecords = validTokens.map((token) => ({
          app_user_id: token.app_user_id,
          shop_id: notification.shopId,
          notification_type: notification.notificationType,
          title: notification.title,
          body: notification.body,
          data: notification.data || {},
          expo_push_token: token.expo_push_token,
          expo_ticket_id: null,
          status: "dry_run",
          error_message: null,
          sent_at: new Date().toISOString(),
        }));

        const { error: insertError } = await supabase
          .from("push_notifications")
          .insert(dryRunRecords);

        if (insertError) {
          logger.error("Error saving dry-run notification records", {
            error: insertError,
          });
        }

        logger.info("Push delivery disabled — dry-run recorded", {
          count: validTokens.length,
          notificationType: notification.notificationType,
        });

        return {
          success: true,
          sent: 0,
          failed: 0,
          dryRun: validTokens.length,
          total: validTokens.length,
        };
      }

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

      const notificationRecords = tickets.map((ticket, index) => ({
        app_user_id: validTokens[index]?.app_user_id,
        shop_id: notification.shopId,
        notification_type: notification.notificationType,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        expo_push_token: validTokens[index]?.expo_push_token,
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
   * Resolve recipients for a shop+category combo from the subscription table.
   * Loyalty membership no longer implies push consent — the user must have
   * favorited the shop AND have categories.<category>=true.
   */
  private async resolveSubscribedUserIds(
    shopId: string,
    category: NotificationCategory
  ): Promise<string[]> {
    const userIds: string[] = [];
    let from = 0;

    while (true) {
      const to = from + RECIPIENT_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("user_shop_notification_preferences")
        .select("app_user_id, categories")
        .eq("shop_id", shopId)
        .range(from, to);

      if (error) {
        logger.error("Error fetching subscriptions", { error, shopId });
        break;
      }

      if (!data || data.length === 0) break;

      for (const row of data) {
        const cats = (row.categories ?? {}) as Record<string, boolean>;
        if (cats[category] === true) userIds.push(row.app_user_id);
      }

      if (data.length < RECIPIENT_PAGE_SIZE) break;
      from += RECIPIENT_PAGE_SIZE;
    }

    return userIds;
  }

  /**
   * Send notification to subscribed customers of a shop for a given category.
   * Reads user_shop_notification_preferences (NOT customer_loyalty_accounts).
   */
  async sendToShopCustomers(
    shopId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, any>;
      notificationType: NotificationCategory;
    }
  ) {
    try {
      const userIds = await this.resolveSubscribedUserIds(
        shopId,
        notification.notificationType
      );

      if (userIds.length === 0) {
        logger.info("No subscribers for shop+category", {
          shopId,
          category: notification.notificationType,
        });
        return {
          success: true,
          sent: 0,
          failed: 0,
          total: 0,
          message: "No subscribed customers",
        };
      }

      return this.sendToUsers(userIds, { ...notification, shopId });
    } catch (error) {
      logger.error("Error in sendToShopCustomers", { error });
      return { success: false, message: "Internal error" };
    }
  }

  /**
   * Stages a batchable send (daily_meal/specials) into notification_outbox
   * instead of pushing immediately. The digest job groups outbox rows by
   * (user, digest_window_at) and collapses overlapping shops into one push.
   *
   * digestWindowAt is the bucket the recipient lands in. Callers should round
   * to a 5-min boundary so multiple shops sending around the same time
   * naturally collide. We round here defensively as well.
   */
  async enqueueForShopCustomers(
    shopId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, any>;
      notificationType: NotificationCategory;
      sourceScheduledId?: string | null;
      source?: "scheduled" | "plan" | "manual";
    },
    digestWindowAt: Date
  ) {
    try {
      const userIds = await this.resolveSubscribedUserIds(
        shopId,
        notification.notificationType
      );

      if (userIds.length === 0) {
        logger.info("No subscribers to enqueue", {
          shopId,
          category: notification.notificationType,
        });
        return { success: true, staged: 0 };
      }

      const windowMs = 5 * 60 * 1000;
      const bucketMs = Math.floor(digestWindowAt.getTime() / windowMs) * windowMs;
      const bucketIso = new Date(bucketMs).toISOString();

      const rows = userIds.map((uid) => ({
        app_user_id: uid,
        shop_id: shopId,
        source_scheduled_id: notification.sourceScheduledId ?? null,
        source: notification.source ?? "scheduled",
        notification_type: notification.notificationType,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        digest_window_at: bucketIso,
        status: "queued",
      }));

      const { error } = await supabase
        .from("notification_outbox")
        .insert(rows);

      if (error) {
        logger.error("Error staging outbox rows", { error, shopId });
        return { success: false, staged: 0, message: "Stage failed" };
      }

      logger.info("Staged outbox rows", {
        shopId,
        category: notification.notificationType,
        staged: rows.length,
        digestWindowAt: bucketIso,
      });

      return { success: true, staged: rows.length };
    } catch (error) {
      logger.error("Error in enqueueForShopCustomers", { error });
      return { success: false, staged: 0, message: "Internal error" };
    }
  }

  /**
   * Birthday notifications: requires both a today-DOB match AND an active
   * subscription with categories.birthday=true.
   */
  async sendBirthdayNotifications() {
    try {
      const today = new Date();
      const todayMonth = today.getMonth() + 1;
      const todayDay = today.getDate();

      logger.info("Checking for birthday notifications", {
        month: todayMonth,
        day: todayDay,
      });

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

      for (const template of templates) {
        const shopId = template.shop_id;

        // Pull subscribers with categories.birthday=true, paginated.
        const subscriberIds: string[] = [];
        let from = 0;
        while (true) {
          const to = from + RECIPIENT_PAGE_SIZE - 1;
          const { data: subs, error: subErr } = await supabase
            .from("user_shop_notification_preferences")
            .select("app_user_id, categories")
            .eq("shop_id", shopId)
            .range(from, to);

          if (subErr) {
            logger.error("Error fetching birthday subscribers", {
              error: subErr,
              shopId,
            });
            break;
          }
          if (!subs || subs.length === 0) break;
          for (const row of subs) {
            const cats = (row.categories ?? {}) as Record<string, boolean>;
            if (cats.birthday === true) subscriberIds.push(row.app_user_id);
          }
          if (subs.length < RECIPIENT_PAGE_SIZE) break;
          from += RECIPIENT_PAGE_SIZE;
        }

        if (subscriberIds.length === 0) continue;

        // Filter to those whose DOB matches today.
        const { data: birthdayRows, error: dobError } = await supabase
          .from("app_users")
          .select("id, date_of_birth")
          .in("id", subscriberIds)
          .not("date_of_birth", "is", null);

        if (dobError) {
          logger.error("Error fetching DOBs", { error: dobError, shopId });
          continue;
        }

        const birthdayUserIds = (birthdayRows ?? [])
          .filter((u) => {
            if (!u.date_of_birth) return false;
            const dob = new Date(u.date_of_birth);
            return (
              dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDay
            );
          })
          .map((u) => u.id);

        if (birthdayUserIds.length === 0) {
          logger.info("No birthdays today for shop", { shopId });
          continue;
        }

        // Per-(user, shop, day) dedupe. The cron is daily at 07:00 UTC, but
        // a manual trigger, retry, or any future cadence change must NOT
        // re-push a birthday a user already received today for this shop.
        const todayUtcStart = new Date();
        todayUtcStart.setUTCHours(0, 0, 0, 0);
        const { data: alreadySent, error: dedupeError } = await supabase
          .from("push_notifications")
          .select("app_user_id")
          .eq("shop_id", shopId)
          .eq("notification_type", "birthday")
          .gte("created_at", todayUtcStart.toISOString())
          .in("app_user_id", birthdayUserIds);

        if (dedupeError) {
          logger.error("Birthday dedupe lookup failed; skipping shop to avoid double-push", {
            error: dedupeError,
            shopId,
          });
          continue;
        }

        const alreadySentIds = new Set(
          (alreadySent ?? []).map((r) => r.app_user_id)
        );
        const toSendUserIds = birthdayUserIds.filter(
          (id) => !alreadySentIds.has(id)
        );

        if (toSendUserIds.length === 0) {
          logger.info("All birthday recipients for shop already pushed today", {
            shopId,
            matched: birthdayUserIds.length,
          });
          continue;
        }

        logger.info("Sending birthday notifications", {
          shopId,
          count: toSendUserIds.length,
          dedupedSkipped: birthdayUserIds.length - toSendUserIds.length,
        });

        // If the template has a coupon_id, surface it in the push payload so the
        // native app can deep-link to the (is_birthday_only) coupon. The coupon
        // is gated on the app side: it's only visible to users whose DOB matches
        // today, and one-time-use is enforced at redeem time.
        const baseData = (template.data || {}) as Record<string, any>;
        const data: Record<string, any> = (template as any).coupon_id
          ? { ...baseData, coupon_id: (template as any).coupon_id }
          : baseData;

        await this.sendToUsers(toSendUserIds, {
          title: template.title,
          body: template.body,
          data,
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
   * Check Expo receipts for sent notifications. Skips dry-run rows entirely
   * (they have no ticket id). Deactivates tokens that come back DeviceNotRegistered.
   */
  async checkReceipts() {
    try {
      const { data: pendingNotifications, error } = await supabase
        .from("push_notifications")
        .select("id, expo_ticket_id, expo_push_token")
        .eq("status", "sent")
        .not("expo_ticket_id", "is", null)
        .order("sent_at", { ascending: true })
        .limit(1000);

      if (error) {
        logger.error("Error fetching pending notifications", { error });
        return;
      }

      if (!pendingNotifications || pendingNotifications.length === 0) {
        return;
      }

      // Map ticket -> token so we can deactivate tokens on DeviceNotRegistered.
      const ticketToToken = new Map<string, string | null>();
      for (const n of pendingNotifications) {
        if (n.expo_ticket_id) {
          ticketToToken.set(n.expo_ticket_id, n.expo_push_token ?? null);
        }
      }

      const ticketIds = pendingNotifications
        .map((n) => n.expo_ticket_id)
        .filter((id): id is string => id !== null);

      if (ticketIds.length === 0) return;

      const chunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);

      for (const chunk of chunks) {
        try {
          const receipts = await this.expo.getPushNotificationReceiptsAsync(
            chunk
          );

          for (const [ticketId, receipt] of Object.entries(receipts)) {
            if (receipt.status === "ok") {
              await supabase
                .from("push_notifications")
                .update({ status: "delivered" })
                .eq("expo_ticket_id", ticketId);
            } else if (receipt.status === "error") {
              await supabase
                .from("push_notifications")
                .update({
                  status: "error",
                  error_message: receipt.message ?? "Unknown error",
                })
                .eq("expo_ticket_id", ticketId);

              if (receipt.details?.error === "DeviceNotRegistered") {
                const token = ticketToToken.get(ticketId);
                if (token) {
                  logger.warn("Deactivating token (DeviceNotRegistered)", {
                    ticketId,
                  });
                  await supabase
                    .from("push_tokens")
                    .update({ is_active: false })
                    .eq("expo_push_token", token);
                } else {
                  logger.warn(
                    "DeviceNotRegistered but no token recorded on notification",
                    { ticketId }
                  );
                }
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

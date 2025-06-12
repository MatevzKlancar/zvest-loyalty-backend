import { supabase } from "../config/database";
import { logger } from "../config/logger";
import type { Database } from "../types/database";

type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
type LoyaltyProgram = Database["public"]["Tables"]["loyalty_programs"]["Row"];

export class CustomerService {
  async scanTransactionQR(
    shopId: string,
    invoiceId: string,
    customerId?: string
  ) {
    try {
      // Find the transaction
      const { data: transaction, error: transactionError } = await supabase
        .from("transactions")
        .select("*")
        .eq("shop_id", shopId)
        .eq("pos_invoice_id", invoiceId)
        .single();

      if (transactionError || !transaction) {
        logger.info(`Transaction not found: ${invoiceId} for shop ${shopId}`);
        return {
          success: false,
          message: "Transaction not found",
          errorSource: "client" as const,
        };
      }

      // Check if loyalty has already been awarded for this transaction
      if (
        transaction.loyalty_points_awarded !== null ||
        transaction.loyalty_stamps_awarded !== null
      ) {
        return {
          success: false,
          message: "Loyalty rewards already awarded for this transaction",
          errorSource: "client" as const,
        };
      }

      // Get active loyalty programs for the shop
      const { data: loyaltyPrograms, error: loyaltyError } = await supabase
        .from("loyalty_programs")
        .select("*")
        .eq("shop_id", shopId)
        .eq("is_active", true);

      if (loyaltyError) {
        logger.error("Failed to fetch loyalty programs:", loyaltyError);
        return {
          success: false,
          message: "Failed to process loyalty rewards",
          errorSource: "server" as const,
        };
      }

      if (!loyaltyPrograms || loyaltyPrograms.length === 0) {
        return {
          success: true,
          message: "Transaction found but no active loyalty program",
          data: {
            transaction,
            loyaltyAwarded: null,
          },
        };
      }

      // Calculate loyalty rewards based on the first active program
      // In a more complex system, you might have multiple programs or let user choose
      const loyaltyProgram = loyaltyPrograms[0];
      let pointsAwarded = 0;
      let stampsAwarded = 0;

      if (loyaltyProgram.type === "points" && loyaltyProgram.points_per_euro) {
        pointsAwarded = Math.floor(
          transaction.total_amount * loyaltyProgram.points_per_euro
        );
      } else if (loyaltyProgram.type === "stamps") {
        // Award 1 stamp per transaction (you can customize this logic)
        stampsAwarded = 1;
      }

      // Update the transaction with loyalty rewards
      const { error: updateError } = await supabase
        .from("transactions")
        .update({
          customer_id: customerId || null,
          loyalty_points_awarded: pointsAwarded || null,
          loyalty_stamps_awarded: stampsAwarded || null,
        })
        .eq("id", transaction.id);

      if (updateError) {
        logger.error(
          "Failed to update transaction with loyalty rewards:",
          updateError
        );
        return {
          success: false,
          message: "Failed to award loyalty rewards",
          errorSource: "server" as const,
        };
      }

      logger.info(
        `Loyalty rewards awarded: ${pointsAwarded} points, ${stampsAwarded} stamps for transaction ${transaction.id}`
      );

      return {
        success: true,
        message: "Loyalty rewards awarded successfully",
        data: {
          transaction: {
            ...transaction,
            loyalty_points_awarded: pointsAwarded || null,
            loyalty_stamps_awarded: stampsAwarded || null,
          },
          loyaltyAwarded: {
            type: loyaltyProgram.type,
            points: pointsAwarded,
            stamps: stampsAwarded,
            program_name: loyaltyProgram.name,
            program_description: loyaltyProgram.description,
          },
        },
      };
    } catch (error) {
      logger.error("Error processing QR scan:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }

  async getTransactionDetails(shopId: string, invoiceId: string) {
    try {
      const { data: transaction, error } = await supabase
        .from("transactions")
        .select(
          `
          *,
          shops!inner(name, description)
        `
        )
        .eq("shop_id", shopId)
        .eq("pos_invoice_id", invoiceId)
        .single();

      if (error || !transaction) {
        return {
          success: false,
          message: "Transaction not found",
          errorSource: "client" as const,
        };
      }

      return {
        success: true,
        message: "Transaction details retrieved",
        data: transaction,
      };
    } catch (error) {
      logger.error("Error fetching transaction details:", error);
      return {
        success: false,
        message: "Internal server error",
        errorSource: "server" as const,
      };
    }
  }
}

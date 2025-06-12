import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { CustomerService } from "../services/customerService";
import { standardResponse } from "../middleware/error";
import { scanQRSchema, transactionDetailsSchema } from "../schemas/customer";
import { standardResponseSchema } from "../schemas/pos";

const customer = new OpenAPIHono();
const customerService = new CustomerService();

/**
 * @openapi
 * /api/customers/scan:
 *   post:
 *     summary: Scan QR code for loyalty rewards
 *     description: Scans QR code from receipt to award loyalty points or stamps
 *     tags: [Customer App]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shop_id, invoice_id]
 *             properties:
 *               shop_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the shop
 *               invoice_id:
 *                 type: string
 *                 description: Invoice ID printed on the receipt
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional customer ID for tracking
 *     responses:
 *       200:
 *         description: QR code scanned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Loyalty rewards awarded successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transaction:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         shop_id:
 *                           type: string
 *                           format: uuid
 *                         pos_invoice_id:
 *                           type: string
 *                         total_amount:
 *                           type: number
 *                         items:
 *                           type: array
 *                         loyalty_points_awarded:
 *                           type: integer
 *                         loyalty_stamps_awarded:
 *                           type: integer
 *                     loyaltyAwarded:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           enum: [points, stamps]
 *                         points:
 *                           type: integer
 *                         stamps:
 *                           type: integer
 *                         program_name:
 *                           type: string
 *                         program_description:
 *                           type: string
 *       400:
 *         description: Invalid request or transaction not found
 */
const scanQRRoute = createRoute({
  method: "post",
  path: "/scan",
  summary: "Scan QR code for loyalty rewards",
  description: "Scans QR code from receipt to award loyalty points or stamps",
  tags: ["Customer App"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: scanQRSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "QR code scanned successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request or transaction not found",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

customer.openapi(scanQRRoute, async (c) => {
  const { shop_id, invoice_id, customer_id } = c.req.valid("json");

  const result = await customerService.scanTransactionQR(
    shop_id,
    invoice_id,
    customer_id
  );

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

/**
 * @openapi
 * /api/customers/transaction:
 *   post:
 *     summary: Get transaction details
 *     description: Retrieves transaction details without awarding loyalty
 *     tags: [Customer App]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shop_id, invoice_id]
 *             properties:
 *               shop_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the shop
 *               invoice_id:
 *                 type: string
 *                 description: Invoice ID printed on the receipt
 *     responses:
 *       200:
 *         description: Transaction details retrieved
 *       400:
 *         description: Transaction not found
 */
const getTransactionRoute = createRoute({
  method: "post",
  path: "/transaction",
  summary: "Get transaction details",
  description: "Retrieves transaction details without awarding loyalty",
  tags: ["Customer App"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: transactionDetailsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Transaction details retrieved",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
    400: {
      description: "Transaction not found",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

customer.openapi(getTransactionRoute, async (c) => {
  const { shop_id, invoice_id } = c.req.valid("json");

  const result = await customerService.getTransactionDetails(
    shop_id,
    invoice_id
  );

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

export { customer };

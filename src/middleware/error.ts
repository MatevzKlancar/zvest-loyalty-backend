import { Context } from "hono";
import { logger } from "../config/logger";

export function errorHandler(err: Error, c: Context) {
  logger.error("Unhandled error:", {
    message: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  });

  return c.json(
    {
      status: 500,
      message: "Internal server error",
      error_source: "server",
    },
    500
  );
}

export function standardResponse(
  status: number,
  message: string,
  data?: any,
  errorSource?: "client" | "server" | "pos"
) {
  const response: any = {
    status,
    message,
  };

  if (data) {
    response.data = data;
  }

  if (status >= 400 && errorSource) {
    response.error_source = errorSource;
  }

  return response;
}

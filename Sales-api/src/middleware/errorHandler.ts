import { NextFunction, Request, Response } from "express";

export class UnauthorizedError extends Error {}
export class NotFoundError extends Error {}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error("An unhandled exception has occurred", err);

  const message = err instanceof Error ? err.message : "Unknown error";
  let statusCode = 500;

  if (err instanceof UnauthorizedError) statusCode = 401;
  else if (err instanceof NotFoundError) statusCode = 404;

  res.status(statusCode).json({
    message: "An error occurred processing your request",
    error: message,
  });
}

import { NextFunction, Request, Response } from "express";

interface RequestError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: "Endpoint not found",
    code: "NOT_FOUND",
  });
}

export function errorHandler(
  error: RequestError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  void _next;

  if (error.type === "entity.too.large") {
    res.status(413).json({
      error: "Request body is too large",
      code: "PAYLOAD_TOO_LARGE",
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({
      error: "Malformed JSON request",
      code: "INVALID_JSON",
    });
    return;
  }

  const statusCode = error.statusCode ?? error.status ?? 500;
  const safeStatusCode =
    Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600
      ? statusCode
      : 500;

  if (safeStatusCode >= 500) {
    console.error("Unhandled request error:", error);
  }
  const publicCode =
    safeStatusCode < 500 && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.code ?? "")
      ? error.code
      : safeStatusCode < 500
        ? "REQUEST_ERROR"
        : "INTERNAL_ERROR";
  res.status(safeStatusCode).json({
    error: safeStatusCode < 500 ? error.message : "Internal server error",
    code: publicCode,
  });
}

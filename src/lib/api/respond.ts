import { NextResponse } from "next/server";

/** Every error the API can return, so a caller can branch on a stable string. */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "insufficient_scope"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  insufficient_scope: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  internal: 500,
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function fail(code: ErrorCode, message: string, details?: unknown, init?: ResponseInit) {
  return NextResponse.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status: STATUS[code], ...init },
  );
}

/** Raised by the service layer to mean "answer the caller with exactly this". */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

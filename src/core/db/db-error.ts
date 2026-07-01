import type { TDatabaseErrorInfo, TDatabaseType } from "./db-types";

/**
 * Network-level failures that mean the socket is dead and a reconnect + single
 * retry of a read-only operation is safe. Covers HANA (RTE:[89013] "Socket
 * closed by peer") and PostgreSQL/node socket errors.
 */
const NETWORK_PATTERNS = [
  "socket closed by peer",
  "rte:[89013]",
  "econnreset",
  "connection reset",
  "connection closed",
  "socket is closed",
  "socket hang up",
  "peer closed",
  "epipe",
  "read econnreset",
  "server closed the connection",
  "connection terminated",
];

const TIMEOUT_PATTERNS = ["etimedout", "timeout", "timed out", "communicationtimeout"];

const AUTH_PATTERNS = [
  "authentication failed",
  "invalid username or password",
  "password authentication failed",
  "invalid credentials",
  "28p01", // pg invalid_password
  "auth_failed",
  "user is locked",
];

const PERMISSION_PATTERNS = [
  "insufficient privilege",
  "not authorized",
  "permission denied",
  "access denied",
  "42501", // pg insufficient_privilege
];

const SYNTAX_PATTERNS = [
  "syntax error",
  "sql syntax error",
  "incorrect syntax",
  "invalid sql",
  "42601", // pg syntax_error
  "42p01", // pg undefined_table
];

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; code?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
    if (typeof maybe.code === "string") return maybe.code;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function matchesAny(haystack: string, patterns: string[]): boolean {
  return patterns.some((pattern) => haystack.includes(pattern));
}

/**
 * Classify a driver error into a stable, UI-friendly shape. `retryable` is true
 * only for transient network/timeout failures — never for auth/permission/syntax.
 */
export function classifyDatabaseError(error: unknown, type: TDatabaseType): TDatabaseErrorInfo {
  const originalMessage = toMessage(error);
  const haystack = originalMessage.toLowerCase();

  if (matchesAny(haystack, NETWORK_PATTERNS)) {
    return {
      kind: "network",
      message: type === "hana"
        ? "The HANA connection was dropped (socket closed by peer). The session can be re-established."
        : "The database connection was dropped. The session can be re-established.",
      originalMessage,
      retryable: true,
    };
  }

  if (matchesAny(haystack, TIMEOUT_PATTERNS)) {
    return {
      kind: "timeout",
      message: "The database did not respond in time. It may be busy or unreachable.",
      originalMessage,
      retryable: true,
    };
  }

  if (matchesAny(haystack, AUTH_PATTERNS)) {
    return {
      kind: "authentication",
      message: "Authentication failed. The cached credentials may be stale or rotated.",
      originalMessage,
      retryable: false,
    };
  }

  if (matchesAny(haystack, PERMISSION_PATTERNS)) {
    return {
      kind: "permission",
      message: "The database user is not authorized for this operation.",
      originalMessage,
      retryable: false,
    };
  }

  if (matchesAny(haystack, SYNTAX_PATTERNS)) {
    return {
      kind: "syntax",
      message: "The SQL statement is invalid.",
      originalMessage,
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    message: originalMessage || "An unknown database error occurred.",
    originalMessage,
    retryable: false,
  };
}

/** True when the error is a transient network/timeout failure safe to retry once. */
export function isRetryableDatabaseError(error: unknown, type: TDatabaseType): boolean {
  return classifyDatabaseError(error, type).retryable;
}

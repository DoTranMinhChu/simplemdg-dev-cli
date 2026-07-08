import type { TDatabaseErrorCode, TDatabaseErrorInfo, TDatabaseType } from "./db-types";

/**
 * Socket-death patterns: the connection was live and then died mid-session.
 * Covers HANA (RTE:[89013] "Socket closed by peer") and PostgreSQL/node socket
 * errors. Distinguished from CONNECTION_REFUSED_PATTERNS (never connected) so
 * the UI can show a slightly different message/code.
 */
const SOCKET_CLOSED_PATTERNS = [
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

/** Never-connected network failures: host unreachable, port closed, DNS failure. */
const CONNECTION_REFUSED_PATTERNS = [
  "econnrefused",
  "connection refused",
  "could not connect",
  "enotfound",
  "no route to host",
  "ehostunreach",
  "enetunreach",
  "getaddrinfo",
];

const NETWORK_PATTERNS = [...SOCKET_CLOSED_PATTERNS, ...CONNECTION_REFUSED_PATTERNS];

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

  if (matchesAny(haystack, SOCKET_CLOSED_PATTERNS)) {
    const code: TDatabaseErrorCode = "DB_SOCKET_CLOSED";
    return {
      kind: "network",
      code,
      message: type === "hana"
        ? "The HANA connection was closed by the server."
        : "The database connection was closed by the server.",
      originalMessage,
      retryable: true,
    };
  }

  if (matchesAny(haystack, CONNECTION_REFUSED_PATTERNS)) {
    return {
      kind: "network",
      code: "DB_CONNECTION_FAILED",
      message: "Could not reach the database server. Check the host, port, and network path.",
      originalMessage,
      retryable: true,
    };
  }

  if (matchesAny(haystack, TIMEOUT_PATTERNS)) {
    return {
      kind: "timeout",
      code: "DB_TIMEOUT",
      message: "The database did not respond in time. It may be busy or unreachable.",
      originalMessage,
      retryable: true,
    };
  }

  if (matchesAny(haystack, AUTH_PATTERNS)) {
    return {
      kind: "authentication",
      code: "DB_AUTH_FAILED",
      message: "Authentication failed. The cached credentials may be stale or rotated.",
      originalMessage,
      retryable: false,
    };
  }

  if (matchesAny(haystack, PERMISSION_PATTERNS)) {
    return {
      kind: "permission",
      code: "DB_PERMISSION_DENIED",
      message: "The database user is not authorized for this operation.",
      originalMessage,
      retryable: false,
    };
  }

  if (matchesAny(haystack, SYNTAX_PATTERNS)) {
    return {
      kind: "syntax",
      code: "DB_QUERY_FAILED",
      message: "The SQL statement is invalid.",
      originalMessage,
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    code: "DB_UNKNOWN_ERROR",
    message: originalMessage || "An unknown database error occurred.",
    originalMessage,
    retryable: false,
  };
}

/** True when the error is a transient network/timeout failure safe to retry once. */
export function isRetryableDatabaseError(error: unknown, type: TDatabaseType): boolean {
  return classifyDatabaseError(error, type).retryable;
}

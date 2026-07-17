import axios from "axios";

export function getAuthHeaderHints(headers: Record<string, unknown> | undefined): string {
  if (!headers) {
    return "";
  }

  const wwwAuthenticate = headers["www-authenticate"];
  const authHint = headers["authorization"];
  const location = headers.location;
  const hints = [
    wwwAuthenticate ? `www-authenticate=${String(wwwAuthenticate)}` : "",
    authHint ? `authorization=${String(authHint)}` : "",
    location ? `location=${String(location)}` : "",
  ].filter(Boolean);

  return hints.length > 0 ? ` [auth-headers] ${hints.join(" | ")}` : "";
}

export function buildUnauthorizedError(
  stage: string,
  response: { status?: number; headers?: Record<string, unknown> },
): Error {
  const headerHints = getAuthHeaderHints(response.headers);
  return new Error(`Unauthorized at stage '${stage}' (HTTP ${String(response.status ?? 401)}).${headerHints}`);
}

export function describeAuthError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const code = error.code || "AXIOS_ERROR";
    const headerHints = getAuthHeaderHints(error.response?.headers as Record<string, unknown> | undefined);
    return status ? `${code} / HTTP ${status}: ${error.message}${headerHints}` : `${code}: ${error.message}`;
  }

  if (error instanceof Error) {
    if (/timeout/i.test(error.name) || /timeout/i.test(error.message)) {
      return `TIMEOUT: ${error.message}`;
    }
    return error.message;
  }

  return String(error);
}

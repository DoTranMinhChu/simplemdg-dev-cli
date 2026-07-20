import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import type { TCapturedSession, TProxyUserCredential, TResolvedProxyEnvironment } from "./proxy-types";
import { buildUnauthorizedError, describeAuthError } from "./proxy-auth-shared";

type TParsedAuthForm = {
  action: string;
  method: string;
  fields: Record<string, string>;
  fieldNames: string[];
  hasPasswordField: boolean;
};

function parseAuthForm(html: string, baseUrl: string): TParsedAuthForm | null {
  const $ = cheerio.load(html || "");
  const candidates = $("form").toArray();
  if (candidates.length === 0) {
    return null;
  }

  const preferred = candidates.find((formEl) => $(formEl).find('input[type="password"]').length > 0) ?? candidates[0];
  const form = $(preferred);
  const rawAction = form.attr("action") || baseUrl;
  const action = new URL(rawAction, baseUrl).toString();
  const method = (form.attr("method") || "POST").toUpperCase();
  const fields: Record<string, string> = {};
  const fieldNames: string[] = [];

  form.find("input,textarea,select").each((_index, inputEl) => {
    const el = $(inputEl);
    const name = (el.attr("name") || "").trim();
    if (!name) {
      return;
    }
    fieldNames.push(name);
    if (!(name in fields)) {
      fields[name] = el.attr("value") || "";
    }
  });

  return {
    action,
    method,
    fields,
    fieldNames,
    hasPasswordField: form.find('input[type="password"]').length > 0,
  };
}

function pickFieldName(fieldNames: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const found = fieldNames.find((name) => pattern.test(name));
    if (found) {
      return found;
    }
  }
  return null;
}

async function followRedirectAndSamlForms(
  client: ReturnType<typeof wrapper>,
  initialResponse: any,
  appBaseUrl: string,
): Promise<any> {
  let response = initialResponse;
  let guard = 0;

  while (guard < 14) {
    guard += 1;

    if (response.status >= 300 && response.status < 400 && response.headers?.location) {
      const nextUrl = new URL(String(response.headers.location), appBaseUrl).toString();
      response = await client.get(nextUrl);
      continue;
    }

    const html = typeof response.data === "string" ? response.data : "";
    if (!html) {
      break;
    }

    const form = parseAuthForm(html, response.request?.res?.responseUrl || appBaseUrl);
    if (!form) {
      break;
    }

    const hasSamlPayload = Boolean(form.fields.SAMLResponse || form.fields.RelayState || form.fields.wresult);
    if (!hasSamlPayload) {
      break;
    }

    response = await client.request({
      method: form.method,
      url: form.action,
      data: new URLSearchParams(form.fields),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  return response;
}

function buildCaptureProbeUrls(serviceOrigin: string, requestPattern: string): string[] {
  const tokens = requestPattern
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  const urls = new Set<string>();

  for (const token of tokens) {
    if (/^https?:\/\//i.test(token)) {
      urls.add(token);
    } else if (token.startsWith("/")) {
      urls.add(`${serviceOrigin}${token}`);
    } else {
      urls.add(`${serviceOrigin}/${token}`);
      if (!token.startsWith("srv-process/") && token.includes("DashboardService/")) {
        urls.add(`${serviceOrigin}/srv-process/${token}`);
      }
      if (!token.startsWith("srv-approver/") && token.includes("ApproverService/")) {
        urls.add(`${serviceOrigin}/srv-approver/${token}`);
      }
      if (!token.startsWith("srv-process/") && token.includes("CommonProcessService/")) {
        urls.add(`${serviceOrigin}/srv-process/${token}`);
      }
    }
  }

  urls.add(`${serviceOrigin}/srv-process/CommonProcessService/getBusinessRequest`);
  urls.add(`${serviceOrigin}/srv-process/DashboardService/DashboardThreshold`);
  urls.add(`${serviceOrigin}/srv-approver/ApproverService/myInbox`);

  return Array.from(urls);
}

/**
 * Pure-HTTP login capture: submits the login form directly (following redirects and SAML
 * intermediate forms) and captures the resulting session cookies + CSRF token. Fast
 * (~200-500ms) and dependency-light compared to the Playwright fallback, but only works
 * when the login page is a plain HTML form (not a JS-rendered SPA/SSO widget).
 */
export async function captureHeadersWithHttpRequests(
  env: TResolvedProxyEnvironment,
  selectedUser: TProxyUserCredential,
  onLog: (message: string) => void = (): void => undefined,
): Promise<TCapturedSession> {
  const requestPattern = env.capture.requestUrlPattern ?? "myInbox";
  const requestRegex = new RegExp(requestPattern);
  const serviceOrigin = new URL(env.url).origin;

  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      withCredentials: true,
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 20000,
    }),
  );
  (client.defaults as any).jar = jar;

  onLog(`Attempting login for ${env.displayName} (${env.url}) as ${selectedUser.userID}.`);

  onLog("Stage: Initial application request.");
  let response = await client.get(env.url);
  if (response.status === 401) {
    throw buildUnauthorizedError("initial application request", response);
  }
  response = await followRedirectAndSamlForms(client, response, env.url);

  const landingHtml = typeof response.data === "string" ? response.data : "";
  const loginForm = parseAuthForm(landingHtml, response.request?.res?.responseUrl || env.url);

  if (loginForm?.hasPasswordField) {
    const usernameField = pickFieldName(loginForm.fieldNames, [/^j_username$/i, /^username$/i, /user/i, /email/i, /login/i]);
    const passwordField = pickFieldName(loginForm.fieldNames, [/^j_password$/i, /^password$/i, /pass/i]);

    if (!usernameField || !passwordField) {
      throw new Error("HTTP auth flow could not resolve username/password field names.");
    }

    const loginPayload = { ...loginForm.fields };
    loginPayload[usernameField] = selectedUser.userID;
    loginPayload[passwordField] = selectedUser.password;

    onLog("Stage: Credential form submission.");
    response = await client.request({
      method: loginForm.method,
      url: loginForm.action,
      data: new URLSearchParams(loginPayload),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (response.status === 401) {
      throw buildUnauthorizedError("credential submission", response);
    }

    response = await followRedirectAndSamlForms(client, response, env.url);

    const postAuthHtml = typeof response.data === "string" ? response.data : "";
    const postAuthForm = parseAuthForm(postAuthHtml, response.request?.res?.responseUrl || env.url);
    if (postAuthForm?.hasPasswordField) {
      throw new Error(`HTTP auth flow appears to still be on login page for ${env.displayName}.`);
    }
  }

  const cookies = await jar.getCookies(serviceOrigin);
  const cookieHeader = cookies.map((cookie) => `${cookie.key}=${cookie.value}`).join("; ");
  if (!cookieHeader) {
    throw new Error("HTTP auth flow did not produce session cookies.");
  }

  let csrfToken = "";
  try {
    onLog("Stage: CSRF token fetch.");
    const csrfResponse = await client.get(`${serviceOrigin}/`, { headers: { "x-csrf-token": "Fetch" } });
    if (csrfResponse.status === 401) {
      throw buildUnauthorizedError("csrf token fetch", csrfResponse);
    }
    csrfToken = String(csrfResponse.headers?.["x-csrf-token"] ?? "");
  } catch (error) {
    onLog(`CSRF token fetch did not complete cleanly: ${describeAuthError(error)}`);
    // Non-fatal: some backends do not issue CSRF on root path.
  }

  const probeUrls = buildCaptureProbeUrls(serviceOrigin, requestPattern);
  let matchedUrl = probeUrls[0] ?? `${serviceOrigin}/`;

  for (const probeUrl of probeUrls) {
    try {
      onLog(`Stage: Probe request -> ${probeUrl}`);
      const probeResponse = await client.get(probeUrl, {
        headers: { accept: "application/json, text/plain, */*", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
      });
      if (probeResponse.status === 401 || probeResponse.status === 403) {
        throw buildUnauthorizedError(`probe request (${probeUrl})`, probeResponse);
      }
      const finalUrl = String(probeResponse.request?.res?.responseUrl ?? probeUrl);
      if (requestRegex.test(finalUrl) || probeResponse.status < 400) {
        matchedUrl = finalUrl;
        break;
      }
    } catch (error) {
      onLog(`Probe request failed: ${describeAuthError(error)}`);
      // Continue to next probe URL.
    }
  }

  onLog("Header retrieval completed through HTTP flow.");

  return {
    method: "GET",
    url: matchedUrl,
    capturedAt: new Date().toISOString(),
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": env.capture.acceptLanguage ?? "en-US",
      ...(env.capture.sapLanguage ? { "sap-language": env.capture.sapLanguage } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      cookie: cookieHeader,
      referer: env.url,
    },
  };
}

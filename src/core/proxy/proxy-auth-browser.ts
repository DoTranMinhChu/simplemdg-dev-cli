import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TCapturedSession, TProxyUserCredential, TResolvedProxyEnvironment } from "./proxy-types";

type TPlaywrightModule = { chromium: any };

async function loadPlaywright(): Promise<TPlaywrightModule> {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Playwright is not installed. Run "npm install -g playwright" (or "npx playwright install chromium" ` +
        `after installing) to enable browser-based login capture. ${String(error)}`,
    );
  }
}

// Reused across captures — launching headless Chromium per capture adds ~1-2s of
// unnecessary startup latency every time a session is refreshed. Each capture still gets
// its own isolated browser context (cookies/locale), so sharing the browser is safe.
let sharedHeadlessBrowserPromise: Promise<any> | null = null;
let sharedHeadedBrowserPromise: Promise<any> | null = null;

async function getSharedBrowser(playwrightModule: TPlaywrightModule, headless: boolean): Promise<any> {
  const cacheRef = headless ? "sharedHeadlessBrowserPromise" : "sharedHeadedBrowserPromise";
  const current = cacheRef === "sharedHeadlessBrowserPromise" ? sharedHeadlessBrowserPromise : sharedHeadedBrowserPromise;

  if (current) {
    const existing = await current;
    if (existing.isConnected()) {
      return existing;
    }
  }

  const launched = playwrightModule.chromium.launch({ headless });
  if (cacheRef === "sharedHeadlessBrowserPromise") {
    sharedHeadlessBrowserPromise = launched;
  } else {
    sharedHeadedBrowserPromise = launched;
  }
  return launched;
}

const PLAYWRIGHT_DEBUG = String(process.env.SMDG_PROXY_PLAYWRIGHT_DEBUG ?? "false").toLowerCase() === "true";
const CAPTURE_AUTO_REQUEST_GRACE_MS = Number(process.env.SMDG_PROXY_CAPTURE_GRACE_MS ?? 2500);
const DEBUG_DIR = path.join(os.homedir(), ".simplemdg", "proxy", "debug");

function ensureDebugDir(): void {
  if (!existsSync(DEBUG_DIR)) {
    mkdirSync(DEBUG_DIR, { recursive: true });
  }
}

/**
 * Navigates `page` to the environment's URL and drives its login form to completion
 * (autofill username/password, submit, verify no error banner / login form remains).
 * Shared by the headless capture flow and the headed "open logged-in browser" flow so the
 * fiddly selector-fallback logic only lives in one place. Throws on failure.
 */
async function performLoginFormSubmit(
  page: any,
  env: TResolvedProxyEnvironment,
  selectedUser: TProxyUserCredential,
  onLog: (message: string) => void,
): Promise<void> {
  onLog("Opening target application...");
  await page.goto(env.url, { waitUntil: "domcontentloaded", timeout: 120000 });

  if (PLAYWRIGHT_DEBUG) {
    ensureDebugDir();
    const screenshotPath = path.join(DEBUG_DIR, `login-debug-${env.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    onLog(`Debug screenshot saved: ${screenshotPath}`);
  }

  const usernameSelector = env.login.usernameSelector ?? 'input[name="username"], input[name="email"], input[name="j_username"], input[type="email"], input[id*="user"]';
  const passwordSelector = env.login.passwordSelector ?? 'input[name="password"], input[name="j_password"], input[type="password"], input[id*="pass"]';
  const submitSelector = env.login.submitSelector ?? 'button[type="submit"], input[type="submit"], button[name="login"], button[id*="login"]';

  async function fillFirstVisible(selectorCandidates: string, value: string, required: boolean): Promise<boolean> {
    const selectors = selectorCandidates.split(",").map((item) => item.trim()).filter(Boolean);
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(`${selector}:visible`).first();
        if ((await locator.count()) > 0) {
          await locator.fill(value);
          return true;
        }
      }
    }
    const genericInput = page.locator('input[type="text"]:visible, input[type="email"]:visible, input:not([type]):visible').first();
    if (required && (await genericInput.count()) > 0) {
      await genericInput.fill(value);
      return true;
    }
    if (required) throw new Error(`No visible element found for selectors: ${selectorCandidates}`);
    return false;
  }

  async function fillFirstVisiblePassword(selectorCandidates: string, value: string): Promise<boolean> {
    const selectors = selectorCandidates.split(",").map((item) => item.trim()).filter(Boolean);
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(`${selector}:visible`).first();
        if ((await locator.count()) > 0) {
          await locator.fill(value);
          return true;
        }
      }
    }
    const genericPassword = page.locator('input[type="password"]:visible').first();
    if ((await genericPassword.count()) > 0) {
      await genericPassword.fill(value);
      return true;
    }
    return false;
  }

  async function clickFirstVisible(selectorCandidates: string): Promise<boolean> {
    const selectors = selectorCandidates.split(",").map((item) => item.trim()).filter(Boolean);
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(`${selector}:visible`).first();
        if ((await locator.count()) > 0) {
          await locator.click();
          return true;
        }
      }
    }
    const genericButton = page.locator('button:visible, input[type="submit"]:visible, [role="button"]:visible').first();
    if ((await genericButton.count()) > 0) {
      await genericButton.click();
      return true;
    }
    return false;
  }

  async function waitAndFillPassword(selectorCandidates: string, value: string, timeoutMs = 12000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await fillFirstVisiblePassword(selectorCandidates, value)) return true;
      await page.waitForTimeout(400);
    }
    return false;
  }

  async function waitAndFillUsername(selectorCandidates: string, value: string, timeoutMs = 12000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await fillFirstVisible(selectorCandidates, value, false)) return true;
      await page.waitForTimeout(400);
    }
    return false;
  }

  async function checkForLoginErrors(): Promise<void> {
    const errorSelectors = env.login.errorMessageSelectors ?? '[role="alert"], .error, .alert-danger, [class*="error"], [class*="invalid"], span.error';
    const loginFormSelector = env.login.loginFormSelector ?? 'form[id*="login"], form[id*="logon"], [id*="login"]';

    const deadline = Date.now() + 1500;
    let errorMessages: string[] = [];
    while (Date.now() < deadline) {
      errorMessages = await page
        .$$eval(errorSelectors, (elements: any[]) =>
          elements
            .filter((el) => el.offsetParent !== null)
            .map((el) => el.textContent?.trim() ?? "")
            .filter((text: string) => text.length > 0),
        )
        .catch(() => []);

      if (errorMessages.length > 0) break;
      const stillOnLoginForm = await page.locator(loginFormSelector).first().isVisible().catch(() => false);
      if (!stillOnLoginForm) break;
      await page.waitForTimeout(200);
    }

    if (errorMessages.length > 0) {
      const errorText = errorMessages.join(" | ");
      onLog(`Login error detected: ${errorText}`);
      throw new Error(`Login failed for user ${selectedUser.userID}: ${errorText}`);
    }

    const loginFormVisible = await page.locator(loginFormSelector).first().isVisible().catch(() => false);
    if (loginFormVisible) {
      onLog("Login form still visible after submission - credentials may be incorrect");
      throw new Error(`Login form still visible after credential submission for user ${selectedUser.userID}. Possible causes: wrong password, invalid userid, or locked account.`);
    }
  }

  onLog("Filling credentials...");
  const usernameFilled = await waitAndFillUsername(usernameSelector, selectedUser.userID, 12000);
  let passwordFilled = await fillFirstVisiblePassword(passwordSelector, selectedUser.password);
  let submitClicked = false;

  if (usernameFilled && !passwordFilled) {
    const nextClicked = await clickFirstVisible(submitSelector);
    submitClicked = submitClicked || nextClicked;
    if (nextClicked) {
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
    }
    passwordFilled = await waitAndFillPassword(passwordSelector, selectedUser.password, 12000);
  }

  if (passwordFilled) {
    submitClicked = (await clickFirstVisible(submitSelector)) || submitClicked;
  } else if (!submitClicked) {
    submitClicked = await clickFirstVisible(submitSelector);
  }

  if (!usernameFilled && !passwordFilled && !submitClicked) {
    throw new Error("Could not find a visible login form. Add login selectors to this environment's config.");
  }

  onLog("Credentials submitted. Waiting for API activity...");
  await checkForLoginErrors();
}

/**
 * Credentialed, headless browser login capture — used when HTTP-form login fails (the
 * `auto`/`browser` capture modes). Fills the login form, waits for the app to fire a
 * matching authenticated API request (or actively probes for one), and returns the
 * captured headers. Ported from the reference "ProxyHub" project's
 * `captureHeadersWithPlaywright`, adapted to this CLI's types/logging.
 */
export async function captureHeadersWithPlaywright(
  env: TResolvedProxyEnvironment,
  selectedUser: TProxyUserCredential,
  onLog: (message: string) => void = (): void => undefined,
): Promise<TCapturedSession> {
  const playwrightModule = await loadPlaywright();
  const requestPattern = env.capture.requestUrlPattern ?? "myInbox";
  const requestRegex = new RegExp(requestPattern);
  const serviceOrigin = new URL(env.url).origin;
  onLog(`Starting browser login and header capture for user ${selectedUser.userID}...`);

  function toAbsoluteUrl(value: string): string {
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) return `${serviceOrigin}${value}`;
    return `${serviceOrigin}/${value}`;
  }

  function buildProbeUrls(): string[] {
    const tokens = requestPattern
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    const urls = new Set<string>();

    for (const token of tokens) {
      urls.add(toAbsoluteUrl(token));
      if (!token.startsWith("/") && !/^https?:\/\//i.test(token)) {
        if (!token.startsWith("srv-process/") && token.includes("DashboardService/")) urls.add(`${serviceOrigin}/srv-process/${token}`);
        if (!token.startsWith("srv-approver/") && token.includes("ApproverService/")) urls.add(`${serviceOrigin}/srv-approver/${token}`);
        if (!token.startsWith("srv-process/") && token.includes("CommonProcessService/")) urls.add(`${serviceOrigin}/srv-process/${token}`);
      }
    }

    urls.add(`${serviceOrigin}/srv-process/CommonProcessService/getBusinessRequest`);
    urls.add(`${serviceOrigin}/srv-process/DashboardService/DashboardThreshold`);
    urls.add(`${serviceOrigin}/srv-approver/ApproverService/myInbox`);
    return Array.from(urls);
  }

  const browser = await getSharedBrowser(playwrightModule, true);
  const context = await browser.newContext({ locale: env.capture.acceptLanguage ?? "en-US" });
  const page = await context.newPage();

  let captured: TCapturedSession | null = null;

  page.on("request", (request: any) => {
    if (!requestRegex.test(request.url())) return;
    captured = {
      method: request.method(),
      url: request.url(),
      headers: request.headers(),
      body: request.postData() ?? undefined,
      capturedAt: new Date().toISOString(),
    };
    onLog(`Captured matching request: ${request.method()} ${request.url()}`);
  });

  try {
    await performLoginFormSubmit(page, env, selectedUser, onLog);

    if (env.capture.triggerSelector) {
      await page.click(env.capture.triggerSelector).catch(() => undefined);
    }

    if (!captured) {
      try {
        onLog(`Waiting up to ${CAPTURE_AUTO_REQUEST_GRACE_MS}ms for the app to fire the request on its own...`);
        await page.waitForRequest((req: any) => requestRegex.test(req.url()), { timeout: CAPTURE_AUTO_REQUEST_GRACE_MS });
      } catch {
        const probeUrls = buildProbeUrls();
        onLog(`No direct request yet. Probing ${probeUrls.length} candidate URLs.`);
        const cookies = await context.cookies();
        const cookieHeader = cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join("; ");

        for (const probeUrl of probeUrls) {
          try {
            const probeResponse = await page.request.get(probeUrl, { headers: { accept: "application/json, text/plain, */*" } });
            if (probeResponse.status() < 500) {
              captured = {
                method: "GET",
                url: probeUrl,
                capturedAt: new Date().toISOString(),
                headers: {
                  accept: "application/json, text/plain, */*",
                  "accept-language": env.capture.acceptLanguage ?? "en-US",
                  cookie: cookieHeader,
                  referer: env.url,
                },
              };
              break;
            }
          } catch {
            // try next probe URL
          }
        }
      }
    }

    if (!captured) {
      throw new Error(`Browser login flow completed but no matching request/probe succeeded for ${env.displayName}.`);
    }

    return captured;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export type TLiveCaptureOptions = {
  /** Optional regex source to match a specific API call; omit to use the first authenticated XHR/fetch. */
  requestUrlPattern?: string;
  /** How long to wait for the user to log in and trigger a matching request. */
  timeoutMs?: number;
  onLog?: (message: string) => void;
};

/**
 * Credential-free "quick" capture: opens a VISIBLE browser window at `url`, lets the user
 * log in manually (or reuse an already-authenticated session), and automatically captures
 * the first authenticated XHR/fetch request's headers the moment it fires — no DevTools
 * "Copy as fetch" step required. Mirrors the credentialed flow's network-listening idea
 * without auto-filling any form.
 */
export async function captureSessionFromLiveBrowser(url: string, options: TLiveCaptureOptions = {}): Promise<TCapturedSession> {
  const { requestUrlPattern, timeoutMs = 180_000, onLog = (): void => undefined } = options;
  const requestRegex = requestUrlPattern ? new RegExp(requestUrlPattern) : null;

  const playwrightModule = await loadPlaywright();
  const browser = await getSharedBrowser(playwrightModule, false);
  const context = await browser.newContext();
  const page = await context.newPage();

  let settled = false;
  const pendingByKey = new Map<string, any>();

  function isCandidateRequest(request: any): boolean {
    const resourceType = request.resourceType();
    if (resourceType !== "xhr" && resourceType !== "fetch") return false;
    const headers = request.headers();
    if (!headers["cookie"] && !headers["authorization"]) return false;
    if (requestRegex && !requestRegex.test(request.url())) return false;
    return true;
  }

  const capturePromise = new Promise<TCapturedSession>((resolve) => {
    page.on("request", (request: any) => {
      if (settled || !isCandidateRequest(request)) return;
      pendingByKey.set(`${request.method()}|${request.url()}`, request);
      onLog(`Watching candidate request: ${request.method()} ${request.url()}`);
    });

    page.on("response", (response: any) => {
      if (settled) return;
      const request = response.request();
      const key = `${request.method()}|${request.url()}`;
      const pending = pendingByKey.get(key);
      if (!pending) return;

      if (response.status() >= 400) {
        pendingByKey.delete(key);
        return;
      }

      settled = true;
      onLog(`Captured matching request: ${request.method()} ${request.url()} (${response.status()})`);
      resolve({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        body: request.postData() ?? undefined,
        capturedAt: new Date().toISOString(),
      });
    });
  });

  onLog(`Opening ${url} in a browser window. Log in manually — the session is captured automatically once an authenticated API call is seen.`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => undefined);

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for an authenticated request. Log in and use the app so it makes an API call, then try again.`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([capturePromise, timeoutPromise]);
  } finally {
    settled = true;
    await context.close().catch(() => undefined);
  }
}

// Each open login window is a whole standalone Chromium process (several OS sub-processes),
// deliberately left running for the person to use. Without tracking, clicking "Login" again
// for the same environment/user (a double-click, or re-checking a session) would launch yet
// another one on top of it — unbounded accumulation that can starve the machine's resources
// (observed: enough concurrently-open browsers made a new one fail to even load a page with
// net::ERR_NETWORK_IO_SUSPENDED). Track windows by envId|userID so a repeat request reuses
// the still-open one instead of piling up a duplicate.
const openLoginWindowsByKey = new Map<string, { browser: any; page: any }>();

function loginWindowKey(envId: string, userID: string): string {
  return `${envId} ${userID}`;
}

/**
 * Opens a dedicated, visible browser window, logs into `env` as `selectedUser`, and leaves
 * the window open for the person to use the real app directly — no proxy/reverse-forwarding
 * involved. Unlike the shared headless browser used for capture, this launches its own
 * standalone browser instance per call (so it isn't recycled/closed by other proxy
 * operations) and deliberately never closes it; the window stays open until the user closes
 * it themselves. Calling this again for the same environment/user while that window is still
 * open brings it to the front instead of opening a second one.
 */
export async function openLoggedInBrowserWindow(env: TResolvedProxyEnvironment, selectedUser: TProxyUserCredential, onLog: (message: string) => void = (): void => undefined): Promise<void> {
  const key = loginWindowKey(env.id, selectedUser.userID);
  const existing = openLoginWindowsByKey.get(key);
  if (existing && existing.browser.isConnected()) {
    onLog(`A browser window logged in as ${selectedUser.userID} is already open — bringing it to the front.`);
    await existing.page.bringToFront().catch(() => undefined);
    return;
  }

  const playwrightModule = await loadPlaywright();
  const browser = await playwrightModule.chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: env.capture.acceptLanguage ?? "en-US" });
  const page = await context.newPage();

  try {
    await performLoginFormSubmit(page, env, selectedUser, onLog);
    onLog(`Logged in as ${selectedUser.userID}. Browser window left open — use it directly.`);
    openLoginWindowsByKey.set(key, { browser, page });
    browser.on("disconnected", () => {
      if (openLoginWindowsByKey.get(key)?.browser === browser) {
        openLoginWindowsByKey.delete(key);
      }
    });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { callCapApi, fetchXsuaaAccessToken } from "./check-api-service";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Simulates a genuinely hanging request (never resolves on its own) that DOES respect the AbortSignal it's given — exactly like a real `fetch` would, so this exercises the real timeout path without an actual multi-second wait in the test. */
function installHangingFetch(): void {
  globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // would hang forever — every call under test always passes a signal
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  }) as unknown as typeof fetch;
}

describe("check-api-service — request timeouts", () => {
  it("fetchXsuaaAccessToken rejects with a clear, actionable message instead of hanging forever", async () => {
    installHangingFetch();
    const credential = { clientId: "id", clientSecret: "secret", url: "https://uaa.example.com" };

    await expect(fetchXsuaaAccessToken(credential, 20)).rejects.toThrow(/XSUAA token request timed out after/);
  });

  it("callCapApi rejects with a clear, actionable message when the actual function call hangs — e.g. an on-premise call via Cloud Connector that never returns", async () => {
    installHangingFetch();
    const credential = { clientId: "id", clientSecret: "secret", url: "https://uaa.example.com" };

    await expect(
      callCapApi({
        credential,
        baseUrl: "https://app.example.com",
        path: "/BusinessPartnerProcessService/getObjectOnPremiseData",
        method: "POST",
        body: { onPremiseObjectID: "2000113667" },
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out after/);
  });

  it("a normal, fast response still works — the timeout never fires on a healthy call", async () => {
    let tokenCallCount = 0;
    globalThis.fetch = vi.fn(async (url: unknown) => {
      tokenCallCount += 1;
      if (String(url).includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await callCapApi({
      credential: { clientId: "id", clientSecret: "secret", url: "https://uaa.example.com" },
      baseUrl: "https://app.example.com",
      path: "/BusinessPartnerProcessService/getObjectOnPremiseData",
      method: "POST",
      body: { onPremiseObjectID: "2000113667" },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(tokenCallCount).toBe(2);
  });
});

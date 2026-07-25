import { beforeEach, describe, expect, it, vi } from "vitest";

const withCfTarget = vi.fn();
vi.mock("../cf/cf-target-switcher", () => ({
  withCfTarget: (...args: unknown[]) => withCfTarget(...args),
}));

const listAppsInContext = vi.fn();
const detectAppDatabaseServicesInContext = vi.fn();
const buildDraftFromCandidate = vi.fn();
vi.mock("../db/db-btp", () => ({
  listAppsInContext: (...args: unknown[]) => listAppsInContext(...args),
  detectAppDatabaseServicesInContext: (...args: unknown[]) => detectAppDatabaseServicesInContext(...args),
  buildDraftFromCandidate: (...args: unknown[]) => buildDraftFromCandidate(...args),
}));

const upsertConnectionFromDraft = vi.fn();
vi.mock("../db/db-cache", () => ({
  upsertConnectionFromDraft: (...args: unknown[]) => upsertConnectionFromDraft(...args),
}));

vi.mock("../tool/studio/job-events", () => ({
  emitJobEvent: vi.fn(),
}));

const { discoverAuditLogEnvironments } = await import("./audit-log-discovery");

const target = { region: "us20", org: "mckesson-qas-simplemdg", space: "app" };

beforeEach(() => {
  vi.clearAllMocks();
  withCfTarget.mockImplementation(async (_key: string, fn: (context: unknown, target: unknown) => unknown) => fn({}, target));
  buildDraftFromCandidate.mockImplementation((candidate: { type: string; serviceName: string }, ctx: unknown) => ({ candidate, ctx }));
  upsertConnectionFromDraft.mockImplementation(async (draft: unknown) => ({ id: `conn-for-${JSON.stringify(draft)}` }));
});

describe("discoverAuditLogEnvironments — app probe priority", () => {
  it("prefers the shared *-srv-process-system app over an unrelated app with a bound database, even when the unrelated app is listed first (confirmed real bug: a same-space 'copilot-ai-backend' app was picked instead)", async () => {
    listAppsInContext.mockResolvedValue([
      { name: "copilot-ai-backend" },
      { name: "simplemdg-db-advanalytics" },
      { name: "simplemdg-srv-process-system" },
    ]);
    // Every candidate app in this space happens to have SOME bound db — the whole point of the
    // fix is which one gets tried FIRST, not which ones are capable of yielding a candidate.
    detectAppDatabaseServicesInContext.mockImplementation(async (_ctx: unknown, appName: string) => [{ type: "hana", serviceName: `svc-${appName}` }]);

    const [result] = await discoverAuditLogEnvironments(["us20::mckesson-qas-simplemdg::app"]);

    expect(result.status).toBe("ready");
    expect(result.appName).toBe("simplemdg-srv-process-system");
    expect(detectAppDatabaseServicesInContext).toHaveBeenCalledWith(expect.anything(), "simplemdg-srv-process-system");
    expect(detectAppDatabaseServicesInContext).not.toHaveBeenCalledWith(expect.anything(), "copilot-ai-backend");
  });

  it("prefers any simplemdg-named app over an unrelated app when no srv-process-system app exists", async () => {
    listAppsInContext.mockResolvedValue([{ name: "copilot-ai-backend" }, { name: "simplemdg-db-bp" }]);
    detectAppDatabaseServicesInContext.mockImplementation(async (_ctx: unknown, appName: string) => [{ type: "hana", serviceName: `svc-${appName}` }]);

    const [result] = await discoverAuditLogEnvironments(["us20::mckesson-qas-simplemdg::app"]);

    expect(result.appName).toBe("simplemdg-db-bp");
  });

  it("still falls back to an unrelated app as a last resort when nothing simplemdg-named has a database", async () => {
    listAppsInContext.mockResolvedValue([{ name: "copilot-ai-backend" }, { name: "simplemdg-db-empty" }]);
    detectAppDatabaseServicesInContext.mockImplementation(async (_ctx: unknown, appName: string) => (appName === "copilot-ai-backend" ? [{ type: "hana", serviceName: "svc" }] : []));

    const [result] = await discoverAuditLogEnvironments(["us20::mckesson-qas-simplemdg::app"]);

    expect(result.status).toBe("ready");
    expect(result.appName).toBe("copilot-ai-backend");
  });

  it("reports no-db-found when no app in the space has a bound database at all", async () => {
    listAppsInContext.mockResolvedValue([{ name: "simplemdg-db-bp" }]);
    detectAppDatabaseServicesInContext.mockResolvedValue([]);

    const [result] = await discoverAuditLogEnvironments(["us20::mckesson-qas-simplemdg::app"]);
    expect(result.status).toBe("no-db-found");
  });
});

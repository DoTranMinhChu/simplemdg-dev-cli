import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake filesystem — this test must NEVER touch the real
// ~/.simplemdg/db-connections.json (real, sensitive user credential data).
let store: Record<string, unknown> | undefined;

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(async () => store !== undefined),
    readJson: vi.fn(async () => store),
    writeJson: vi.fn(async (_path: string, value: unknown) => {
      store = value as Record<string, unknown>;
    }),
    ensureDir: vi.fn(async () => undefined),
  },
}));

const { upsertConnectionFromDraft } = await import("./db-cache");
import type { TConnectionDraft } from "./db-cache";

function baseDraft(overrides: Partial<TConnectionDraft>): TConnectionDraft {
  return {
    name: "test",
    type: "hana",
    host: "example.hanacloud.ondemand.com",
    port: 443,
    username: "u",
    password: "p",
    app: "simplemdg-srv-process-system",
    serviceName: "simplemdg-process",
    ...overrides,
  };
}

beforeEach(() => {
  store = undefined;
});

describe("upsertConnectionFromDraft — dedup key", () => {
  it("creates SEPARATE connection profiles for the same app+service name in two different orgs (confirmed real bug: DEV and QAS both have a 'simplemdg-srv-process-system' app, and used to collide onto one row)", async () => {
    const dev = await upsertConnectionFromDraft(baseDraft({ region: "us20", org: "mckesson-dev-simplemdg", space: "app", host: "dev-host" }));
    const qas = await upsertConnectionFromDraft(baseDraft({ region: "us20", org: "mckesson-qas-simplemdg", space: "app", host: "qas-host" }));

    expect(dev.id).not.toBe(qas.id);

    const cache = store as { connections: Array<{ id: string; host: string; org: string }> };
    expect(cache.connections).toHaveLength(2);
    const devRow = cache.connections.find((c) => c.id === dev.id)!;
    const qasRow = cache.connections.find((c) => c.id === qas.id)!;
    expect(devRow.host).toBe("dev-host");
    expect(devRow.org).toBe("mckesson-dev-simplemdg");
    expect(qasRow.host).toBe("qas-host");
    expect(qasRow.org).toBe("mckesson-qas-simplemdg");
  });

  it("still reuses the SAME row (upsert-in-place) when app+service+org+space+region+type all match — re-discovering the same environment doesn't duplicate rows", async () => {
    const first = await upsertConnectionFromDraft(baseDraft({ region: "us20", org: "mckesson-dev-simplemdg", space: "app", host: "dev-host-1" }));
    const second = await upsertConnectionFromDraft(baseDraft({ region: "us20", org: "mckesson-dev-simplemdg", space: "app", host: "dev-host-2" }));

    expect(second.id).toBe(first.id);
    const cache = store as { connections: Array<{ id: string; host: string }> };
    expect(cache.connections).toHaveLength(1);
    expect(cache.connections[0].host).toBe("dev-host-2");
  });

  it("treats the same org+app+service in two different spaces as separate connections too", async () => {
    const a = await upsertConnectionFromDraft(baseDraft({ region: "us20", org: "mckesson-dev-simplemdg", space: "app", host: "space-a-host" }));
    const b = await upsertConnectionFromDraft(baseDraft({ region: "us20", org: "mckesson-dev-simplemdg", space: "staging", host: "space-b-host" }));

    expect(a.id).not.toBe(b.id);
  });
});

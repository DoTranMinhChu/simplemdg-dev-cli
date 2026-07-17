import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMcpServer } from "./plugin-mcp";
import type { TMcpServerSpec } from "./plugin-types";

const { runCommand } = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("../process", () => ({ runCommand }));

describe("addMcpServer — stdio transport", () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  it("removes then adds via npx, reporting registered: true", async () => {
    runCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const spec: TMcpServerSpec = { name: "playwright-chrome", package: "@playwright/mcp@latest", args: ["--browser", "chrome"] };

    const result = await addMcpServer(spec, "user");

    expect(result).toEqual({ registered: true });
    expect(runCommand).toHaveBeenNthCalledWith(1, "claude", ["mcp", "remove", "playwright-chrome", "-s", "user"]);
    const addCall = runCommand.mock.calls[1];
    expect(addCall[0]).toBe("claude");
    expect(addCall[1]).toEqual(expect.arrayContaining(["mcp", "add", "playwright-chrome", "-s", "user"]));
  });

  it("throws when the add command fails", async () => {
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }).mockResolvedValueOnce({ stdout: "", stderr: "boom", exitCode: 1 });
    const spec: TMcpServerSpec = { name: "x", package: "pkg", args: [] };

    await expect(addMcpServer(spec, "user")).rejects.toThrow(/Failed to register MCP server "x"/);
  });
});

describe("addMcpServer — http transport", () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  const spec: TMcpServerSpec = { name: "smdg-atlassian", transport: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" };

  it("registers with -s between name and url when not already present", async () => {
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }).mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const result = await addMcpServer(spec, "user");

    expect(result).toEqual({ registered: true });
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(1, "claude", ["mcp", "list"]);
    expect(runCommand).toHaveBeenNthCalledWith(2, "claude", ["mcp", "add", "--transport", "http", "smdg-atlassian", "-s", "user", "https://mcp.atlassian.com/v1/mcp/authv2"]);
  });

  it("skips registration entirely when already present — never removes an existing OAuth session", async () => {
    runCommand.mockResolvedValueOnce({ stdout: "smdg-atlassian: https://mcp.atlassian.com/v1/mcp/authv2 (HTTP)\n", stderr: "", exitCode: 0 });

    const result = await addMcpServer(spec, "user");

    expect(result).toEqual({ registered: false });
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith("claude", ["mcp", "list"]);
  });

  it("throws when the add command fails", async () => {
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }).mockResolvedValueOnce({ stdout: "", stderr: "network error", exitCode: 1 });

    await expect(addMcpServer(spec, "user")).rejects.toThrow(/Failed to register MCP server "smdg-atlassian"/);
  });
});

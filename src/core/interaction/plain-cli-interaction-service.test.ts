import { describe, expect, it, vi } from "vitest";
import { PlainCliInteractionService } from "./plain-cli-interaction-service";

describe("PlainCliInteractionService.notify", () => {
  it("prints a step notification as 'Step X/Y  message', matching today's printStep() format", () => {
    const service = new PlainCliInteractionService();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    service.notify({ level: "step", message: "Search commits", current: 2, total: 8 });

    const printed = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain("Step 2/8");
    expect(printed).toContain("Search commits");
    logSpy.mockRestore();
  });

  it("prints plain info messages without extra styling", () => {
    const service = new PlainCliInteractionService();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    service.notify({ level: "info", message: "Not pushed. You can push later." });

    expect(logSpy).toHaveBeenCalledWith("Not pushed. You can push later.");
    logSpy.mockRestore();
  });
});

describe("PlainCliInteractionService.progress", () => {
  it("is a no-op passthrough that never prints anything extra (today's console.log calls already cover progress)", async () => {
    const service = new PlainCliInteractionService();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await service.progress({ label: "Cherry-picking" }, async (report) => {
      report({ current: 1, total: 3 });
      report({ current: 2, total: 3 });
      return "done";
    });

    expect(result).toBe("done");
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

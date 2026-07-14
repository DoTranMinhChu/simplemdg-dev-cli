import { describe, expect, it } from "vitest";
import { InkInteractionService } from "./ink-interaction-service";
import { InteractionCancelledError } from "../../core/interaction/interaction-service";

describe("InkInteractionService", () => {
  it("resolves a select() call when the pending request is resolved by its id", async () => {
    const controller = new AbortController();
    const service = new InkInteractionService(controller.signal);

    const promise = service.select({ message: "Pick one", choices: [{ title: "A", value: "a" }] });
    const pending = service.getCurrentRequest();
    expect(pending?.kind).toBe("select");

    service.resolveCurrent(pending!.id, "a");
    await expect(promise).resolves.toBe("a");
    expect(service.getCurrentRequest()).toBeUndefined();
  });

  it("rejects the pending request when the AbortSignal fires mid-request (Ctrl+C cancels the active workflow)", async () => {
    const controller = new AbortController();
    const service = new InkInteractionService(controller.signal);

    const promise = service.confirm({ message: "Continue?" });
    expect(service.getCurrentRequest()).toBeDefined();

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(InteractionCancelledError);
    expect(service.getCurrentRequest()).toBeUndefined();
  });

  it("rejects immediately, without ever creating a pending request, once the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const service = new InkInteractionService(controller.signal);

    await expect(service.input({ message: "Name?" })).rejects.toBeInstanceOf(InteractionCancelledError);
    expect(service.getCurrentRequest()).toBeUndefined();
  });

  it("ignores a resolveCurrent() call whose id no longer matches the current pending request (stale widget)", async () => {
    const controller = new AbortController();
    const service = new InkInteractionService(controller.signal);

    const first = service.select({ message: "First", choices: [{ title: "A", value: "a" }] });
    const staleId = service.getCurrentRequest()!.id;

    // A new request replaces the pending one before the first resolves (e.g. Escape then a new prompt).
    service.rejectCurrentRequest(staleId, new InteractionCancelledError());
    const second = service.select({ message: "Second", choices: [{ title: "B", value: "b" }] });

    // The stale id must not be able to resolve the new request.
    service.resolveCurrent(staleId, "a");
    expect(service.getCurrentRequest()?.message).toBe("Second");

    service.resolveCurrent(service.getCurrentRequest()!.id, "b");
    await expect(second).resolves.toBe("b");
    await expect(first).rejects.toBeInstanceOf(InteractionCancelledError);
  });

  it("keeps progress() reporting independent of the modal select/confirm/input/multiSelect slot", async () => {
    const controller = new AbortController();
    const service = new InkInteractionService(controller.signal);

    const progressChanges: number[] = [];
    service.on("progress-change", (active: ReturnType<InkInteractionService["getActiveProgress"]>) => {
      progressChanges.push(active.length);
    });

    const progressPromise = service.progress({ label: "Working" }, async (report) => {
      report({ current: 1, total: 2 });
      // A modal prompt can still be opened while progress is active — independent state slots.
      const confirmPromise = service.confirm({ message: "Proceed?" });
      expect(service.getActiveProgress()).toHaveLength(1);
      service.resolveCurrent(service.getCurrentRequest()!.id, true);
      await confirmPromise;
      report({ current: 2, total: 2 });
      return "done";
    });

    await expect(progressPromise).resolves.toBe("done");
    expect(service.getActiveProgress()).toHaveLength(0);
    expect(progressChanges[0]).toBe(1); // progress started
    expect(progressChanges.at(-1)).toBe(0); // progress cleared on completion
  });
});

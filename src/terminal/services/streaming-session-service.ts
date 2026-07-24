import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

export type TStreamingStatus = "running" | "stopped" | "failed";

export type TStreamLine = {
  id: number;
  text: string;
  tag?: string;
  stream: "stdout" | "stderr" | "info";
};

const MAX_BUFFER_LINES = 2000;

/**
 * The streaming analogue of InkInteractionService: a long-lived EventEmitter
 * a "sink" for live/tailing commands (log tails, HTTP watches, dev servers)
 * writes into, decoupled from whether any screen is currently mounted to
 * render it — a backgrounded session keeps buffering at full speed with zero
 * React overhead, and a screen that (re)mounts just reads `getSnapshot()`.
 */
export class StreamingSessionService extends EventEmitter {
  private lines: TStreamLine[] = [];
  private nextLineId = 0;
  private truncatedCount = 0;
  private readonly children = new Map<string, ChildProcess>();
  public status: TStreamingStatus = "running";
  public exitCode: number | undefined;
  public readonly startedAt: number;
  public readonly signal: AbortSignal;

  constructor(signal: AbortSignal) {
    super();
    this.signal = signal;
    this.startedAt = Date.now();
    this.signal.addEventListener("abort", () => this.stop(), { once: true });
  }

  getSnapshot(): { lines: TStreamLine[]; truncatedCount: number; status: TStreamingStatus; exitCode: number | undefined } {
    return { lines: this.lines, truncatedCount: this.truncatedCount, status: this.status, exitCode: this.exitCode };
  }

  /** The sink business logic writes to instead of `console.log`/`process.stdout.write`. */
  write(text: string, options?: { tag?: string; stream?: "stdout" | "stderr" | "info" }): void {
    const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (!normalized) {
      return;
    }

    for (const rawLine of normalized.split("\n")) {
      this.lines.push({ id: this.nextLineId++, text: rawLine, tag: options?.tag, stream: options?.stream ?? "stdout" });
      if (this.lines.length > MAX_BUFFER_LINES) {
        this.lines.shift();
        this.truncatedCount++;
      }
    }

    this.emit("line");
  }

  /**
   * Wires a spawned child's stdout/stderr into `write`, and its close/error
   * into status. Supports several tagged children per session (e.g. one
   * `http-watch` session watching N apps). `transform` lets a command apply
   * its own line filtering/formatting (e.g. `cf logs`'s instance/process
   * filter) before text enters the buffer — return `""` to drop a chunk.
   */
  attachChild(child: ChildProcess, options?: { tag?: string; transform?: (text: string, stream: "stdout" | "stderr") => string }): void {
    const key = options?.tag ?? "default";
    this.children.set(key, child);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = options?.transform ? options.transform(chunk.toString("utf8"), "stdout") : chunk.toString("utf8");
      if (text) this.write(text, { tag: options?.tag, stream: "stdout" });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = options?.transform ? options.transform(chunk.toString("utf8"), "stderr") : chunk.toString("utf8");
      if (text) this.write(text, { tag: options?.tag, stream: "stderr" });
    });

    child.on("close", (code) => {
      this.children.delete(key);
      if (this.children.size === 0 && this.status === "running") {
        this.exitCode = code ?? 0;
        this.setStatus(code ? "failed" : "stopped");
      }
    });

    child.on("error", () => {
      this.children.delete(key);
      this.setStatus("failed");
    });
  }

  setStatus(status: TStreamingStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.emit("status-change", status);
  }

  /** Kills every attached child. Called on user-initiated stop (Ctrl+C on this session) and automatically on the session's AbortSignal firing. */
  stop(): void {
    for (const child of this.children.values()) {
      if (!child.killed) {
        child.kill();
      }
    }
    this.children.clear();
    if (this.status === "running") {
      this.setStatus("stopped");
    }
  }
}

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  IInteractionService,
  TChoice,
  TConfirmOptions,
  TInputOptions,
  TMultiSelectOptions,
  TNotification,
  TProgressOptions,
  TProgressReport,
  TSelectOptions,
} from "../../core/interaction/interaction-service";
import { InteractionCancelledError } from "../../core/interaction/interaction-service";

type TPendingBase = { id: string };

export type TPendingConfirmRequest = TPendingBase & {
  kind: "confirm";
  message: string;
  initial?: boolean;
  resolve: (value: boolean) => void;
  reject: (error: unknown) => void;
};

export type TPendingSelectRequest = TPendingBase & {
  kind: "select";
  message: string;
  choices: TChoice[];
  allowCustomValue?: boolean;
  customValueTitle?: (value: string) => string;
  validateCustomValue?: (value: string) => true | string;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
};

export type TPendingMultiSelectRequest = TPendingBase & {
  kind: "multiSelect";
  message: string;
  choices: TChoice[];
  hint?: string;
  resolve: (value: string[]) => void;
  reject: (error: unknown) => void;
};

export type TPendingInputRequest = TPendingBase & {
  kind: "input";
  message: string;
  initial?: string;
  validate?: (value: string) => true | string;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
};

export type TPendingRequest = TPendingConfirmRequest | TPendingSelectRequest | TPendingMultiSelectRequest | TPendingInputRequest;

export type TActiveProgress = {
  id: string;
  label: string;
  current?: number;
  total?: number;
};

/**
 * Bridges plain-async business logic (git-move-code-workflow.ts, etc.) to the
 * Ink render tree. `select`/`multiSelect`/`input`/`confirm` are modal,
 * single-slot requests — business logic is a linear await-chain, so only one
 * is ever pending at a time. `progress`/`notify` are independent streams (not
 * part of the modal slot) so a progress line can render concurrently with a
 * modal prompt (e.g. cherry-pick progress + a nested conflict-resolution
 * select).
 */
export class InkInteractionService extends EventEmitter implements IInteractionService {
  private current: TPendingRequest | undefined;
  private readonly activeProgress = new Map<string, TActiveProgress>();
  public readonly signal: AbortSignal;

  constructor(signal: AbortSignal) {
    super();
    this.signal = signal;
    this.signal.addEventListener(
      "abort",
      () => {
        this.rejectCurrent(new InteractionCancelledError());
      },
      { once: true },
    );
  }

  getCurrentRequest(): TPendingRequest | undefined {
    return this.current;
  }

  getActiveProgress(): TActiveProgress[] {
    return [...this.activeProgress.values()];
  }

  /** Called by the widget currently rendered for `this.current` when the user submits a value. */
  resolveCurrent(id: string, value: unknown): void {
    if (this.current?.id !== id) {
      return; // stale widget resolving after abort/replacement — ignore
    }

    const { resolve } = this.current;
    this.current = undefined;
    this.emit("change", undefined);
    resolve(value as never);
  }

  /** Called when the user cancels the widget currently rendered for `this.current` (e.g. Escape). */
  rejectCurrentRequest(id: string, error: unknown): void {
    if (this.current?.id !== id) {
      return;
    }
    this.rejectCurrent(error);
  }

  private rejectCurrent(error: unknown): void {
    if (!this.current) {
      return;
    }

    const { reject } = this.current;
    this.current = undefined;
    this.emit("change", undefined);
    reject(error);
  }

  select<TValue extends string>(options: TSelectOptions<TValue>): Promise<TValue> {
    return new Promise<TValue>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(new InteractionCancelledError());
        return;
      }

      const id = randomUUID();
      const pending: TPendingSelectRequest = {
        id,
        kind: "select",
        message: options.message,
        choices: options.choices,
        allowCustomValue: options.allowCustomValue,
        customValueTitle: options.customValueTitle,
        validateCustomValue: options.validateCustomValue,
        resolve: (value) => resolve(value as TValue),
        reject,
      };
      this.current = pending;
      this.emit("change", pending);
    });
  }

  multiSelect<TValue extends string>(options: TMultiSelectOptions<TValue>): Promise<TValue[]> {
    return new Promise<TValue[]>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(new InteractionCancelledError());
        return;
      }

      const id = randomUUID();
      const pending: TPendingMultiSelectRequest = {
        id,
        kind: "multiSelect",
        message: options.message,
        choices: options.choices,
        hint: options.hint,
        resolve: (value) => resolve(value as TValue[]),
        reject,
      };
      this.current = pending;
      this.emit("change", pending);
    });
  }

  input(options: TInputOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(new InteractionCancelledError());
        return;
      }

      const id = randomUUID();
      const pending: TPendingInputRequest = {
        id,
        kind: "input",
        message: options.message,
        initial: options.initial,
        validate: options.validate,
        resolve,
        reject,
      };
      this.current = pending;
      this.emit("change", pending);
    });
  }

  confirm(options: TConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(new InteractionCancelledError());
        return;
      }

      const id = randomUUID();
      const pending: TPendingConfirmRequest = {
        id,
        kind: "confirm",
        message: options.message,
        initial: options.initial,
        resolve,
        reject,
      };
      this.current = pending;
      this.emit("change", pending);
    });
  }

  async progress<TResult>(
    options: TProgressOptions,
    task: (report: (update: TProgressReport) => void) => Promise<TResult>,
  ): Promise<TResult> {
    const id = randomUUID();
    this.activeProgress.set(id, { id, label: options.label });
    this.emit("progress-change", this.getActiveProgress());

    try {
      return await task((update) => {
        const existing = this.activeProgress.get(id);
        if (!existing) {
          return;
        }
        this.activeProgress.set(id, { ...existing, ...update, label: update.label ?? existing.label });
        this.emit("progress-change", this.getActiveProgress());
      });
    } finally {
      this.activeProgress.delete(id);
      this.emit("progress-change", this.getActiveProgress());
    }
  }

  notify(notification: TNotification): void {
    this.emit("notify", notification);
  }
}

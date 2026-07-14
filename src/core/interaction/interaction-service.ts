/**
 * Business logic (e.g. git-move-code-workflow.ts) depends only on this
 * interface — never on Ink/React or on the `prompts` package directly — so the
 * same workflow code runs unchanged under traditional Commander dispatch
 * (PlainCliInteractionService) and inside the interactive shell
 * (InkInteractionService).
 */

export type TChoice<TValue extends string = string> = {
  title: string;
  value: TValue;
  description?: string;
};

export type TNotifyLevel = "info" | "success" | "warn" | "error" | "muted" | "step";

export type TNotification = {
  level: TNotifyLevel;
  message: string;
  /** Present when level is "step": renders as "Step {current}/{total}  {message}". */
  current?: number;
  total?: number;
};

export type TSelectOptions<TValue extends string> = {
  message: string;
  choices: TChoice<TValue>[];
  allowCustomValue?: boolean;
  customValueTitle?: (value: string) => string;
  validateCustomValue?: (value: string) => true | string;
};

export type TMultiSelectOptions<TValue extends string> = {
  message: string;
  choices: TChoice<TValue>[];
  hint?: string;
};

export type TInputOptions = {
  message: string;
  initial?: string;
  validate?: (value: string) => true | string;
};

export type TConfirmOptions = {
  message: string;
  initial?: boolean;
};

export type TProgressReport = {
  current?: number;
  total?: number;
  label?: string;
};

export type TProgressOptions = {
  label: string;
};

export interface IInteractionService {
  select<TValue extends string>(options: TSelectOptions<TValue>): Promise<TValue>;
  multiSelect<TValue extends string>(options: TMultiSelectOptions<TValue>): Promise<TValue[]>;
  input(options: TInputOptions): Promise<string>;
  confirm(options: TConfirmOptions): Promise<boolean>;
  progress<TResult>(
    options: TProgressOptions,
    task: (report: (update: TProgressReport) => void) => Promise<TResult>,
  ): Promise<TResult>;
  notify(notification: TNotification): void;
}

/** Thrown by an IInteractionService implementation when its AbortSignal fires mid-request. */
export class InteractionCancelledError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "InteractionCancelledError";
  }
}

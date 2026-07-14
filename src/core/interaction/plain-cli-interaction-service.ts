import chalk from "chalk";
import prompts from "prompts";
import { searchableSelectChoice } from "../prompts";
import type {
  IInteractionService,
  TConfirmOptions,
  TInputOptions,
  TMultiSelectOptions,
  TNotification,
  TProgressOptions,
  TProgressReport,
  TSelectOptions,
} from "./interaction-service";
import { InteractionCancelledError } from "./interaction-service";

/**
 * Backs traditional (non-shell) Commander dispatch. Reproduces today's exact
 * behavior — `searchableSelectChoice`/raw `prompts`/`console.log`+`chalk` — so
 * scripts and CI invocations of e.g. `smdg git move-code --source ...` see
 * byte-identical output to before the interactive-shell redesign.
 */
export class PlainCliInteractionService implements IInteractionService {
  async select<TValue extends string>(options: TSelectOptions<TValue>): Promise<TValue> {
    const value = await searchableSelectChoice({
      message: options.message,
      choices: options.choices,
      allowCustomValue: options.allowCustomValue,
      customValueTitle: options.customValueTitle,
      validateCustomValue: options.validateCustomValue,
    });

    return value as TValue;
  }

  async multiSelect<TValue extends string>(options: TMultiSelectOptions<TValue>): Promise<TValue[]> {
    const response = await prompts({
      type: "multiselect",
      name: "values",
      message: options.message,
      choices: options.choices.map((choice) => ({ title: choice.title, value: choice.value })),
      hint: options.hint ?? "Space to toggle, Enter to confirm",
    });

    return (response.values ?? []) as TValue[];
  }

  async input(options: TInputOptions): Promise<string> {
    const response = await prompts({
      type: "text",
      name: "value",
      message: options.message,
      initial: options.initial ?? "",
      validate: options.validate ?? ((value: string) => (value.trim() ? true : "Value is required")),
    });

    if (response.value === undefined) {
      throw new InteractionCancelledError();
    }

    return String(response.value).trim();
  }

  async confirm(options: TConfirmOptions): Promise<boolean> {
    const response = await prompts({
      type: "confirm",
      name: "value",
      message: options.message,
      initial: options.initial ?? false,
    });

    return Boolean(response.value);
  }

  async progress<TResult>(
    _options: TProgressOptions,
    task: (report: (update: TProgressReport) => void) => Promise<TResult>,
  ): Promise<TResult> {
    // No-op in plain mode: today's explicit notify()/console.log calls at each
    // step already describe progress, so this must not print anything extra.
    return task(() => undefined);
  }

  notify(notification: TNotification): void {
    if (notification.level === "step" && notification.current !== undefined && notification.total !== undefined) {
      console.log("");
      console.log(chalk.bold.cyan(`Step ${notification.current}/${notification.total}  ${notification.message}`));
      return;
    }

    switch (notification.level) {
      case "success":
        console.log(chalk.green(notification.message));
        return;
      case "warn":
        console.log(chalk.yellow(notification.message));
        return;
      case "error":
        console.log(chalk.red(notification.message));
        return;
      case "muted":
        console.log(chalk.gray(notification.message));
        return;
      default:
        console.log(notification.message);
    }
  }
}

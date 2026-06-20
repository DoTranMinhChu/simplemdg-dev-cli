import prompts from "prompts";

const CUSTOM_VALUE_PREFIX = "__SMDG_CUSTOM_VALUE__:";

function normalizeValue(value: string): string {
  return value.trim();
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeValue(value ?? "")).filter(Boolean))];
}

function scoreMatch(input: string, value: string): number {
  const normalizedInput = input.toLowerCase().trim();
  const normalizedValue = value.toLowerCase();

  if (!normalizedInput) {
    return 0;
  }

  if (normalizedValue === normalizedInput) {
    return 100;
  }

  if (normalizedValue.startsWith(normalizedInput)) {
    return 80;
  }

  if (normalizedValue.includes(normalizedInput)) {
    return 60;
  }

  const inputParts = normalizedInput.split(/\s+/).filter(Boolean);

  if (inputParts.every((part) => normalizedValue.includes(part))) {
    return 40;
  }

  return -1;
}

function buildSearchableChoices(options: {
  input: string;
  choices: prompts.Choice[];
  allowCustomValue: boolean;
  customValueTitle?: (value: string) => string;
}): prompts.Choice[] {
  const input = normalizeValue(options.input);
  const scoredChoices = options.choices
    .map((choice, index) => {
      const title = String(choice.title ?? "");
      const value = String(choice.value ?? choice.title ?? "");
      const score = input ? Math.max(scoreMatch(input, title), scoreMatch(input, value)) : 0;

      return { choice, index, score };
    })
    .filter((item) => !input || item.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.choice);

  const hasExactMatch = options.choices.some((choice) => {
    const title = String(choice.title ?? "").trim().toLowerCase();
    const value = String(choice.value ?? choice.title ?? "").trim().toLowerCase();
    const normalizedInput = input.toLowerCase();

    return title === normalizedInput || value === normalizedInput;
  });

  if (options.allowCustomValue && input && !hasExactMatch) {
    return [
      ...scoredChoices,
      {
        title: options.customValueTitle?.(input) ?? `Use typed value: ${input}`,
        value: `${CUSTOM_VALUE_PREFIX}${input}`,
      },
    ];
  }

  return scoredChoices;
}

export async function searchableSelectChoice<TValue extends string>(options: {
  message: string;
  choices: Array<{ title: string; value: TValue; description?: string }>;
  validateCustomValue?: (value: string) => true | string;
  allowCustomValue?: boolean;
  customValueTitle?: (value: string) => string;
  limit?: number;
}): Promise<string> {
  const allowCustomValue = options.allowCustomValue ?? true;
  const validate = options.validateCustomValue ?? ((value: string) => value.trim() ? true : "Value is required");
  const choices = options.choices.map((choice) => ({
    title: choice.title,
    value: choice.value,
    description: choice.description,
  }));

  if (choices.length === 0) {
    const response = await prompts({
      type: "text",
      name: "value",
      message: options.message,
      validate,
    });

    if (!response.value) {
      throw new Error("Cancelled");
    }

    return String(response.value).trim();
  }

  const response = await prompts({
    type: "autocomplete",
    name: "value",
    message: options.message,
    choices,
    initial: 0,
    limit: options.limit ?? 12,
    suggest: async (input: string, currentChoices: prompts.Choice[]) => buildSearchableChoices({
      input,
      choices: currentChoices,
      allowCustomValue,
      customValueTitle: options.customValueTitle,
    }),
  });

  if (!response.value) {
    throw new Error("Cancelled");
  }

  const selectedValue = String(response.value);

  if (selectedValue.startsWith(CUSTOM_VALUE_PREFIX)) {
    const customValue = selectedValue.slice(CUSTOM_VALUE_PREFIX.length).trim();
    const validationResult = validate(customValue);

    if (validationResult !== true) {
      throw new Error(validationResult);
    }

    return customValue;
  }

  return selectedValue;
}

export async function searchableSelectOrInput(options: {
  message: string;
  values: string[];
  initialValue?: string;
  inputMessage?: string;
  validate?: (value: string) => true | string;
  allowCustomValue?: boolean;
  customValueTitle?: (value: string) => string;
  limit?: number;
}): Promise<string> {
  const values = uniqueValues([options.initialValue, ...options.values]);
  const choices = values.map((value) => ({ title: value, value }));
  const allowCustomValue = options.allowCustomValue ?? true;
  const validate = options.validate ?? ((value: string) => value.trim() ? true : "Value is required");

  if (choices.length > 0) {
    const response = await prompts({
      type: "autocomplete",
      name: "value",
      message: options.message,
      choices,
      initial: 0,
      limit: options.limit ?? 12,
      suggest: async (input: string, currentChoices: prompts.Choice[]) => buildSearchableChoices({
        input,
        choices: currentChoices,
        allowCustomValue,
        customValueTitle: options.customValueTitle,
      }),
    });

    if (!response.value) {
      throw new Error("Cancelled");
    }

    const selectedValue = String(response.value);

    if (selectedValue.startsWith(CUSTOM_VALUE_PREFIX)) {
      const customValue = selectedValue.slice(CUSTOM_VALUE_PREFIX.length).trim();
      const validationResult = validate(customValue);

      if (validationResult !== true) {
        throw new Error(validationResult);
      }

      return customValue;
    }

    return selectedValue;
  }

  const input = await prompts({
    type: "text",
    name: "value",
    message: options.inputMessage ?? options.message,
    initial: options.initialValue ?? values[0] ?? "",
    validate,
  });

  if (!input.value) {
    throw new Error("Cancelled");
  }

  return String(input.value).trim();
}

export async function selectFromHistoryOrInput(options: {
  message: string;
  values: string[];
  initialValue?: string;
  inputMessage?: string;
  validate?: (value: string) => true | string;
}): Promise<string> {
  return searchableSelectOrInput({
    ...options,
    allowCustomValue: true,
  });
}

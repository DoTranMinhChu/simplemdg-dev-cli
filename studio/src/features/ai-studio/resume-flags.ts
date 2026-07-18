/**
 * Curated `claude` CLI flags useful when resuming a session, with the exact descriptions from
 * `claude --help` so the picker in LaunchConfirmModal never invents wording. Kept UI-only — the
 * server (`/open-terminal`) just receives the resolved argv token array and appends it verbatim to
 * the resume/continue command; it doesn't need to know about labels or descriptions.
 */

export type TResumeFlagValue = boolean | string;

export type TResumeFlagDef =
  | { id: string; kind: "checkbox"; label: string; description: string; toArgs: () => string[] }
  | { id: string; kind: "select"; label: string; description: string; options: Array<{ value: string; label: string }>; toArgs: (value: string) => string[] }
  | { id: string; kind: "text"; label: string; description: string; placeholder?: string; toArgs: (value: string) => string[] };

export const RESUME_FLAG_DEFS: TResumeFlagDef[] = [
  {
    id: "dangerously-skip-permissions",
    kind: "checkbox",
    label: "--dangerously-skip-permissions",
    description: "Bypass all permission checks. Recommended only for sandboxes with no internet access.",
    toArgs: () => ["--dangerously-skip-permissions"],
  },
  {
    id: "permission-mode",
    kind: "select",
    label: "--permission-mode",
    description: "Permission mode to use for the session.",
    options: [
      { value: "", label: "(default)" },
      { value: "acceptEdits", label: "acceptEdits" },
      { value: "auto", label: "auto" },
      { value: "bypassPermissions", label: "bypassPermissions" },
      { value: "manual", label: "manual" },
      { value: "dontAsk", label: "dontAsk" },
      { value: "plan", label: "plan" },
    ],
    toArgs: (value) => (value ? ["--permission-mode", value] : []),
  },
  {
    id: "model",
    kind: "text",
    label: "--model",
    description: "Model for the resumed session. An alias (e.g. 'sonnet', 'opus', 'fable') or a full model name.",
    placeholder: "e.g. sonnet",
    toArgs: (value) => (value.trim() ? ["--model", value.trim()] : []),
  },
  {
    id: "add-dir",
    kind: "text",
    label: "--add-dir",
    description: "Extra directories to allow tool access to. Comma-separated for more than one.",
    placeholder: "e.g. C:\\path\\one, C:\\path\\two",
    toArgs: (value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .flatMap((dir) => ["--add-dir", dir]),
  },
  {
    id: "fork-session",
    kind: "checkbox",
    label: "--fork-session",
    description: "Create a new session ID instead of reusing the original one — the resumed conversation won't append to this session's own history.",
    toArgs: () => ["--fork-session"],
  },
  {
    id: "verbose",
    kind: "checkbox",
    label: "--verbose",
    description: "Override the verbose mode setting from config.",
    toArgs: () => ["--verbose"],
  },
  {
    id: "ide",
    kind: "checkbox",
    label: "--ide",
    description: "Automatically connect to your IDE on startup, if exactly one valid IDE is available.",
    toArgs: () => ["--ide"],
  },
];

/** Naive whitespace tokenizer for the free-form "custom flags" escape hatch — good enough for
 *  simple flag/value pairs; doesn't handle quoted spaces. Each resulting token still travels as its
 *  own argv entry (never through a shell), so there's no injection risk even for unexpected input. */
export function tokenizeCustomArgs(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

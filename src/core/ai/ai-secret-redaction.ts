// Redacts likely secrets before observation text (or a session title/preview) is ever sent to the
// browser, printed to the terminal, or written to an export file. This runs by default everywhere;
// the caller must pass an explicit `reveal: true` (a local, user-initiated action) to see the
// original observation text — see ai-studio-routes.ts. Session titles are always redacted (no
// reveal toggle for that specific field — see ai-session-store.ts's rowToSession).
//
// Every pattern has exactly 3 capture groups: (1) text to keep before the secret — a label plus
// whatever separator/spacing actually appeared in the source (empty string if there's no label to
// keep, e.g. a bare JWT), (2) the secret value itself, (3) text to keep after it (empty unless
// there's a closing quote to preserve). The replacer is the same for every rule: group1 +
// "[REDACTED]" + group3.

type TRedactionRule = { label: string; pattern: RegExp };

const RULES: TRedactionRule[] = [
  { label: "Authorization header", pattern: /(Authorization:\s*Bearer\s+)([A-Za-z0-9._~+/-]+=*)()/gi },
  { label: "Bearer token", pattern: /(\bBearer\s+)([A-Za-z0-9._~+/-]{10,}=*)()/gi },
  { label: "JWT", pattern: /()(\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)()/g },
  { label: "quoted password/secret/token field", pattern: /("?(?:password|passwd|pwd|secret|token|apikey|api_key|client_secret|access_key)"?\s*[:=]\s*")([^"]+)(")/gi },
  { label: "plain-text password/pin/credential", pattern: /((?:password|passwd|pwd|passcode|pin(?:\s*code)?|secret|token|credential)\s*[:=-]\s*)([^\s,;|]{3,})()/gi },
  { label: "API key", pattern: /()(\b(?:sk|pk|api)[-_][A-Za-z0-9]{16,}\b)()/g },
  { label: "GitLab token", pattern: /()(\bglpat-[A-Za-z0-9_-]{20,}\b)()/gi },
  { label: "GitHub token", pattern: /()(\bgh[pousr]_[A-Za-z0-9]{20,}\b)()/g },
  { label: "AWS access key", pattern: /()(\bAKIA[0-9A-Z]{16}\b)()/g },
  { label: "private key block", pattern: /()(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)()/g },
];

export function redactSecrets(text: string): string {
  if (!text) return text;
  let result = text;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, (_match, before: string, _value: string, after: string) => `${before}[REDACTED]${after}`);
  }
  return result;
}

export function containsLikelySecret(text: string): boolean {
  if (!text) return false;
  return RULES.some((rule) => new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(text));
}

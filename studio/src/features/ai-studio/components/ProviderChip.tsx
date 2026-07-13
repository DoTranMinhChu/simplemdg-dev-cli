function providerLabel(provider: string): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return provider;
}

/** Small colored pill identifying a session's provider — one glance, no need to read text elsewhere in the row. */
export function ProviderChip({ provider }: { provider: string }): React.ReactElement {
  return <span className={`ai-chip ${provider}`}>{providerLabel(provider)}</span>;
}

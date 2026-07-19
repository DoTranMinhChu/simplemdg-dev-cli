// Parsers for the GitNexus subcommands confirmed (by spike, 2026-07-19 against
// gitnexus@1.6.9) to print structured plain text rather than JSON: `list`,
// `status`, `detect-changes`. Deliberately tolerant of unrecognized lines —
// GitNexus's own text formatting is not a public contract, so every parser
// here degrades to partial/empty data instead of throwing on a future wording
// change. Keep this the ONLY file that understands these literal formats.

export type TGitNexusListEntry = {
  name: string;
  path: string;
  indexedAt?: string;
  commit?: string;
  branch?: string;
  files?: number;
  symbols?: number;
  edges?: number;
  clusters?: number;
  processes?: number;
};

function parseNumber(value: string): number | undefined {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `gitnexus list` output, e.g.:
 *   Indexed Repositories (1)
 *
 *   simplemdg-dev-cli
 *     Path:    C:\...\simplemdg-dev-cli
 *     Indexed: 7/19/2026, 7:58:03 PM
 *     Commit:  241e2d5
 *     Branch:  master
 *     Stats:   418 files, 4044 symbols, 12466 edges
 *     Clusters:   238
 *     Processes:  300
 */
export function parseGitNexusList(stdout: string): TGitNexusListEntry[] {
  const entries: TGitNexusListEntry[] = [];
  let current: TGitNexusListEntry | undefined;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^indexed repositories/i.test(trimmed)) continue;

    const match = /^([A-Za-z ]+):\s*(.*)$/.exec(trimmed);

    // Repo name headers and "Key: value" field lines share the same (2-space) indent in real
    // output — the shape of the line, not its indentation, is what distinguishes them: a header
    // is just a bare name with no "Key:" prefix at all.
    if (!match) {
      current = { name: trimmed, path: "" };
      entries.push(current);
      continue;
    }

    if (!current) continue;

    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();

    if (key === "path") current.path = value;
    else if (key === "indexed") current.indexedAt = value;
    else if (key === "commit") current.commit = value;
    else if (key === "branch") current.branch = value;
    else if (key === "clusters") current.clusters = parseNumber(value);
    else if (key === "processes") current.processes = parseNumber(value);
    else if (key === "stats") {
      const filesMatch = /([\d,]+)\s*files/i.exec(value);
      const symbolsMatch = /([\d,]+)\s*symbols/i.exec(value);
      const edgesMatch = /([\d,]+)\s*edges/i.exec(value);
      if (filesMatch) current.files = parseNumber(filesMatch[1]);
      if (symbolsMatch) current.symbols = parseNumber(symbolsMatch[1]);
      if (edgesMatch) current.edges = parseNumber(edgesMatch[1]);
    }
  }

  return entries.filter((entry) => entry.path);
}

export type TGitNexusStatusInfo = {
  repositoryPath?: string;
  branch?: string;
  indexedAt?: string;
  indexedCommit?: string;
  currentCommit?: string;
  upToDate?: boolean;
  raw: string;
};

/**
 * `gitnexus status` output (run with `cwd` set to the target repo), e.g.:
 *   Repository: C:\...\simplemdg-dev-cli
 *   Branch: master
 *   Indexed: 7/19/2026, 7:58:03 PM
 *   Indexed commit: 241e2d5
 *   Current commit: 241e2d5
 *   Status: up-to-date
 */
export function parseGitNexusStatus(stdout: string): TGitNexusStatusInfo {
  const info: TGitNexusStatusInfo = { raw: stdout };

  for (const rawLine of stdout.split("\n")) {
    const match = /^([A-Za-z ]+):\s*(.*)$/.exec(rawLine.trim());
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();

    if (key === "repository") info.repositoryPath = value;
    else if (key === "branch") info.branch = value;
    else if (key === "indexed") info.indexedAt = value;
    else if (key === "indexed commit") info.indexedCommit = value;
    else if (key === "current commit") info.currentCommit = value;
    else if (key === "status") info.upToDate = /up.?to.?date/i.test(value);
  }

  return info;
}

export type TGitNexusChangedSymbol = { name: string; filePath?: string };

export type TGitNexusDetectChanges = {
  changed: boolean;
  fileCount: number;
  symbolCount: number;
  affectedProcessCount: number;
  risk: "low" | "medium" | "high" | "unknown";
  changedSymbols: TGitNexusChangedSymbol[];
  raw: string;
};

/**
 * `gitnexus detect-changes` output, e.g.:
 *   Changes: 2 files, 3 symbols
 *   Affected processes: 0
 *   Risk level: low
 *
 *   Changed symbols:
 *     Symbol SimpleMDG Dev CLI → README.md
 * ...or "No changes detected." when the scope is empty. Each "Symbol <name> →
 * <file>" line is split into {name, filePath} — the file half is what powers
 * the affected-files list (e.g. for the AI-session comparison, which needs a
 * concrete file set to diff against files the agent actually touched).
 */
export function parseDetectChanges(stdout: string): TGitNexusDetectChanges {
  if (/no changes detected/i.test(stdout)) {
    return { changed: false, fileCount: 0, symbolCount: 0, affectedProcessCount: 0, risk: "low", changedSymbols: [], raw: stdout };
  }

  const changesMatch = /Changes:\s*(\d+)\s*files?,\s*(\d+)\s*symbols?/i.exec(stdout);
  const processesMatch = /Affected processes:\s*(\d+)/i.exec(stdout);
  const riskMatch = /Risk level:\s*(\w+)/i.exec(stdout);
  const changedSymbols: TGitNexusChangedSymbol[] = [...stdout.matchAll(/^\s*Symbol\s+(.+)$/gim)].map((match) => {
    const line = match[1].trim();
    const split = /^(.*?)\s*(?:→|->)\s*(.+)$/.exec(line);
    return split ? { name: split[1].trim(), filePath: split[2].trim() } : { name: line };
  });
  const risk = riskMatch?.[1]?.toLowerCase() ?? "unknown";

  return {
    changed: true,
    fileCount: changesMatch ? Number(changesMatch[1]) : 0,
    symbolCount: changesMatch ? Number(changesMatch[2]) : 0,
    affectedProcessCount: processesMatch ? Number(processesMatch[1]) : 0,
    risk: risk === "low" || risk === "medium" || risk === "high" ? risk : "unknown",
    changedSymbols,
    raw: stdout,
  };
}

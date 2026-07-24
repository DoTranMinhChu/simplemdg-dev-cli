import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { TextInputPrompt } from "../components/TextInputPrompt";
import { isInsideGitRepository, getGitRepoRoot } from "../../core/git/git-repository";
import { analyzeSymbolChangeImpact } from "../../core/nexus/nexus-change-impact-service";
import { getGitNexusVersion } from "../../core/nexus/gitnexus-runtime";
import { getProjectOverview } from "../../core/nexus/nexus-overview-service";
import { getSymbolContext, searchFeature } from "../../core/nexus/nexus-query-service";
import { getRepoFreshness, listAnalyzedRepos, normalizeRepoPath } from "../../core/nexus/nexus-repo-service";
import { mapInstallStatus } from "../../core/nexus/nexus-status";
import type { TNexusRepoSummary } from "../../core/nexus/nexus-types";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

function statusIcon(status: string): string {
  if (status === "ready") return "✓";
  if (status === "analyzing") return "…";
  if (status === "update-required") return "⚠";
  if (status === "index-required" || status === "setup-required") return "○";
  return "✗";
}

export function AiNexusStatusScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const version = await getGitNexusVersion();
      const install = mapInstallStatus(version);
      props.service.notify({ level: "muted", message: `${statusIcon(install.status)} ${install.message}` });

      if (install.status !== "ready") return props.onDone(true);

      const listed = await listAnalyzedRepos();
      if (!listed.ok) {
        props.service.notify({ level: "error", message: listed.message });
        return props.onDone(false);
      }
      if (listed.repos.length === 0) {
        props.service.notify({ level: "muted", message: "No repositories analyzed yet." });
        return props.onDone(true);
      }
      for (const repo of listed.repos) {
        props.service.notify({ level: "muted", message: `${statusIcon(repo.status)} ${repo.name.padEnd(28)} ${repo.path}\n    ${repo.message}` });
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function AiNexusDoctorScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const version = await getGitNexusVersion();
      const install = mapInstallStatus(version);
      props.service.notify({ level: "step", message: "Code Intelligence doctor" });
      props.service.notify({ level: "muted", message: `${statusIcon(install.status)} ${install.message}` });

      if (install.status !== "ready") return props.onDone(true);

      if (await isInsideGitRepository(process.cwd())) {
        const root = await getGitRepoRoot(process.cwd());
        const freshness = await getRepoFreshness(root);
        if (freshness.ok) {
          props.service.notify({
            level: "muted",
            message: `Current repository — branch: ${freshness.info.branch ?? "unknown"}, indexed commit: ${freshness.info.indexedCommit ?? "n/a"}, up to date: ${freshness.info.upToDate === undefined ? "unknown" : freshness.info.upToDate ? "yes" : "no"}`,
          });
        } else {
          props.service.notify({ level: "muted", message: freshness.message });
        }
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

/** Shared "resolve an already-analyzed repo" step for overview/search/trace/impact — own native picker (the traditional `resolveAnalyzedRepo` calls `searchableSelectChoice`, raw-prompts-based, directly). */
function useAnalyzedRepoPicker(props: { service: InkInteractionService; onDone: (success: boolean) => void }): {
  repo: TNexusRepoSummary | undefined;
  choices: { title: string; value: string }[] | undefined;
  pick: (name: string) => void;
} {
  const [repos, setRepos] = useState<TNexusRepoSummary[] | undefined>(undefined);
  const [repo, setRepo] = useState<TNexusRepoSummary | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const listed = await listAnalyzedRepos();
      if (!listed.ok) {
        props.service.notify({ level: "error", message: listed.message });
        return props.onDone(false);
      }
      if (listed.repos.length === 0) {
        props.service.notify({ level: "warn", message: 'No repositories have been analyzed yet. Run "ai nexus analyze <path>" first.' });
        return props.onDone(false);
      }

      if (await isInsideGitRepository(process.cwd())) {
        const root = await getGitRepoRoot(process.cwd());
        const normalizedRoot = normalizeRepoPath(root);
        const match = listed.repos.find((entry) => normalizeRepoPath(entry.path) === normalizedRoot);
        if (match) {
          setRepo(match);
          return;
        }
        props.service.notify({ level: "warn", message: 'This repository hasn\'t been analyzed yet. Run "ai nexus analyze" first.' });
        return props.onDone(false);
      }

      if (listed.repos.length === 1) {
        setRepo(listed.repos[0]);
        return;
      }

      setRepos(listed.repos);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    repo,
    choices: repos?.map((entry) => ({ title: `${entry.name}  (${entry.path})`, value: entry.name })),
    pick: (name: string) => setRepo(repos?.find((entry) => entry.name === name)),
  };
}

export function AiNexusOverviewScreen(props: TScreenProps) {
  const { repo, choices, pick } = useAnalyzedRepoPicker(props);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!repo || startedRef.current) return;
    startedRef.current = true;

    const overview = getProjectOverview(repo);
    const notify = (message: string) => props.service.notify({ level: "muted", message });
    notify(`${repo.name}\n${repo.path}`);
    notify(`Branch: ${overview.branch ?? "unknown"} — Analyzed: ${overview.indexedAt ?? "unknown"}${overview.upToDate === false ? " (out of date)" : ""}`);
    if (overview.stats) {
      notify(
        `Files: ${overview.stats.files} — Symbols: ${overview.stats.symbols} — Relationships: ${overview.stats.edges} — Clusters: ${overview.stats.clusters} — Execution flows: ${overview.stats.processes}`,
      );
    }
    props.onDone(true);
  }, [repo]);

  if (!repo) {
    if (!choices) return <Text dimColor>Loading analyzed repositories…</Text>;
    return (
      <SearchableList
        message="Select an analyzed repository"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

// Search/Trace/Impact all share the same two-step shape (pick an analyzed
// repo, then type a query) via RepoAndQueryShellWithRepoCapture below; each
// screen re-resolves the full repo summary once a query is set (cheap —
// local cache read, no network) so its own query/report logic stays in one
// place instead of threading results back through the shared shell.
async function resolveAnalyzedRepoQuietly(repoName: string): Promise<TNexusRepoSummary | undefined> {
  const listed = await listAnalyzedRepos();
  return listed.ok ? listed.repos.find((entry) => entry.name === repoName) : undefined;
}

export function AiNexusSearchScreen(props: TScreenProps) {
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [repoName, setRepoName] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!query || !repoName || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const repo = await resolveAnalyzedRepoQuietly(repoName);
      if (!repo) return props.onDone(false);

      const outcome = await searchFeature(query, { repo: repo.name });
      if (!outcome.ok) {
        props.service.notify({ level: "error", message: outcome.message });
        return props.onDone(false);
      }
      if (outcome.result.warning) {
        props.service.notify({ level: "warn", message: outcome.result.warning });
      }
      if (!outcome.result.matches.length) {
        props.service.notify({ level: "muted", message: "No matching files found." });
      } else {
        for (const match of outcome.result.matches) {
          props.service.notify({ level: "muted", message: `${match.rank}. ${match.filePath}  score ${match.score.toFixed(1)}` });
        }
      }
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, repoName]);

  return (
    <RepoAndQueryShellWithRepoCapture
      {...props}
      promptMessage="What are you looking for?"
      query={query}
      onQuery={setQuery}
      onRepo={setRepoName}
    />
  );
}

export function AiNexusTraceScreen(props: TScreenProps) {
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [repoName, setRepoName] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!query || !repoName || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const repo = await resolveAnalyzedRepoQuietly(repoName);
      if (!repo) return props.onDone(false);

      const outcome = await getSymbolContext(query, { repo: repo.name, cwd: repo.path });
      if (!outcome.ok) {
        props.service.notify({ level: "error", message: outcome.message });
        return props.onDone(false);
      }
      if (!outcome.result.found || !outcome.result.symbol) {
        props.service.notify({ level: "warn", message: `"${query}" wasn't found in the analyzed code.` });
        return props.onDone(true);
      }

      const { symbol, callers, callees } = outcome.result;
      const notify = (message: string) => props.service.notify({ level: "muted", message });
      notify(`${symbol.name}  ${symbol.filePath}`);
      notify(`Used by ${callers.length} caller(s):\n${callers.map((c) => `  - ${c.name}  ${c.filePath}`).join("\n") || "  (none)"}`);
      notify(`Calls ${callees.length} function(s):\n${callees.map((c) => `  - ${c.name}  ${c.filePath}`).join("\n") || "  (none)"}`);
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, repoName]);

  return (
    <RepoAndQueryShellWithRepoCapture
      {...props}
      promptMessage="Function or class name"
      query={query}
      onQuery={setQuery}
      onRepo={setRepoName}
    />
  );
}

export function AiNexusImpactScreen(props: TScreenProps) {
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [repoName, setRepoName] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!query || !repoName || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const repo = await resolveAnalyzedRepoQuietly(repoName);
      if (!repo) return props.onDone(false);

      if (query.includes("/") || query.endsWith(".ts")) {
        props.service.notify({
          level: "error",
          message: 'Impact analysis needs a function/class name, not a file path — use "ai nexus changes" for whole-file change impact.',
        });
        return props.onDone(false);
      }

      const outcome = await analyzeSymbolChangeImpact(repo.name, query, repo.path);
      if (!outcome.ok) {
        props.service.notify({ level: "error", message: outcome.message });
        return props.onDone(false);
      }
      props.service.notify({ level: "info", message: `Risk: ${outcome.result.risk.toUpperCase()} — ${outcome.result.riskReason}` });
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, repoName]);

  return (
    <RepoAndQueryShellWithRepoCapture
      {...props}
      promptMessage="Function or class name"
      query={query}
      onQuery={setQuery}
      onRepo={setRepoName}
    />
  );
}

/** Same as RepoAndQueryShell, but also reports which repo name was picked (or auto-resolved) so the caller can re-resolve the full TNexusRepoSummary once the query is known. */
function RepoAndQueryShellWithRepoCapture(
  props: TScreenProps & { promptMessage: string; query: string | undefined; onQuery: (value: string) => void; onRepo: (name: string) => void },
) {
  const { repo, choices, pick } = useAnalyzedRepoPicker(props);

  useEffect(() => {
    if (repo) props.onRepo(repo.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  if (!repo) {
    if (!choices) return <Text dimColor>Loading analyzed repositories…</Text>;
    return (
      <SearchableList
        message="Select an analyzed repository"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!props.query) {
    return <TextInputPrompt message={props.promptMessage} onSubmit={props.onQuery} onCancel={() => props.onDone(false)} />;
  }

  return <Text dimColor>Working…</Text>;
}

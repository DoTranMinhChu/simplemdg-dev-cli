import { useEffect, useState } from "react";
import { Button } from "../../../../components/common/Button";
import { EmptyState } from "../../../../components/common/EmptyState";
import { nexusApi } from "../../../../api/nexus-api-client";
import type { TNexusChangeImpactResult, TNexusChangeScopeInput, TNexusRepoSummary } from "../../../../api/nexus-api-types";
import { RiskBadge } from "../components/NexusBadges";
import { NexusUnavailableBanner } from "../components/NexusUnavailableBanner";
import { SuggestedNextActions } from "../components/SuggestedNextActions";

type TScopeKind = TNexusChangeScopeInput["kind"];

const SCOPE_LABELS: Record<TScopeKind, string> = {
  uncommitted: "Uncommitted changes",
  staged: "Staged changes",
  commit: "A commit",
  "branch-diff": "Branch vs. branch",
};

export function ImpactAnalysisTab({ repo, initialSymbol }: { repo: TNexusRepoSummary; initialSymbol?: string }): React.ReactElement {
  const [scopeKind, setScopeKind] = useState<TScopeKind>(initialSymbol ? "uncommitted" : "uncommitted");
  const [commitHash, setCommitHash] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("main");
  const [symbolName, setSymbolName] = useState(initialSymbol ?? "");
  const [mode, setMode] = useState<"scope" | "symbol">(initialSymbol ? "symbol" : "scope");
  const [result, setResult] = useState<TNexusChangeImpactResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [ranOnce, setRanOnce] = useState(false);

  const runScopeAnalysis = async (): Promise<void> => {
    setLoading(true);
    setRanOnce(true);
    try {
      const scope: TNexusChangeScopeInput =
        scopeKind === "commit"
          ? { kind: "commit", hash: commitHash }
          : scopeKind === "branch-diff"
            ? { kind: "branch-diff", source: sourceBranch || "HEAD", target: targetBranch }
            : { kind: scopeKind };
      setResult(await nexusApi.analyzeChangeImpact(repo.path, scope));
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : String(error) } as TNexusChangeImpactResult);
    } finally {
      setLoading(false);
    }
  };

  const runSymbolAnalysis = async (): Promise<void> => {
    if (!symbolName.trim()) return;
    setLoading(true);
    setRanOnce(true);
    try {
      setResult(await nexusApi.analyzeSymbolImpact(repo.path, symbolName.trim()));
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : String(error) } as TNexusChangeImpactResult);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialSymbol) void runSymbolAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

  return (
    <div className="tabpane-scroll">
      <div className="ai-card">
        <h3>What changed?</h3>
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <Button size="sm" variant={mode === "scope" ? "primary" : "sec"} onClick={() => setMode("scope")}>
            Git changes
          </Button>
          <Button size="sm" variant={mode === "symbol" ? "primary" : "sec"} onClick={() => setMode("symbol")}>
            A specific function or class
          </Button>
        </div>

        {mode === "scope" ? (
          <>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {(Object.keys(SCOPE_LABELS) as TScopeKind[]).map((kind) => (
                <Button key={kind} size="sm" variant={scopeKind === kind ? "primary" : "ghost"} onClick={() => setScopeKind(kind)}>
                  {SCOPE_LABELS[kind]}
                </Button>
              ))}
            </div>
            {scopeKind === "commit" && (
              <input className="input" style={{ marginTop: 8 }} placeholder="Commit hash" value={commitHash} onChange={(event) => setCommitHash(event.target.value)} />
            )}
            {scopeKind === "branch-diff" && (
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <input className="input" placeholder="Source branch (default: current)" value={sourceBranch} onChange={(event) => setSourceBranch(event.target.value)} />
                <input className="input" placeholder="Target branch" value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} />
              </div>
            )}
            <Button size="sm" style={{ marginTop: 10 }} onClick={runScopeAnalysis} disabled={loading || (scopeKind === "commit" && !commitHash.trim())}>
              {loading ? "Analyzing..." : "Analyze impact"}
            </Button>
          </>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Function or class name, e.g. addMcpServer" value={symbolName} onChange={(event) => setSymbolName(event.target.value)} />
            <Button size="sm" onClick={runSymbolAnalysis} disabled={loading || !symbolName.trim()}>
              {loading ? "Analyzing..." : "Analyze impact"}
            </Button>
          </div>
        )}
      </div>

      {!ranOnce ? null : loading ? (
        <EmptyState>
          <span className="spin" /> Analyzing...
        </EmptyState>
      ) : !result || result.status === "error" ? (
        <NexusUnavailableBanner message={result?.message ?? "Impact analysis isn't available right now."} />
      ) : !result.changed ? (
        <EmptyState>No changes found in this scope.</EmptyState>
      ) : (
        <div className="ai-card">
          <h3>{result.scopeDescription}</h3>
          <RiskBadge risk={result.risk} reason={result.riskReason} />
          {result.caveat ? <div className="note faint" style={{ marginTop: 6 }}>{result.caveat}</div> : null}

          {result.changedSymbols.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="k" style={{ marginBottom: 4 }}>
                Changed symbols
              </div>
              {result.changedSymbols.map((symbol) => (
                <div key={symbol.name} className="note">
                  - {symbol.name}
                  {symbol.detail ? <span className="faint"> ({symbol.detail})</span> : null}
                </div>
              ))}
            </div>
          )}

          {result.changedFiles && result.changedFiles.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="k" style={{ marginBottom: 4 }}>
                Changed files
              </div>
              {result.changedFiles.map((file) => (
                <div key={file.path} className="note">
                  <span className="faint">{file.status}</span> {file.path}
                </div>
              ))}
            </div>
          )}

          <SuggestedNextActions
            actions={
              result.risk === "high" || result.risk === "medium"
                ? [{ label: "Review affected files before committing", onClick: () => undefined }]
                : []
            }
          />
        </div>
      )}
    </div>
  );
}

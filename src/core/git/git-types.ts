export type TGitCommitKind = "normal" | "merge";

/** Where a candidate commit was discovered from, for display/traceability. */
export type TGitCommitSource = "grep" | "path" | "symbol" | "manual" | "dependency";

export type TGitChangedFile = {
  status: string;
  path: string;
  oldPath?: string;
};

export type TGitCandidateCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  parents: string[];
  kind: TGitCommitKind;
  files?: TGitChangedFile[];
  source: TGitCommitSource;
};

export type TGitLogRange = {
  /** Source branch name, e.g. "staging" (unqualified — always diffed as origin/<source>). */
  source: string;
  /** Target branch name, e.g. "uat" (unqualified — always diffed as origin/<target>). */
  target: string;
};

export type TGitMoveCodeInput = {
  sourceBranch: string;
  targetBranch: string;
  scope?: string;
  path?: string;
  symbol?: string;
  commit?: string;
  buildCommand?: string;
  dryRun?: boolean;
  cwd?: string;
};

export type TCherryPickPlan = {
  sourceBranch: string;
  targetBranch: string;
  releaseBranch: string;
  normalCommits: TGitCandidateCommit[];
  mergeCommits: TGitCandidateCommit[];
  warnings: string[];
};

export type TCherryPickResultKind = "success" | "empty" | "conflict" | "failure";

export type TCherryPickOutcome = {
  result: TCherryPickResultKind;
  stdout: string;
  stderr: string;
};

export type TGitConflictKind =
  | "modify-delete-ours"
  | "modify-delete-theirs"
  | "both-modified"
  | "both-added"
  | "unknown";

export type TGitConflictFile = {
  path: string;
  code: string;
  kind: TGitConflictKind;
};

export type TGitBuildResult = {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
};

export type TBuildIssue =
  | {
      kind: "missing-module";
      importPath: string;
      importerFile?: string;
      candidateFiles: string[];
    }
  | {
      kind: "type-mismatch";
      symbol?: string;
      message: string;
      candidateFiles: string[];
    }
  | {
      kind: "unknown";
      message: string;
    };

export type TGitDependencyFix = {
  commit: TGitCandidateCommit;
  files: string[];
  message: string;
};

export type TGitRepoState = {
  repositoryPath: string;
  currentBranch: string;
  isClean: boolean;
};

export type TGitMoveCodeRepoResult = {
  repositoryPath: string;
  status: "PASS" | "NO MATCH" | "CONFLICT" | "ABORTED" | "SKIPPED" | "DRY-RUN";
  releaseBranch?: string;
  message?: string;
};

/** @deprecated import `TInteractionContext` from `core/interaction/interaction-service` directly — kept as an alias so existing git-workflow imports don't need to change. */
export type { TInteractionContext as TWorkflowContext } from "../interaction/interaction-service";

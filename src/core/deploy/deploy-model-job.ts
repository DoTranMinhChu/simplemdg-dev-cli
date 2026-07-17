import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import { diffLines } from "diff";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { fetchRawFile } from "../gitlab/gitlab-client";
import { compareBranches, createBranch, commitMultipleFiles, createMergeRequest, deleteBranch, listBranches } from "../gitlab/gitlab-write-client";
import type { TGitLabCommitAction } from "../gitlab/gitlab-write-client";
import { emitJobEvent } from "../tool/studio/job-events";
import { deriveShortCodeFromRepos } from "./object-type-discovery";
import type { TObjectTypeRepoRef } from "./object-type-discovery";
import type { TObjectTypeMode } from "./deploy-target-store";
import type { TCsnContent, TEntityRenameRisk, TJoinFieldRisk } from "./csn-model-types";
import { preprocessCsnForMode } from "./csn-preprocess";
import { buildDbModelForNamespace, detectRenamedEntityLabels, findRootModel } from "./csn-model-builder";
import { buildI18nActions } from "./csn-i18n";
import { resolveCdsDkCli } from "./cds-dk-version-resolver";

const UPLOAD_ROOT = path.join(os.tmpdir(), "smdg-tool-studio", "deploy-model-uploads");

export async function saveUploadedEdmx(fileName: string, contents: Buffer): Promise<{ uploadId: string; filePath: string }> {
  const uploadId = crypto.randomUUID();
  const uploadDir = path.join(UPLOAD_ROOT, uploadId);
  await fs.ensureDir(uploadDir);
  const safeFileName = path.basename(fileName) || "model.edmx";
  const filePath = path.join(uploadDir, safeFileName);
  await fs.writeFile(filePath, contents);
  return { uploadId, filePath };
}

export async function resolveUploadPath(uploadId: string): Promise<string> {
  const uploadDir = path.join(UPLOAD_ROOT, uploadId);
  const files = await fs.readdir(uploadDir).catch(() => []);
  if (!files.length) throw new Error(`Upload not found: ${uploadId}. Re-upload the EDMX file.`);
  return path.join(uploadDir, files[0]);
}

/**
 * Runs the real (non-`--dry`) import in a disposable scratch dir and parses back the written
 * `.csn` file, rather than parsing `cds import --dry`'s stdout directly. `--dry` mixes compiler
 * warnings into the same stream as the JSON payload (confirmed empirically: `cds import` prints a
 * line like `MaxLength for type Edm.Binary should not exceed 5000` on stdout BEFORE the JSON for
 * some real customer EDMX exports), which broke `JSON.parse(stdout)` outright. The scratch dir is
 * removed afterwards either way, so there's no side-effect downside to running the real import —
 * and this guarantees the preview is byte-for-byte what the actual deploy will commit.
 */
/**
 * `objectType`/`objectTypeMode`/`repos` are optional because they aren't always known yet at
 * preview time (e.g. the F4 flow never builds a DB model) — when given, this also runs the real
 * DB-model generator far enough to collect `joinRisks` (see `csn-model-types.ts`) WITHOUT building
 * any `CommitAction`s or touching GitLab, so the user sees composition join warnings (missing
 * `<ReferentialConstraint>`, mismatched field names — the exact issue found on a real CMIR deploy)
 * before clicking Deploy, not after. A genuine validation failure (bad `@sap.label`, etc.) is
 * reported as `joinRiskError` instead of failing the whole preview — that same error surfaces again,
 * fatally, if the user proceeds to Deploy anyway.
 *
 * `repos` (when given) reproduces `runDeployModelJob`'s `MDG_<code>.xml` rename-before-import (see
 * `runEdmxImport`'s doc comment) so the CSN's root namespace prefix matches what the real deploy
 * will use — without it, `findRootModel` looks for the object type's label under whatever prefix
 * the UPLOADED FILE'S OWN NAME happens to produce, which is almost never the real one. `repos` +
 * `auth` together also resolve the same pinned `@sap/cds-dk` version `runDeployModelJob` would use
 * (see `cds-dk-version-resolver.ts`), so the preview's CSN — and its `joinRisks` — reflect exactly
 * what a real deploy will produce, not whatever's globally installed on this machine. The same fetch
 * also feeds `detectRenamedEntityLabels` — confirmed on real data to be the actual root cause of a
 * production incident (a relabeled-but-otherwise-identical entity silently became a different,
 * empty CDS entity, orphaning the real HANA table backing the old one) — so this is surfaced at the
 * earliest possible point, right after upload.
 */
export async function previewEdmxImport(
  filePath: string,
  objectType?: string,
  objectTypeMode?: TObjectTypeMode,
  repos?: TObjectTypeRepoRef[],
  auth?: TGitLabAuth,
): Promise<{ csn: unknown; entityName: string; joinRisks?: TJoinFieldRisk[]; joinRiskError?: string; cdsDkVersion?: string; renamedEntities?: TEntityRenameRisk[] }> {
  const shortCode = repos ? deriveShortCodeFromRepos(repos) : undefined;
  const entityNameOverride = shortCode ? `MDG_${shortCode.toUpperCase()}` : undefined;

  const archiveRepo = repos?.find((repo) => repo.role === "srv") ?? repos?.find((repo) => repo.role === "db");
  const resolved =
    auth && archiveRepo && entityNameOverride
      ? await resolveCdsDkCli(auth, archiveRepo.projectId, archiveRepo.defaultBranch, `${archiveRepo.role === "db" ? "db" : "srv"}/external/${entityNameOverride}.csn`).catch(() => undefined)
      : undefined;

  const { entityName, csnContent } = await runEdmxImport(filePath, entityNameOverride, resolved?.cliPath);
  const csn = JSON.parse(csnContent) as TCsnContent;
  const renamedEntities = detectRenamedEntityLabels(resolved?.previousCsn, csn);
  if (!objectType || !objectTypeMode) return { csn, entityName, cdsDkVersion: resolved?.version, renamedEntities };

  try {
    const preprocessed = preprocessCsnForMode(objectTypeMode, csn);
    const { rootModelName, shortName } = findRootModel(preprocessed, objectType);
    const built = buildDbModelForNamespace("final", preprocessed, rootModelName, objectType, shortName, objectTypeMode);
    return { csn, entityName, joinRisks: built.joinRisks, cdsDkVersion: resolved?.version, renamedEntities };
  } catch (error) {
    return { csn, entityName, joinRiskError: error instanceof Error ? error.message : String(error), cdsDkVersion: resolved?.version, renamedEntities };
  }
}

export type TImportedCdsFiles = { entityName: string; csnContent: string; xmlContent: string };

/**
 * Runs the REAL `cds import <file>` (non-dry) in a scratch CAP-project-stub directory, then reads
 * back the exact `srv/external/<name>.csn` + `srv/external/<name>.xml` pair it writes — this is
 * the same artifact shape found in real customer `simplemdg_srv_*` repos (`srv/external/MDG_PRD.csn`,
 * `MDG_PRD.xml`), so committing these two files verbatim reproduces what the legacy tool's XML
 * import step actually produced.
 *
 * `entityNameOverride` reproduces the legacy tool's naming: `cds import` derives the CSN's root
 * namespace prefix from the INPUT FILE'S OWN NAME, and legacy always renamed the upload to
 * `MDG_<shortCode>.xml` before importing it. Without the override, the prefix is whatever the
 * uploaded file happened to be called (e.g. `CMIR_v2` for "CMIR v2.xml") — confirmed against a real
 * upload that this does NOT match the customer's actual db repo (which expects `MDG_CMI...`), so the
 * DB-model builder's root-entity lookup fails and (had it not failed loudly) would have generated
 * content under the wrong CDS namespace and archived external files under the wrong file names,
 * alongside — not replacing — the real `MDG_CMI.csn`/`.xml` already in the repo. Callers pass this
 * whenever they've derived the object type's short code (see `deriveShortCodeFromRepos`).
 *
 * `cdsCliPath` (see `cds-dk-version-resolver.ts`), when given, is invoked directly instead of
 * whatever `cds` resolves to on the running machine's PATH — never rely on an ambient global
 * install here: confirmed on real data that a different `@sap/cds-dk` version changes the CSN it
 * produces (not just cosmetically), so every call site that cares about matching a specific
 * customer repo's history must pin an exact version rather than drift with whatever's installed
 * wherever this tool happens to run.
 */
export async function runEdmxImport(filePath: string, entityNameOverride?: string, cdsCliPath?: string): Promise<TImportedCdsFiles> {
  const entityName = entityNameOverride || path.basename(filePath, path.extname(filePath));
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "smdg-cds-import-"));
  try {
    await fs.writeJson(path.join(scratchDir, "package.json"), { name: "tool-studio-import-scratch", cds: {} });
    const localFileName = `${entityName}${path.extname(filePath)}`;
    const localFile = path.join(scratchDir, localFileName);
    await fs.copy(filePath, localFile);

    const result = cdsCliPath
      ? await execa(process.execPath, [cdsCliPath, "import", localFile], { cwd: scratchDir, reject: false })
      : await execa("cds", ["import", localFile], { cwd: scratchDir, reject: false });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "cds import failed");
    }

    const externalDir = path.join(scratchDir, "srv", "external");
    const csnPath = path.join(externalDir, `${entityName}.csn`);
    const xmlPath = path.join(externalDir, localFileName);

    const [rawCsnContent, xmlContent] = await Promise.all([fs.readFile(csnPath, "utf8"), fs.readFile(xmlPath, "utf8")]);
    // `cds import`'s own JSON.stringify indent isn't stable across environments (confirmed: the
    // exact same pinned `@sap/cds-dk@7.9.10` wrote 1-space indent here but every already-committed
    // customer file uses 2-space) — re-serialize to a fixed indent so a re-deploy's diff reflects
    // only real content changes, not incidental whitespace churn from wherever `cds import` ran.
    const csnContent = `${JSON.stringify(JSON.parse(rawCsnContent), null, 2)}\n`;
    return { entityName, csnContent, xmlContent };
  } finally {
    await fs.remove(scratchDir).catch(() => undefined);
  }
}

export type TDeployModelOptions = {
  auth: TGitLabAuth;
  uploadId: string;
  repos: TObjectTypeRepoRef[];
  /**
   * `"f4"` deploys target the single shared, db-only `simplemdg_db_f4` repo (see
   * object-type-discovery.ts's synthetic "f4" entry) and commit to `db/external/*` — every other
   * object type targets its db/srv/srv_process repos. Confirmed against the legacy tool's
   * `F4_MODEL_REPO` handling, which never touches a db/srv counterpart the way a normal object type
   * deploy does.
   */
  objectTypeSlug: string;
  /**
   * The object type's display name as it appears in the CSN's `@sap.label` (e.g.
   * `_laidonBuild.yaml`'s `build.flow.envObject`) — required to locate the root entity and build
   * the `db` repo's model. Only the F4 flow can omit this (it never builds a DB model).
   */
  objectType?: string;
  /** Selects which mode-specific branches the DB-model generator takes (multi-ERP mapping tables, camelCase validation, etc.) — the deploy target's `objectTypeMode`. Only the F4 flow can omit this. */
  objectTypeMode?: TObjectTypeMode;
  branchPrefix: string;
  /** Used verbatim as the MR title when non-empty (legacy tool behavior — no format/prefix validation). */
  ticketCode?: string;
  assigneeId?: number;
  reviewerIds?: number[];
};

export type TDeployModelResult = {
  entityName: string;
  mergeRequests: Array<{ role: string; pathWithNamespace: string; webUrl: string; iid: number }>;
  /**
   * Repos where the commit landed but produced zero diff against the target branch (e.g.
   * re-deploying an EDMX that converts to byte-identical CSN/XML already on the target) — the
   * legacy tool's behavior here: no MR opened, source branch auto-deleted. Kept as its own bucket
   * (not lumped into `skipped`) so the UI can tell "nothing to do" apart from a real failure.
   */
  noChange: Array<{ role: string; pathWithNamespace: string; sourceBranch: string; targetBranch: string }>;
  skipped: Array<{ role: string; pathWithNamespace: string; reason: string }>;
  renamedEntities: TEntityRenameRisk[];
};

/**
 * Deploys one EDMX upload's `external/*` artifacts into the object type's repo(s) — new branch,
 * one atomic commit, one MR each — leaving the actual SAP-runtime deployment to whatever CI merges
 * the MR, same as the legacy tool.
 */
type TDbModel = { dbActions: TGitLabCommitAction[]; srvActions: TGitLabCommitAction[]; shortName: string };

export type TDeployDiffLine = { type: "add" | "remove" | "context" | "collapsed"; text?: string; count?: number };

export type TDeployFileDiff = {
  filePath: string;
  changeType: "create" | "update" | "no-change";
  additions: number;
  deletions: number;
  lines: TDeployDiffLine[];
};

export type TDeployRepoPreview = { role: string; pathWithNamespace: string; files: TDeployFileDiff[] };

export type TDeployPreviewResult = { entityName: string; cdsDkVersion?: string; repos: TDeployRepoPreview[]; renamedEntities: TEntityRenameRisk[] };

const DIFF_CONTEXT_LINES = 3;
const DIFF_MAX_UNCHANGED_RUN = DIFF_CONTEXT_LINES * 2;

/**
 * Turns a before/after file pair into a GitHub/GitLab-style collapsed hunk view: full added/removed
 * blocks, but long unchanged runs are collapsed to a marker (keeping only a few context lines at
 * each edge) — a full CSN file can be 30KB+ for a single real content change, so sending every
 * unchanged line to the browser would be both slow and unreadable.
 */
function buildFileDiff(oldContent: string, newContent: string): { lines: TDeployDiffLine[]; additions: number; deletions: number } {
  const changes = diffLines(oldContent, newContent);
  const rawLines: TDeployDiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    const trimmed = change.value.endsWith("\n") ? change.value.slice(0, -1) : change.value;
    if (!trimmed.length) continue;
    const type: TDeployDiffLine["type"] = change.added ? "add" : change.removed ? "remove" : "context";
    for (const text of trimmed.split("\n")) {
      rawLines.push({ type, text });
      if (type === "add") additions++;
      if (type === "remove") deletions++;
    }
  }

  const collapsed: TDeployDiffLine[] = [];
  let i = 0;
  while (i < rawLines.length) {
    if (rawLines[i].type !== "context") {
      collapsed.push(rawLines[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rawLines.length && rawLines[j].type === "context") j++;
    const runLength = j - i;
    if (runLength <= DIFF_MAX_UNCHANGED_RUN) {
      collapsed.push(...rawLines.slice(i, j));
    } else {
      const headKeep = i === 0 ? 0 : DIFF_CONTEXT_LINES;
      const tailKeep = j === rawLines.length ? 0 : DIFF_CONTEXT_LINES;
      collapsed.push(...rawLines.slice(i, i + headKeep));
      collapsed.push({ type: "collapsed", count: runLength - headKeep - tailKeep });
      collapsed.push(...rawLines.slice(j - tailKeep, j));
    }
    i = j;
  }

  return { lines: collapsed, additions, deletions };
}

/**
 * Runs the CSN→CDS DB-model generator (Phase 1 of the port: `final` namespace only, see
 * `csn-model-builder.ts`) once per deploy and packages its output into ready-to-commit action
 * lists: the generated `db/final|staging/*.cds` + `db/i18n/*.properties` + a `db/index.cds`
 * maintenance line for the `db` repo, and (multi-ERP modes only) `srv/master-data-service.cds` for
 * the `srv` repo. Throws on any failure — a bad/invalid upload must abort the whole deploy before
 * any branch/commit happens anywhere, matching the legacy tool's fail-together behavior.
 */
/**
 * `db/index.cds` is a real customer-owned file that can already carry imports Phase 1 doesn't
 * generate yet — `./cons/1st-model`, `./clone_final/1st-model`, `./consolidate-model` (Phase 3),
 * DQM/migration models (Phase 4), etc. Confirmed against a real customer `db` repo: legacy
 * unconditionally overwrites this file wholesale from its own computed import list, which is safe
 * for legacy since IT generates every one of those lines itself. Phase 1 only generates the
 * final/staging pair, so blindly overwriting here would silently delete every other import already
 * on the file (breaking the customer's existing consolidation/DQM/migration setup). Instead: fetch
 * whatever's there, and only APPEND the lines Phase 1 actually needs if they're missing — never
 * reconstruct or reorder the file. Returns `undefined` (no action) when nothing needs to change.
 */
async function buildIndexCdsAction(auth: TGitLabAuth, dbRepo: TObjectTypeRepoRef, hasF4Model: boolean): Promise<TGitLabCommitAction | undefined> {
  const requiredLines = ["using from './final/1st-model';", "using from './staging/1st-model';"];
  if (hasF4Model) requiredLines.unshift("using from './f4-model';");

  const existing = await fetchRawFile(auth, dbRepo.projectId, "db/index.cds", dbRepo.defaultBranch).catch(() => undefined);
  if (existing === undefined) {
    return { action: "update", file_path: "db/index.cds", content: requiredLines.join("\n") };
  }

  const existingLines = new Set(existing.split("\n").map((line) => line.trim()));
  const missingLines = requiredLines.filter((line) => !existingLines.has(line));
  if (!missingLines.length) return undefined;

  return { action: "update", file_path: "db/index.cds", content: [existing.trimEnd(), ...missingLines].join("\n") };
}

async function buildDbModel(auth: TGitLabAuth, dbRepo: TObjectTypeRepoRef, csnContentRaw: string, objectType: string, objectTypeMode: TObjectTypeMode): Promise<TDbModel> {
  const csnContent = JSON.parse(csnContentRaw) as TCsnContent;
  const preprocessed = preprocessCsnForMode(objectTypeMode, csnContent);
  const { rootModelName, shortName } = findRootModel(preprocessed, objectType);
  const built = buildDbModelForNamespace("final", preprocessed, rootModelName, objectType, shortName, objectTypeMode);

  const hasF4Model = Boolean(await fetchRawFile(auth, dbRepo.projectId, "db/f4-model.cds", dbRepo.defaultBranch).catch(() => undefined));
  const indexCdsAction = await buildIndexCdsAction(auth, dbRepo, hasF4Model);

  return {
    dbActions: [...built.dbActions, ...buildI18nActions(built.i18nFragments), ...(indexCdsAction ? [indexCdsAction] : [])],
    srvActions: built.srvActions,
    shortName,
  };
}

type TStepStatus = "running" | "success" | "failed";
type TStepReporter = (key: string, label: string, status: TStepStatus, detail?: string) => void;

type TPreparedDeployArtifacts = {
  isF4: boolean;
  filePath: string;
  imported: TImportedCdsFiles;
  dbModel: TDbModel | undefined;
  targetRepos: TObjectTypeRepoRef[];
  cdsDkVersion?: string;
  renamedEntities: TEntityRenameRisk[];
};

/**
 * Everything shared between a real deploy and a dry-run change preview: resolve the pinned
 * cds-dk version, run the EDMX->CSN import, and (for object types with a `db` repo) generate the
 * DB model — all pure/read-only against GitLab, no branch/commit/MR calls. `report` lets the real
 * job stream progress over SSE while the preview path can pass a no-op.
 */
async function prepareDeployArtifacts(
  options: Pick<TDeployModelOptions, "auth" | "uploadId" | "repos" | "objectTypeSlug" | "objectType" | "objectTypeMode">,
  report: TStepReporter,
): Promise<TPreparedDeployArtifacts> {
  const isF4 = options.objectTypeSlug === "f4";
  // Reproduce the legacy tool's `MDG_<code>.xml` rename-before-import so the CSN's root namespace
  // prefix matches the customer's real repos (see `runEdmxImport`'s doc comment) — derived from the
  // repos' own naming convention since it isn't recoverable from the CSN/XML content itself.
  const shortCode = !isF4 ? deriveShortCodeFromRepos(options.repos) : undefined;
  const entityNameOverride = shortCode ? `MDG_${shortCode.toUpperCase()}` : undefined;

  // Never let `cds import` fall back to whatever's globally on this machine's PATH — pin to the
  // exact version that produced this object type's last archived CSN (see
  // `cds-dk-version-resolver.ts`), so re-deploying the same object type never silently changes the
  // CSN's shape just because a different machine happened to run this job.
  const archiveRepo = (isF4 ? options.repos.find((repo) => repo.role === "db") : options.repos.find((repo) => repo.role === "srv")) ?? options.repos[0];
  let cdsCliPath: string | undefined;
  let cdsDkVersion: string | undefined;
  let previousCsn: TCsnContent | undefined;
  report("cds-dk-version", "Resolve cds-dk version", "running");
  if (archiveRepo && entityNameOverride) {
    const archiveFilePath = `${isF4 ? "db" : "srv"}/external/${entityNameOverride}.csn`;
    const resolved = await resolveCdsDkCli(options.auth, archiveRepo.projectId, archiveRepo.defaultBranch, archiveFilePath);
    cdsCliPath = resolved.cliPath;
    cdsDkVersion = resolved.version;
    previousCsn = resolved.previousCsn;
    report("cds-dk-version", "Resolve cds-dk version", "success", `@sap/cds-dk@${resolved.version} (${resolved.source === "detected" ? "matches this object type's last deploy" : "default — no prior deploy found"})`);
  } else {
    report("cds-dk-version", "Resolve cds-dk version", "success", "skipped (no archive repo/short code yet)");
  }

  report("import", "Convert EDMX to CSN", "running");
  const filePath = await resolveUploadPath(options.uploadId);
  const imported = await runEdmxImport(filePath, entityNameOverride, cdsCliPath);
  report("import", "Convert EDMX to CSN", "success", imported.entityName);

  // Confirmed as a real production incident's root cause: an entity relabeled on the SAP side
  // (same EDMX EntityType, different sap:label) makes this tool silently generate a DIFFERENT CDS
  // entity, orphaning the old one's real HANA table. Surfaced as a first-class risk, not folded into
  // `joinRisks`, since its severity (real data-loss potential) and remedy (coordinate a manual HANA
  // migration, don't just re-deploy) are both categorically different.
  const renamedEntities = detectRenamedEntityLabels(previousCsn, JSON.parse(imported.csnContent) as TCsnContent);
  if (renamedEntities.length) {
    report(
      "entity-rename-check",
      "Check entity identity vs. last deploy",
      "success",
      `${renamedEntities.length} entity label change(s) detected: ${renamedEntities.map((r) => `${r.oldLabel} -> ${r.newLabel}`).join(", ")}`,
    );
  } else {
    report("entity-rename-check", "Check entity identity vs. last deploy", "success", "no label changes vs. last deploy");
  }

  const targetRepos = isF4 ? options.repos.filter((repo) => repo.role === "db") : options.repos.filter((repo) => repo.role === "db" || repo.role === "srv" || repo.role === "srv_process");
  if (!targetRepos.length) {
    throw new Error(isF4 ? "No db repo found for the F4 model." : "No db/srv/srv_process repo found for this object type.");
  }

  // For a normal (non-F4) object type, generate the `db` repo's model up front — a validation
  // failure here must abort the whole deploy before any branch/commit happens anywhere, same as the
  // legacy tool. Object types without a discovered `db` repo just skip this (unchanged from before:
  // srv/srv_process still get their external CSN/XML archive).
  let dbModel: TDbModel | undefined;
  const dbRepo = !isF4 ? targetRepos.find((repo) => repo.role === "db") : undefined;
  if (dbRepo) {
    if (!options.objectType || !options.objectTypeMode) {
      throw new Error("Missing object type name/mode — cannot generate the DB model.");
    }
    report("db-model", "Generate DB model from CSN", "running");
    try {
      dbModel = await buildDbModel(options.auth, dbRepo, imported.csnContent, options.objectType, options.objectTypeMode);
      report("db-model", "Generate DB model from CSN", "success", dbModel.shortName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report("db-model", "Generate DB model from CSN", "failed", message);
      throw error;
    }
  }

  return { isF4, filePath, imported, dbModel, targetRepos, cdsDkVersion, renamedEntities };
}

/**
 * Builds the exact `TGitLabCommitAction[]` one repo role would receive, without touching GitLab —
 * shared by the real deploy (which commits these) and the change preview (which only diffs them
 * against what's currently on the target branch).
 */
function buildRepoActions(params: { isF4: boolean; repo: TObjectTypeRepoRef; imported: TImportedCdsFiles; dbModel: TDbModel | undefined; xmlExtension: string; objectType?: string }): { actions: TGitLabCommitAction[]; commitMessage: string } {
  const { isF4, repo, imported, dbModel, xmlExtension } = params;
  // Legacy tool's commit message is a bare identifier — never the ticket code — kept separate from
  // the MR title (which IS the ticket code, verbatim, when provided).
  const actions: TGitLabCommitAction[] = [];
  let commitMessage = imported.entityName;
  // Must match `imported.entityName` (which may be the derived `MDG_<code>` override, not the
  // uploaded file's own name) — using the raw upload filename here caused a real bug: the `.csn`
  // action correctly targeted `MDG_CMI.csn` while the `.xml` action still targeted the literal
  // upload name (e.g. `CMIR v2.xml`), which doesn't exist on the branch, so GitLab rejected the
  // whole multi-file commit ("A file with this name doesn't exist") even though the `.csn` half
  // was perfectly valid.
  const xmlFileName = `${imported.entityName}${xmlExtension}`;

  if (isF4) {
    actions.push(
      { action: "create", file_path: `db/external/${imported.entityName}.csn`, content: imported.csnContent },
      { action: "create", file_path: `db/external/${xmlFileName}`, content: imported.xmlContent },
    );
    commitMessage = "F4";
  } else {
    if (repo.role === "srv" || repo.role === "srv_process") {
      actions.push(
        { action: "create", file_path: `srv/external/${imported.entityName}.csn`, content: imported.csnContent },
        { action: "create", file_path: `srv/external/${xmlFileName}`, content: imported.xmlContent },
      );
    }
    if (repo.role === "srv" && dbModel) {
      actions.push(...dbModel.srvActions.map((action) => ({ ...action, action: "create" as const })));
    }
    if (repo.role === "db" && dbModel) {
      actions.push(...dbModel.dbActions.map((action) => ({ ...action, action: "create" as const })));
      commitMessage = dbModel.shortName;
    }
  }

  return { actions, commitMessage };
}

/**
 * Dry-run counterpart to `runDeployModelJob`: builds the exact same file content a real deploy
 * would commit, diffs each file against what's currently on its repo's default branch, and returns
 * without ever creating a branch, commit, or MR. Lets the user see precisely what would change —
 * across all of db/srv/srv_process — before they click Deploy, instead of only finding out by
 * opening the MRs on GitLab afterwards.
 */
export async function previewDeployModelChanges(options: Pick<TDeployModelOptions, "auth" | "uploadId" | "repos" | "objectTypeSlug" | "objectType" | "objectTypeMode">): Promise<TDeployPreviewResult> {
  const { isF4, filePath, imported, dbModel, targetRepos, cdsDkVersion, renamedEntities } = await prepareDeployArtifacts(options, () => undefined);
  const xmlExtension = path.extname(filePath);

  const repoPreviews: TDeployRepoPreview[] = [];
  for (const repo of targetRepos) {
    const { actions } = buildRepoActions({ isF4, repo, imported, dbModel, xmlExtension });
    const files: TDeployFileDiff[] = [];
    for (const action of actions) {
      const oldContent = await fetchRawFile(options.auth, repo.projectId, action.file_path, repo.defaultBranch).catch(() => undefined);
      const newContent = action.content ?? "";
      const changeType: TDeployFileDiff["changeType"] = oldContent === undefined ? "create" : oldContent === newContent ? "no-change" : "update";
      if (changeType === "no-change") {
        files.push({ filePath: action.file_path, changeType, additions: 0, deletions: 0, lines: [] });
        continue;
      }
      const { lines, additions, deletions } = buildFileDiff(oldContent ?? "", newContent);
      files.push({ filePath: action.file_path, changeType, additions, deletions, lines });
    }
    repoPreviews.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, files });
  }

  return { entityName: imported.entityName, cdsDkVersion, repos: repoPreviews, renamedEntities };
}

export async function runDeployModelJob(jobId: string, options: TDeployModelOptions): Promise<TDeployModelResult> {
  emitJobEvent({ jobId, type: "job-started", steps: [{ key: "cds-dk-version", label: "Resolve cds-dk version", status: "running" }] });

  const report: TStepReporter = (key, label, status, detail) => emitJobEvent({ jobId, type: "job-step", steps: [{ key, label, status, detail }] });

  let prepared: TPreparedDeployArtifacts;
  try {
    prepared = await prepareDeployArtifacts(options, report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitJobEvent({ jobId, type: "job-failed", error: message });
    throw error;
  }
  const { isF4, filePath, imported, dbModel, targetRepos, renamedEntities } = prepared;

  const mergeRequests: TDeployModelResult["mergeRequests"] = [];
  const noChange: TDeployModelResult["noChange"] = [];
  const skipped: TDeployModelResult["skipped"] = [];

  const dateSuffix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const branchName = `${options.branchPrefix}-${dateSuffix}`;
  const xmlExtension = path.extname(filePath);

  for (const repo of targetRepos) {
    const stepKey = `repo-${repo.projectId}`;
    emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: create branch`, status: "running" }] });

    try {
      // `refresh: true` bypasses the branch-list cache — a stale read here (e.g. from a prior
      // attempt at this same deploy) would miss a branch that was actually created moments ago and
      // send us into `createBranch` again for no reason.
      const existingBranches = await listBranches(options.auth, repo.projectId, { search: branchName, refresh: true });
      const branchAlreadyExists = existingBranches.data.some((branch) => branch.name === branchName);
      if (!branchAlreadyExists) {
        try {
          await createBranch(options.auth, repo.projectId, branchName, repo.defaultBranch);
        } catch (createError) {
          // Belt-and-suspenders: even with a fresh read above, the branch could still already exist
          // (e.g. a previous attempt's commit landed but a later step failed) — GitLab's own 400 is
          // the authoritative check, so treat it as success and just commit onto the existing branch
          // rather than aborting the whole repo.
          const message = createError instanceof Error ? createError.message : String(createError);
          if (!/branch already exists/i.test(message)) throw createError;
        }
      }

      const { actions, commitMessage } = buildRepoActions({ isF4, repo, imported, dbModel, xmlExtension, objectType: options.objectType });

      try {
        await commitMultipleFiles(options.auth, repo.projectId, branchName, commitMessage, actions);
      } catch (createCommitError) {
        // Only retry-as-update for the specific "already exists" failure (files likely committed by
        // a prior attempt on this same branch) — anything else is a real error, and blindly retrying
        // with "update" actions would just mask it behind a second, unrelated "doesn't exist"
        // failure (confirmed: this masked a genuine file-path bug during testing).
        const message = createCommitError instanceof Error ? createCommitError.message : String(createCommitError);
        if (!/already exists/i.test(message)) throw createCommitError;
        await commitMultipleFiles(
          options.auth,
          repo.projectId,
          branchName,
          commitMessage,
          actions.map((action) => ({ ...action, action: "update" })),
        );
      }

      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: checking for changes`, status: "running" }] });
      const compare = await compareBranches(options.auth, repo.projectId, repo.defaultBranch, branchName);
      if (!compare.diffs.length) {
        await deleteBranch(options.auth, repo.projectId, branchName).catch(() => undefined);
        noChange.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, sourceBranch: branchName, targetBranch: repo.defaultBranch });
        emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: no changes, branch removed`, status: "success" }] });
        continue;
      }

      // Ticket code becomes the literal MR title (matching the legacy tool exactly — no wrapping,
      // no validation against a fixed prefix list); the fallback below only fires when it's blank.
      const repoShortName = repo.pathWithNamespace.split("/").pop() ?? repo.pathWithNamespace;
      const mrTitle = options.ticketCode?.trim() || `[${repoShortName}][${repo.defaultBranch}] Deploy ${dateSuffix}`;

      const description = isF4
        ? `Automated deploy of \`${imported.entityName}\` (db/external/*.csn + .xml) via SimpleMDG Tool Studio.`
        : repo.role === "db"
          ? `Automated DB model deploy of \`${options.objectType}\` (db/final, db/staging, db/i18n, db/index.cds) via SimpleMDG Tool Studio.`
          : `Automated deploy of \`${imported.entityName}\` (srv/external/*.csn + .xml${repo.role === "srv" && dbModel?.srvActions.length ? ", srv/master-data-service.cds" : ""}) via SimpleMDG Tool Studio.`;

      const mergeRequest = await createMergeRequest(options.auth, repo.projectId, {
        sourceBranch: branchName,
        targetBranch: repo.defaultBranch,
        title: mrTitle,
        description,
        assigneeId: options.assigneeId,
        reviewerIds: options.reviewerIds,
      });

      mergeRequests.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, webUrl: mergeRequest.web_url, iid: mergeRequest.iid });
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: MR created`, status: "success", detail: mergeRequest.web_url }] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, reason: message });
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: failed`, status: "failed", detail: message }] });
    }
  }

  emitJobEvent({ jobId, type: "job-completed", result: { entityName: imported.entityName, mergeRequests, noChange, skipped, renamedEntities } });
  return { entityName: imported.entityName, mergeRequests, noChange, skipped, renamedEntities };
}

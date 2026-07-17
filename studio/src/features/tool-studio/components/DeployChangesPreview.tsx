import { useState } from "react";
import { Collapsible } from "../../../components/common/Collapsible";
import type { TDeployPreviewResult } from "../api/tool-studio-api-client";
import { DiffFileView } from "./DiffFileView";

const CHANGE_LABEL: Record<string, string> = { create: "new", update: "changed", "no-change": "no change" };

function FileRow({ filePath, changeType, additions, deletions, lines }: TDeployPreviewResult["repos"][number]["files"][number]): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hasDiff = changeType !== "no-change";

  return (
    <div className="dm-diff-file">
      <div className="dm-diff-file-head" onClick={() => hasDiff && setOpen((value) => !value)}>
        <span className="dm-diff-caret">{hasDiff ? (open ? "▾" : "▸") : ""}</span>
        <span className={`dm-diff-badge ${changeType}`}>{CHANGE_LABEL[changeType]}</span>
        <span className="dm-diff-file-path">{filePath}</span>
        {hasDiff && (
          <span className="dm-diff-file-stats">
            {additions > 0 && <span className="add">+{additions}</span>} {deletions > 0 && <span className="del">-{deletions}</span>}
          </span>
        )}
      </div>
      {open && hasDiff && <DiffFileView lines={lines} />}
    </div>
  );
}

/** Grouped per-repo, per-file preview of exactly what a real deploy would commit — computed by diffing the freshly-generated content against each repo's current default branch, with zero branches/commits/MRs created. */
export function DeployChangesPreview({ result }: { result: TDeployPreviewResult }): React.ReactElement {
  const allFiles = result.repos.flatMap((repo) => repo.files);
  const totalAdditions = allFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = allFiles.reduce((sum, file) => sum + file.deletions, 0);
  const changedCount = allFiles.filter((file) => file.changeType !== "no-change").length;

  return (
    <div>
      <div className="dm-diff-summary">
        <span>{result.entityName}</span>
        {result.cdsDkVersion && <span>@sap/cds-dk@{result.cdsDkVersion}</span>}
        <div className="dm-diff-stat">
          {changedCount} file{changedCount === 1 ? "" : "s"} would change
          {totalAdditions > 0 && <span className="add">&nbsp;+{totalAdditions}</span>}
          {totalDeletions > 0 && <span className="del">&nbsp;-{totalDeletions}</span>}
        </div>
      </div>

      <Collapsible summary={`${result.repos.length} repo(s), ${allFiles.length} file(s) — click to view details`}>
        {result.repos.map((repo) => (
          <div key={repo.pathWithNamespace} className="dm-diff-repo">
            <div className="dm-diff-repo-head">
              <span className="dm-diff-repo-role">{repo.role}</span>
              <span>{repo.pathWithNamespace}</span>
            </div>
            {repo.files.map((file) => (
              <FileRow key={file.filePath} {...file} />
            ))}
          </div>
        ))}
      </Collapsible>
    </div>
  );
}

import { useEffect, useState } from "react";
import { CodeBlock } from "../../../components/common/CodeBlock";
import { EmptyState } from "../../../components/common/EmptyState";
import { Markdown } from "../../../components/common/Markdown";
import { pluginsApi } from "../../../api/plugins-api-client";
import { useAiStudioStore } from "../../ai-studio/state/ai-studio-store";
import { ImageGallery } from "./ImageGallery";
import type { TStudioExtensionFileEntry, TStudioExtensionInstance } from "../../../api/plugins-api-types";

/** Best-effort syntax-highlight language from a file's extension — `undefined` falls back to
 * highlight.js's auto-detection in `CodeBlock`, which is a fine default for unknown extensions. */
function languageForFile(relativePath: string): string | undefined {
  const extension = relativePath.split(".").pop()?.toLowerCase();
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "log" || extension === "txt") return undefined;
  return extension;
}

/** Generic viewer for any plugin's declared Studio extension — driven entirely by the manifest's
 * `studioExtension` block (instance glob + per-file render rules), not hardcoded to any one
 * plugin. For `smdg-jira-fix-issue` this browses `.claude/evidence/<TICKET-KEY>/` output. */
export function EvidenceExplorerPanel({
  pluginId,
  extensionLabel,
  projectRoot,
  onBack,
}: {
  pluginId: string;
  extensionLabel: string;
  projectRoot: string;
  onBack: () => void;
}): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [instances, setInstances] = useState<TStudioExtensionInstance[] | undefined>();
  const [selected, setSelected] = useState<TStudioExtensionInstance | undefined>();
  const [files, setFiles] = useState<TStudioExtensionFileEntry[] | undefined>();
  const [textByPath, setTextByPath] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!projectRoot) {
      setInstances([]);
      return;
    }
    pluginsApi
      .listStudioExtensionInstances(pluginId, projectRoot)
      .then((response) => setInstances(response.instances))
      .catch((error) => {
        toast(error instanceof Error ? error.message : String(error), "err");
        setInstances([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, projectRoot]);

  const openInstance = (instance: TStudioExtensionInstance): void => {
    setSelected(instance);
    setFiles(undefined);
    setTextByPath({});

    pluginsApi
      .listStudioExtensionFiles(pluginId, instance.name, projectRoot)
      .then(async (response) => {
        setFiles(response.files);
        const textFiles = response.files.filter((file) => file.render !== "image-gallery");
        const entries = await Promise.all(
          textFiles.map(async (file) => {
            const url = pluginsApi.studioExtensionFileUrl(pluginId, instance.name, file.relativePath, projectRoot);
            const text = await fetch(url).then((response) => response.text());
            return [file.relativePath, text] as const;
          }),
        );
        setTextByPath(Object.fromEntries(entries));
      })
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "err"));
  };

  if (!projectRoot) {
    return (
      <div className="ai-page">
        <a className="link" onClick={onBack}>
          &larr; Back
        </a>
        <EmptyState>Set a project path above to browse {extensionLabel.toLowerCase()} for that project.</EmptyState>
      </div>
    );
  }

  if (selected) {
    const imageFiles = (files ?? []).filter((file) => file.render === "image-gallery");
    const otherFiles = (files ?? []).filter((file) => file.render !== "image-gallery");

    return (
      <div className="ai-page">
        <a className="link" onClick={() => setSelected(undefined)}>
          &larr; Back to {extensionLabel.toLowerCase()} list
        </a>
        <div className="ai-page-head">
          <h1>{selected.label}</h1>
        </div>

        {!files ? (
          <EmptyState>
            <span className="spin" /> loading...
          </EmptyState>
        ) : !files.length ? (
          <EmptyState>No matching files found for this instance.</EmptyState>
        ) : (
          <>
            {otherFiles.map((file) => (
              <div key={file.relativePath} className="ai-card">
                <h3>{file.relativePath}</h3>
                {file.render === "markdown" ? (
                  <Markdown text={textByPath[file.relativePath] ?? ""} />
                ) : (
                  <CodeBlock code={textByPath[file.relativePath] ?? ""} language={languageForFile(file.relativePath)} />
                )}
              </div>
            ))}
            {imageFiles.length ? (
              <div className="ai-card">
                <h3>Screenshots</h3>
                <ImageGallery images={imageFiles.map((file) => ({ label: file.relativePath, url: pluginsApi.studioExtensionFileUrl(pluginId, selected.name, file.relativePath, projectRoot) }))} />
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="ai-page">
      <a className="link" onClick={onBack}>
        &larr; Back to plugin
      </a>
      <div className="ai-page-head">
        <h1>{extensionLabel}</h1>
        <div className="lede">Runtime artifacts captured under this project.</div>
      </div>

      {!instances ? (
        <EmptyState>
          <span className="spin" /> loading...
        </EmptyState>
      ) : !instances.length ? (
        <EmptyState>No {extensionLabel.toLowerCase()} found yet for this project.</EmptyState>
      ) : (
        <div className="plugin-list">
          {instances.map((instance) => (
            <button key={instance.name} type="button" className="ai-card plugin-card" onClick={() => openInstance(instance)}>
              <div style={{ fontWeight: 600 }}>{instance.label}</div>
              <div className="note">{instance.path}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

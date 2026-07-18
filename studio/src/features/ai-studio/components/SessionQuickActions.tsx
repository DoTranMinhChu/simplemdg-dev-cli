import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { IconButton } from "../../../components/common/IconButton";
import { ContextMenu, type TContextMenuState } from "../../../components/common/ContextMenu";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";
import { useSessionResume } from "../use-session-resume";
import { LaunchConfirmModal } from "./LaunchConfirmModal";
import { ExportDialog } from "../export/ExportDialog";
import type { TAiSession, TAiSessionLaunchResponse } from "../../../api/ai-studio-api-types";

/**
 * The one-or-two-click session launcher: primary Resume action, Copy Command, Pin, and a "More"
 * menu with the rest of the copy/open/continue actions. Every action here is provider-gated by
 * `launch.canResume`/`launch.capabilities` from the backend — nothing is invented client-side.
 */
export function SessionQuickActions({ session, lastUserPrompt }: { session: TAiSession; lastUserPrompt?: string }): React.ReactElement {
  const { toast, patchSession } = useAiStudioStore();
  const { pending, requestLaunch, confirmPending, cancelPending } = useSessionResume(toast);
  const [launch, setLaunch] = useState<TAiSessionLaunchResponse | undefined>();
  const [pinned, setPinned] = useState(session.pinned);
  const [favorite, setFavorite] = useState(session.favorite);
  const [menu, setMenu] = useState<TContextMenuState | undefined>();
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setPinned(session.pinned);
    setFavorite(session.favorite);
    aiStudioApi
      .getLaunch(session.id)
      .then(setLaunch)
      .catch(() => setLaunch(undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
  };

  const togglePinned = async (): Promise<void> => {
    const next = !pinned;
    setPinned(next);
    patchSession(session.id, { pinned: next });
    await aiStudioApi.setPinned(session.id, next);
  };

  const toggleFavorite = async (): Promise<void> => {
    const next = !favorite;
    setFavorite(next);
    patchSession(session.id, { favorite: next });
    await aiStudioApi.setFavorite(session.id, next);
  };

  const openProject = async (): Promise<void> => {
    const result = await aiStudioApi.openProject(session.id);
    if (!result.ok) toast(result.error ?? "Failed to open the project folder.", "err");
  };

  const openVsCode = async (): Promise<void> => {
    const result = await aiStudioApi.openVsCode(session.id);
    if (!result.ok) toast(result.error ?? "VS Code command-line launcher not found.", "err");
  };

  const copyContinuationPrompt = async (): Promise<void> => {
    try {
      const { prompt } = await aiStudioApi.getContinuationPrompt(session.id);
      navigator.clipboard.writeText(prompt);
      toast("Copied suggested continuation prompt.");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  const canResume = launch?.canResume ?? false;
  const resumeCommand = launch?.commands?.resume;

  return (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Button size="sm" disabled={!canResume} title={!canResume ? launch?.reason : undefined} onClick={() => requestLaunch(session, "resume")}>
        ▶ Resume in Claude Code
      </Button>
      <Button size="sm" variant="ghost" disabled={!resumeCommand} onClick={() => resumeCommand && copy(resumeCommand.command, "resume command")}>
        Copy Command
      </Button>
      <IconButton icon="pin" label={pinned ? "Unpin session" : "Pin session"} className={pinned ? "active" : ""} onClick={togglePinned} />
      <IconButton icon="star" label={favorite ? "Remove from favorites" : "Add to favorites"} className={favorite ? "active" : ""} onClick={toggleFavorite} />
      <Button
        size="sm"
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY, items: [] });
        }}
      >
        More ▾
      </Button>
      {!canResume && launch?.reason ? <span className="note">{launch.reason}</span> : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            { label: "Continue Latest Session in Project", icon: "play", onClick: () => requestLaunch(session, "continue") },
            { sep: true },
            { label: "Copy Resume Command (with cd)", icon: "copy", onClick: () => launch?.commands && copy(launch.commands.resumeWithWorkingDirectory.command, "resume command") },
            { label: "Copy Continue Command", icon: "copy", onClick: () => launch?.commands && copy(launch.commands.continueLatestInProject.command, "continue command") },
            { label: "Copy Suggested Continuation Prompt", icon: "copy", onClick: () => copyContinuationPrompt() },
            { sep: true },
            { label: "Copy Session ID", icon: "copy", onClick: () => copy(session.id, "session ID") },
            { label: "Copy Session Name", icon: "copy", onClick: () => copy(session.title || session.id, "session name") },
            { label: "Copy Project Path", icon: "copy", onClick: () => copy(session.cwd, "project path") },
            ...(session.gitBranch ? [{ label: "Copy Branch Name", icon: "copy", onClick: () => copy(session.gitBranch as string, "branch name") }] : []),
            ...(lastUserPrompt ? [{ label: "Copy Last Prompt", icon: "copy", onClick: () => copy(lastUserPrompt, "last prompt") }] : []),
            { sep: true },
            { label: "Open Project Folder", icon: "fld", onClick: () => openProject() },
            { label: "Open Project in VS Code", icon: "code", onClick: () => openVsCode() },
            { sep: true },
            { label: "Export Session…", icon: "save", onClick: () => setExportOpen(true) },
          ]}
        />
      ) : null}

      {pending ? <LaunchConfirmModal title={pending.title} launch={pending.launch} onCancel={cancelPending} onConfirm={confirmPending} /> : null}
      {exportOpen ? <ExportDialog sessionId={session.id} onClose={() => setExportOpen(false)} /> : null}
    </div>
  );
}

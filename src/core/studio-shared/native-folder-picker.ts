import { execa } from "execa";
import { isCommandAvailable } from "../tooling";

export type TPickFolderResult = { path?: string; canceled: boolean; error?: string };

/**
 * Every studio server in this CLI binds to 127.0.0.1 only and is opened in a browser tab on the
 * SAME machine the user is sitting at (never a remote multi-user server) — that's what makes
 * spawning a native OS dialog from this backend process sensible: it shows up on the user's own
 * desktop, exactly like a real "Open Folder" dialog would in a desktop app. This is a fire-and-
 * forget-shaped blocking call from the caller's perspective (the HTTP request just waits until
 * the user picks a folder or cancels) — there's no reasonable timeout to apply, since the user
 * may take as long as they like.
 */
export async function pickFolderNative(initialPath?: string): Promise<TPickFolderResult> {
  if (process.platform === "win32") {
    // Deliberately NOT System.Windows.Forms.FolderBrowserDialog (needs `Add-Type`, i.e. loading a
    // new .NET type) — confirmed broken on a real corporate machine locked to PowerShell's
    // Constrained Language Mode ("Cannot add type. Definition of new types is not supported in
    // this language mode"), which many managed Windows devices this CLI actually runs on enforce.
    // `Shell.Application`'s `BrowseForFolder` is COM automation (creating/calling an existing
    // registered component, not defining a new type), which Constrained Language Mode allows —
    // confirmed working end-to-end against the same locked-down machine. Flags 81 = 0x51 =
    // BIF_RETURNONLYFSDIRS(1) + BIF_EDITBOX(16) + BIF_NEWDIALOGSTYLE(64): real folders only, a
    // modern resizable tree with a path textbox instead of the legacy bare tree view.
    const script = ["$shellApp = New-Object -ComObject Shell.Application", "$folder = $shellApp.BrowseForFolder(0, 'Select a project folder for GitNexus', 81)", "if ($folder) { Write-Output $folder.Self.Path }"].join(
      "\n",
    );

    try {
      const { stdout } = await execa("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      const selected = stdout.trim();
      return selected ? { path: selected, canceled: false } : { canceled: true };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (process.platform === "darwin") {
    const prompt = "Select a project folder for GitNexus";
    const script = initialPath
      ? `POSIX path of (choose folder with prompt "${prompt}" default location POSIX file "${initialPath.replace(/"/g, '\\"')}")`
      : `POSIX path of (choose folder with prompt "${prompt}")`;
    try {
      const { stdout } = await execa("osascript", ["-e", script]);
      return { path: stdout.trim(), canceled: false };
    } catch {
      // AppleScript exits non-zero when the user cancels — indistinguishable from a real error
      // without parsing its stderr text, and "canceled" is the far more common case in practice.
      return { canceled: true };
    }
  }

  // Linux desktops have no single universal picker — try the two most common ones.
  if (await isCommandAvailable("zenity")) {
    try {
      const args = ["--file-selection", "--directory", "--title=Select a project folder for GitNexus"];
      if (initialPath) args.push(`--filename=${initialPath.endsWith("/") ? initialPath : `${initialPath}/`}`);
      const { stdout } = await execa("zenity", args);
      return { path: stdout.trim(), canceled: false };
    } catch {
      return { canceled: true };
    }
  }
  if (await isCommandAvailable("kdialog")) {
    try {
      const { stdout } = await execa("kdialog", ["--getexistingdirectory", initialPath || "."]);
      return { path: stdout.trim(), canceled: false };
    } catch {
      return { canceled: true };
    }
  }

  return { canceled: true, error: "No native folder picker available on this desktop (tried zenity/kdialog). Type the path manually instead." };
}

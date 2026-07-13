const SKIP_KEY = "smdg.aiStudio.skipLaunchConfirm";

export function shouldSkipLaunchConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSkipLaunchConfirm(value: boolean): void {
  try {
    localStorage.setItem(SKIP_KEY, value ? "true" : "false");
  } catch {
    // Ignore — e.g. private browsing with storage disabled. Confirmation just shows every time.
  }
}

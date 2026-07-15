const PROJECT_ROOT_KEY = "smdg.plugins.projectRoot";

export function getRememberedProjectRoot(): string {
  try {
    return localStorage.getItem(PROJECT_ROOT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberProjectRoot(value: string): void {
  try {
    localStorage.setItem(PROJECT_ROOT_KEY, value);
  } catch {
    // Ignore — e.g. private browsing with storage disabled. The field just resets each visit.
  }
}

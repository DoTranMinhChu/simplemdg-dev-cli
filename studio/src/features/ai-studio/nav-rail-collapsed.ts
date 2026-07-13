const COLLAPSED_KEY = "smdg.aiStudio.navRailCollapsed";

export function isNavRailCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNavRailCollapsed(value: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "true" : "false");
  } catch {
    // Ignore — e.g. private browsing with storage disabled. Collapse state just resets each visit.
  }
}

const REGISTRY_URL = "https://registry.npmjs.org/simplemdg-dev-cli/latest";
const TIMEOUT_MS = 3000;

export type TVersionCheckResult = { latest: string; hasUpdate: boolean };

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = b.split(".").map((part) => Number.parseInt(part, 10) || 0);

  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

/**
 * Checks the public npm registry for the latest published version. Never
 * throws and never blocks the shell on a slow/unreachable network — this is
 * a "nice to know" banner line, not something worth delaying startup or
 * risking a crash over, so any failure (offline, timeout, registry down)
 * just resolves `undefined` and the banner quietly omits the line.
 */
export async function checkLatestVersion(currentVersion: string): Promise<TVersionCheckResult | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as { version?: string };
    if (!data.version) {
      return undefined;
    }

    return { latest: data.version, hasUpdate: compareVersions(data.version, currentVersion) > 0 };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

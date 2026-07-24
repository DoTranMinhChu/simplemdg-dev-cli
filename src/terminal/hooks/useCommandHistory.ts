import { useCallback, useState } from "react";
import {
  getFavoriteCommandIds,
  getRecentCommands,
  recordCommandExecution,
  toggleFavoriteCommand,
  type TCommandHistoryEntry,
  type TCommandHistorySnapshot,
} from "../services/command-history";

/**
 * `initial` MUST be resolved before the shell's first paint (see
 * `loadCommandHistorySnapshot()` and terminal-launcher.tsx) rather than
 * fetched here in a post-mount effect — seeding real data upfront avoids the
 * "Recent actions" list growing from 0 lines to N lines shortly after mount,
 * which caused a real Ink live-region redraw corruption bug (stale
 * characters left over from the shorter previous frame).
 */
export function useCommandHistory(initial: TCommandHistorySnapshot) {
  const [recent, setRecent] = useState<TCommandHistoryEntry[]>(initial.recent);
  const [favorites, setFavorites] = useState<string[]>(initial.favorites);

  const refresh = useCallback(async () => {
    const [nextRecent, nextFavorites] = await Promise.all([getRecentCommands(20), getFavoriteCommandIds()]);
    setRecent(nextRecent);
    setFavorites(nextFavorites);
  }, []);

  const record = useCallback(
    async (entry: Parameters<typeof recordCommandExecution>[0]) => {
      await recordCommandExecution(entry);
      await refresh();
    },
    [refresh],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      await toggleFavoriteCommand(id);
      await refresh();
    },
    [refresh],
  );

  return { recent, favorites, record, toggleFavorite };
}

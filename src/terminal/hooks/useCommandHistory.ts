import { useCallback, useEffect, useState } from "react";
import {
  getFavoriteCommandIds,
  getRecentCommands,
  recordCommandExecution,
  toggleFavoriteCommand,
  type TCommandHistoryEntry,
} from "../services/command-history";

export function useCommandHistory() {
  const [recent, setRecent] = useState<TCommandHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const [nextRecent, nextFavorites] = await Promise.all([getRecentCommands(20), getFavoriteCommandIds()]);
    setRecent(nextRecent);
    setFavorites(nextFavorites);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

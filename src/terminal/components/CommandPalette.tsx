import React, { useMemo } from "react";
import { SearchableList } from "./SearchableList";
import type { TInteractiveCommandDefinition } from "../services/command-registry";

export function CommandPalette(props: {
  commands: TInteractiveCommandDefinition[];
  recentIds: string[];
  favoriteIds: string[];
  onSubmit: (command: TInteractiveCommandDefinition) => void;
  onCancel: () => void;
}) {
  const ordered = useMemo(() => {
    const byId = new Map(props.commands.map((command) => [command.id, command]));
    const favorites = [...new Set(props.favoriteIds)].map((id) => byId.get(id)).filter((c): c is TInteractiveCommandDefinition => Boolean(c));
    const favoriteIdSet = new Set(favorites.map((c) => c.id));
    const recents = [...new Set(props.recentIds)]
      .map((id) => byId.get(id))
      .filter((c): c is TInteractiveCommandDefinition => Boolean(c))
      .filter((c) => !favoriteIdSet.has(c.id));
    const shownIdSet = new Set([...favorites, ...recents].map((c) => c.id));
    const rest = props.commands.filter((command) => !shownIdSet.has(command.id));

    return [...favorites, ...recents, ...rest];
  }, [props.commands, props.recentIds, props.favoriteIds]);

  const choices = ordered.map((command) => ({
    title: `/${command.path.join(" ")}`,
    value: command.id,
    description: command.description ? `${command.category} — ${command.description}` : command.category,
    // Unprefixed/uncategorized match corpus — the "/" on `title` and the
    // "{Category} — " prefix on `description` are display-only and must not
    // be what a query is actually scored against, or an exact match on the
    // real command name/path can lose to an incidental substring hit
    // elsewhere (e.g. every command in the "AI Sessions" category otherwise
    // partially matches the query "ai sessions").
    searchText: [command.path.join(" "), ...command.keywords, ...command.aliases],
  }));

  return (
    <SearchableList
      message="Commands — type to filter, Enter to run, Esc to close"
      choices={choices}
      allowCustomValue={false}
      limit={12}
      onSubmit={(value) => {
        const command = props.commands.find((candidate) => candidate.id === value);
        if (command) {
          props.onSubmit(command);
        }
      }}
      onCancel={props.onCancel}
    />
  );
}

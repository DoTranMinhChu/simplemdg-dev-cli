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
    const favorites = props.favoriteIds.map((id) => byId.get(id)).filter((c): c is TInteractiveCommandDefinition => Boolean(c));
    const favoriteIdSet = new Set(favorites.map((c) => c.id));
    const recents = props.recentIds
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

import React, { useMemo } from "react";
import { SearchableList } from "./SearchableList";
import type { TSession } from "../hooks/useSessionRegistry";

const HOME_VALUE = "__smdg_session_switcher_home__";

/**
 * Explicit session picker — replaces blind Ctrl+N cycling (which forced
 * guessing your way through sessions one at a time with no visibility into
 * what each one even was) with a list you can see and pick from directly,
 * same as the command palette.
 */
export function SessionSwitcher(props: {
  sessions: TSession[];
  focusedSessionId: string | undefined;
  onSelect: (sessionId: string | undefined) => void;
  onCancel: () => void;
  maxVisibleRows?: number;
}) {
  const choices = useMemo(() => {
    const home = {
      title: "Home",
      value: HOME_VALUE,
      description: props.focusedSessionId === undefined ? "current" : undefined,
    };

    const sessionChoices = props.sessions.map((session) => ({
      title: session.label,
      value: session.id,
      description: [session.kind, session.status, session.id === props.focusedSessionId ? "current" : undefined]
        .filter(Boolean)
        .join(" — "),
    }));

    return [home, ...sessionChoices];
  }, [props.sessions, props.focusedSessionId]);

  // SearchableList renders its own message + query line above these rows (2 lines of chrome not part of `limit`).
  const limit = props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : 12;

  return (
    <SearchableList
      message="Switch session — type to filter, Enter to switch, Esc to cancel"
      choices={choices}
      allowCustomValue={false}
      limit={limit}
      onSubmit={(value) => props.onSelect(value === HOME_VALUE ? undefined : value)}
      onCancel={props.onCancel}
    />
  );
}

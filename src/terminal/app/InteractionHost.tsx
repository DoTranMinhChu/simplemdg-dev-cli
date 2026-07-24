import React, { useEffect, useState } from "react";
import { InteractionCancelledError } from "../../core/interaction/interaction-service";
import type { InkInteractionService, TPendingRequest } from "../services/ink-interaction-service";
import { ConfirmationPanel } from "../components/ConfirmationPanel";
import { SearchableList } from "../components/SearchableList";
import { MultiSelectList } from "../components/MultiSelectList";
import { TextInputPrompt } from "../components/TextInputPrompt";

/**
 * Subscribes to whatever single modal request is currently pending on the
 * InkInteractionService bridge and renders the matching widget. Business
 * logic (git-move-code-workflow.ts, etc.) is suspended on its `await
 * ctx.interaction.select(...)` (etc.) call until the rendered widget submits
 * or cancels.
 */
export function InteractionHost(props: { service: InkInteractionService; maxVisibleRows?: number }) {
  const [pending, setPending] = useState<TPendingRequest | undefined>(props.service.getCurrentRequest());

  useEffect(() => {
    const onChange = (request: TPendingRequest | undefined) => setPending(request);
    props.service.on("change", onChange);
    return () => {
      props.service.off("change", onChange);
    };
  }, [props.service]);

  if (!pending) {
    return null;
  }

  const cancel = () => props.service.rejectCurrentRequest(pending.id, new InteractionCancelledError());
  // SearchableList renders its own message + query line above its choice
  // rows (2 lines of chrome not part of `limit`) — subtract those here too,
  // same adjustment CommandPalette.tsx makes for its own SearchableList.
  const searchableLimit = props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined;

  switch (pending.kind) {
    case "confirm":
      return (
        <ConfirmationPanel
          message={pending.message}
          initial={pending.initial}
          onSubmit={(value) => props.service.resolveCurrent(pending.id, value)}
          onCancel={cancel}
        />
      );
    case "select":
      return (
        <SearchableList
          message={pending.message}
          choices={pending.choices}
          allowCustomValue={pending.allowCustomValue}
          customValueTitle={pending.customValueTitle}
          validateCustomValue={pending.validateCustomValue}
          limit={searchableLimit}
          onSubmit={(value) => props.service.resolveCurrent(pending.id, value)}
          onCancel={cancel}
        />
      );
    case "multiSelect":
      return (
        <MultiSelectList
          message={pending.message}
          choices={pending.choices}
          hint={pending.hint}
          maxVisibleRows={props.maxVisibleRows}
          onSubmit={(value) => props.service.resolveCurrent(pending.id, value)}
          onCancel={cancel}
        />
      );
    case "input":
      return (
        <TextInputPrompt
          message={pending.message}
          initial={pending.initial}
          validate={pending.validate}
          mask={pending.mask}
          onSubmit={(value) => props.service.resolveCurrent(pending.id, value)}
          onCancel={cancel}
        />
      );
    default:
      return null;
  }
}

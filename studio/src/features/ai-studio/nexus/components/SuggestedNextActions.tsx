import { Button } from "../../../../components/common/Button";

export type TNexusAction = { label: string; onClick: () => void };

/** Every analysis screen ends with this — reused verbatim rather than each tab inventing its own action row. */
export function SuggestedNextActions({ actions }: { actions: TNexusAction[] }): React.ReactElement | null {
  if (!actions.length) return null;

  return (
    <div className="ai-card nexus-next-actions">
      <h3>Suggested next actions</h3>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {actions.map((action) => (
          <Button key={action.label} variant="ghost" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

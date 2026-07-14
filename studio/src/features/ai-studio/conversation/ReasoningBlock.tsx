import { useState } from "react";
import { Markdown } from "../../../components/common/Markdown";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

/** Only ever rendered when a turn actually contains a reasoning observation — never a fabricated "not captured" placeholder. */
export function ReasoningBlock({ observation }: { observation: TAiObservation }): React.ReactElement {
  const [show, setShow] = useState(false);
  return (
    <div className="reasoning-block">
      <div className="reasoning-head">
        <span className="reasoning-label">INTERNAL REASONING</span>
        <button type="button" onClick={() => setShow((prev) => !prev)}>
          {show ? "Hide reasoning" : "Show reasoning"}
        </button>
      </div>
      {show ? (
        <div className="reasoning-body">
          <Markdown text={observation.output} />
        </div>
      ) : null}
    </div>
  );
}

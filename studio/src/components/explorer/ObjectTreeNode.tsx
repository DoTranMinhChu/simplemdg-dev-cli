import type { MouseEvent, ReactNode } from "react";
import { Icon } from "../common/Icon";
import { Spinner } from "../common/Spinner";

export type TObjectTreeNodeProps = {
  label: string;
  icon: string;
  leaf?: boolean;
  expanded?: boolean;
  loading?: boolean;
  badge?: number | null;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  children?: ReactNode;
};

/** Presentational lazy-tree row shell shared by every explorer level (schemas, kind folders, objects). */
export function ObjectTreeNode({
  label,
  icon,
  leaf,
  expanded,
  loading,
  badge,
  selected,
  onToggle,
  onClick,
  onDoubleClick,
  onContextMenu,
  children,
}: TObjectTreeNodeProps): React.ReactElement {
  return (
    <div className="tnode">
      <div
        className={`trow${selected ? " sel" : ""}`}
        onClick={() => (onClick ? onClick() : onToggle?.())}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <span
          className={`tchev${leaf ? " leaf" : ""}${expanded ? " open" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
        >
          &rsaquo;
        </span>
        <Icon name={icon} className={`ticon ${icon}`} />
        <span className="tlabel" title={label}>
          {label}
        </span>
        {badge != null ? <span className="tbadge">({badge})</span> : null}
        {loading ? <Spinner /> : null}
      </div>
      {expanded ? <div className="tchildren">{children}</div> : null}
    </div>
  );
}

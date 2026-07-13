import { useEffect, useRef, useState } from "react";

export type TVirtualWindow = {
  startIndex: number;
  endIndex: number;
  topPadding: number;
  bottomPadding: number;
};

/**
 * Fixed-row-height virtualization for the session list — hand-rolled rather than a library, matching
 * this codebase's zero-extra-dependency convention. Assumes every row is the same height, which holds
 * here because SessionRow's title/meta lines are single-line ellipsis, never wrapping.
 *
 * Row height is measured from the first real rendered row (never estimated) via `firstRowRef`, the
 * same "measure real DOM, don't guess" principle the Graph view's dagre layout uses. Before that
 * first measurement lands, every item renders unvirtualized for one frame so there's something to
 * measure — after that, only the visible window (plus overscan) renders.
 */
export function useVirtualList(
  itemCount: number,
  overscan = 6,
): {
  containerRef: React.RefObject<HTMLDivElement>;
  firstRowRef: (element: HTMLDivElement | null) => void;
  window: TVirtualWindow;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const firstRowRef = (element: HTMLDivElement | null): void => {
    if (!element || rowHeight) return;
    const height = element.getBoundingClientRect().height;
    if (height > 0) setRowHeight(height);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = (): void => setScrollTop(container.scrollTop);
    container.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(() => setViewportHeight(container.clientHeight));
    observer.observe(container);
    setViewportHeight(container.clientHeight);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  if (!rowHeight || !itemCount) {
    return { containerRef, firstRowRef, window: { startIndex: 0, endIndex: itemCount, topPadding: 0, bottomPadding: 0 } };
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(itemCount, startIndex + visibleCount);

  return {
    containerRef,
    firstRowRef,
    window: { startIndex, endIndex, topPadding: startIndex * rowHeight, bottomPadding: (itemCount - endIndex) * rowHeight },
  };
}

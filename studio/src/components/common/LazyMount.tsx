import { useEffect, useRef, useState } from "react";

export type TLazyMountProps = {
  id?: string;
  className?: string;
  minHeight?: number;
  rootMargin?: string;
  children: React.ReactNode;
};

/**
 * Mounts `children` only once this element scrolls near the viewport, then keeps them mounted —
 * the wrapper element itself is stable across that transition (same `id`/`className` before and
 * after) so scroll-to-id navigation always finds a real target even before the content mounts.
 */
export function LazyMount({ id, className, minHeight = 160, rootMargin = "600px 0px", children }: TLazyMountProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} id={id} className={className} style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  );
}

export type TStudioKey = "db" | "tool" | "ai" | "proxy";

const TILE_FILL: Record<TStudioKey, string> = {
  db: "#245392",
  tool: "#87CC2E",
  ai: "#0e1420",
  proxy: "#245392",
};

// Icon marks share the SimpleMDG brand palette (blue #245392 / green #87CC2E) with the wordmark at
// simplemdg.com/.../logo.svg. Each studio gets its own pictogram on a tile so the four apps read as
// a family in a browser tab strip while staying visually distinct. Kept in sync with the standalone
// favicon SVGs under studio/public/favicon-*.svg (same viewBox and paths).
export function StudioMark({ studio, size = 20 }: { studio: TStudioKey; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="studio-mark">
      <rect width="28" height="28" rx="6" fill={TILE_FILL[studio]} />
      {studio === "db" ? (
        <>
          <g fill="none" stroke="#ffffff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="14" cy="9.6" rx="6" ry="2.2" />
            <path d="M8 9.6v8.8c0 1.22 2.69 2.2 6 2.2s6-.98 6-2.2V9.6" />
          </g>
          <path d="M8 14c0 1.22 2.69 2.2 6 2.2s6-.98 6-2.2" fill="none" stroke="#87CC2E" strokeWidth={1.7} strokeLinecap="round" />
        </>
      ) : studio === "tool" ? (
        <>
          <g stroke="#1c3a63" strokeWidth={1.6} strokeLinecap="round" fill="none">
            <circle cx="14" cy="14" r="5.2" />
            <line x1="14" y1="6.2" x2="14" y2="8.4" />
            <line x1="14" y1="19.6" x2="14" y2="21.8" />
            <line x1="6.2" y1="14" x2="8.4" y2="14" />
            <line x1="19.6" y1="14" x2="21.8" y2="14" />
            <line x1="9.1" y1="9.1" x2="10.6" y2="10.6" />
            <line x1="17.4" y1="17.4" x2="18.9" y2="18.9" />
            <line x1="9.1" y1="18.9" x2="10.6" y2="17.4" />
            <line x1="17.4" y1="10.6" x2="18.9" y2="9.1" />
          </g>
          <circle cx="14" cy="14" r="1.9" fill="#ffffff" />
        </>
      ) : studio === "ai" ? (
        <>
          <polygon points="5,14 14,11.6 23,14 14,16.4" fill="#87CC2E" />
          <polygon points="14,5 16.4,14 14,23 11.6,14" fill="#3b82f6" fillOpacity={0.92} />
        </>
      ) : (
        <>
          <line x1="7" y1="11" x2="19" y2="11" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
          <polygon points="19,8.3 23.2,11 19,13.7" fill="#ffffff" />
          <line x1="9" y1="17" x2="21" y2="17" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
          <polygon points="9,14.3 4.8,17 9,19.7" fill="#87CC2E" />
        </>
      )}
    </svg>
  );
}

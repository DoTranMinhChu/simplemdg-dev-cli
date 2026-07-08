function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps every case-insensitive occurrence of `query` in `text` with `<mark>` so search matches stand out in a list. */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const pattern = new RegExp(`(${escapeRegExp(query.trim())})`, "gi");
  const parts = text.split(pattern);
  if (parts.length === 1) return text;

  return parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>));
}

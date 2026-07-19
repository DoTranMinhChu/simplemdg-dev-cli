const ICON_PATHS: Record<string, string> = {
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  sch: "M12 3l9 5-9 5-9-5 9-5z|M3 12l9 5 9-5|M3 16l9 5 9-5",
  fld: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  tbl: "M3 5h18v14H3z|M3 10h18|M9 5v14|M15 5v14",
  viw: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z|M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  prc: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M12 2v3|M12 19v3|M2 12h3|M19 12h3|M5 5l2 2|M17 17l2 2|M19 5l-2 2|M7 17l-2 2",
  fun: "M6 3h9l4 4v14H6z|M14 3v4h4|M9 12h6|M9 16h6",
  syn: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1|M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  idx: "M14 4l6 6-9 9H5v-6z|M3 21h18",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|M21 21l-4.3-4.3",
  star: "M12 3l2.9 6 6.1.5-4.6 4 1.4 6-5.8-3.3L6.2 19.5l1.4-6L3 9.5 9.1 9z",
  refresh: "M21 12a9 9 0 1 1-3-6.7|M21 4v5h-5",
  x: "M6 6l12 12|M18 6L6 18",
  plus: "M12 5v14|M5 12h14",
  imp: "M12 3v12|M7 10l5 5 5-5|M5 21h14",
  sql: "M4 5h16v14H4z|M7 9l3 3-3 3|M13 15h4",
  run: "M13 3L4 14h7l-1 7 9-11h-7z",
  save: "M5 3h11l3 3v15H5z|M8 3v6h7V3|M8 21v-7h8v7",
  gear: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a8 8 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.7-1l2.3 1 2-3.4z",
  home: "M3 11l9-8 9 8|M5 10v10h14V10",
  table2: "M4 4h16v16H4z|M4 9h16|M9 4v16",
  col: "M5 4v16|M12 4v16|M19 4v16",
  trash: "M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13|M10 11v6|M14 11v6",
  chevL: "M15 6l-6 6 6 6",
  chevR: "M9 6l6 6-6 6",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  undo: "M9 7L4 12l5 5|M4 12h11a5 5 0 0 1 0 10h-3",
  history: "M12 3a9 9 0 1 0 9 9|M12 7v5l3 3|M3 3v5h5",
  copy: "M9 9h11v11H9z|M5 15V4h11",
  terminal: "M4 4h16v16H4z|M7 15l4-4-4-4|M13 16h4",
  pin: "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z|M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  code: "M8 6l-6 6 6 6|M16 6l6 6-6 6",
  play: "M6 4l14 8-14 8V4z",
  minus: "M5 12h14",
  maximize: "M8 3H4v4|M16 3h4v4|M8 21H4v-4|M16 21h4v-4",
  activity: "M3 12h4l3 8 4-16 3 8h4",
  panel: "M3 4h18v16H3z|M9 4v16",
  plug: "M9 2v6|M15 2v6|M6 8h12v6a6 6 0 0 1-12 0V8z|M12 20v2",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z|M9 4v14|M15 6v14",
};

export function Icon({ name, className }: { name: string; className?: string }): React.ReactElement {
  const paths = (ICON_PATHS[name] ?? "").split("|").filter(Boolean);
  return (
    <svg className={`ic${className ? ` ${className}` : ""}`} viewBox="0 0 24 24">
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

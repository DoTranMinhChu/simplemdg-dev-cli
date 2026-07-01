import { STUDIO_STYLES } from "./db-studio-styles";
import { STUDIO_CLIENT_SCRIPT } from "./db-studio-client";

export type TStudioHtmlOptions = {
  readOnlyDefault: boolean;
};

function searchSvg(): string {
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/><path d="M21 21l-4.3-4.3"/></svg>';
}

export function renderStudioHtml(options: TStudioHtmlOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SimpleMDG CF DB Studio</title>
<style>${STUDIO_STYLES}</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <span class="brand">SimpleMDG <span class="b2">DB Studio</span></span>
    <span id="connBadge" class="badge">No connection</span>
    <span id="typeBadge" class="badge hidden"></span>
    <span id="schemaBadge" class="badge">Schema: -</span>
    <span id="prodBadge" class="badge prod hidden">Production-like</span>
    <span id="roBadge" class="badge ro" title="Toggle read-only">Read/Write</span>
    <span class="grow"></span>
    <span class="searchbox top-search">${searchSvg()}<input id="topSearch" placeholder="Search connections..." /></span>
    <button id="btnImport" class="iconbtn primary" title="Import from BTP app">Import from BTP</button>
    <button id="btnHome" class="iconbtn" title="Welcome">Home</button>
    <button id="btnSidebarToggle" class="iconbtn" title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>
    <button id="btnSettings" class="iconbtn" title="Settings">Settings</button>
    <span id="topSpin" class="spin hidden"></span>
  </header>
  <div class="body">
    <div class="sidebar-rail hidden" id="sidebarRail"></div>
    <aside class="sidebar" id="sidebar">
      <section class="side-sec" id="secConns">
        <div class="side-head"><span class="chev">▾</span><span class="h-title">Connections</span><span class="h-count" id="connCount"></span></div>
        <div class="side-body">
          <div class="side-actions">
            <button id="btnNewConn" class="btn sm">+ New</button>
            <button id="btnImport2" class="btn sm sec">Import BTP</button>
            <select id="connGroupBy" class="select" style="width:auto;padding:3px 6px;font-size:11.5px" title="Group connections by">
              <option value="favorite">Group: Favorite/Env</option>
              <option value="region">Group: Region</option>
              <option value="org">Group: Org</option>
              <option value="type">Group: DB Type</option>
            </select>
          </div>
          <div class="searchbox">${searchSvg()}<input id="connSearch" placeholder="Search connections..." /></div>
          <div id="connList"></div>
        </div>
      </section>
      <section class="side-sec" id="secTree">
        <div class="side-head"><span class="chev">▾</span><span class="h-title">Object Explorer</span></div>
        <div class="side-body"><div id="tree" class="tree" tabindex="0"></div></div>
      </section>
      <section class="side-sec" id="secQueries">
        <div class="side-head"><span class="chev">▾</span><span class="h-title">Saved Queries</span><span class="h-count" id="queryCount"></span></div>
        <div class="side-body">
          <div class="side-actions"><button id="btnNewQuery" class="btn sm">+ New query</button></div>
          <div class="searchbox">${searchSvg()}<input id="querySearch" placeholder="Search queries..." /></div>
          <div id="queryList"></div>
        </div>
      </section>
      <section class="side-sec" id="secHistory">
        <div class="side-head"><span class="chev">▾</span><span class="h-title">History</span><span class="h-count" id="historyCount"></span></div>
        <div class="side-body">
          <div class="side-actions"><button id="btnClearHistory" class="btn sm ghost">Clear</button></div>
          <div class="searchbox">${searchSvg()}<input id="historySearch" placeholder="Search history..." /></div>
          <div id="historyList"></div>
        </div>
      </section>
    </aside>
    <div class="resizer" id="resizer" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" title="Drag to resize · Double-click to reset"></div>
    <main class="workspace">
      <div class="tabbar-row" id="tabbarRow">
        <div class="tabbar" id="tabbar"></div>
        <button class="tab-overflow-btn hidden" id="tabOverflowBtn" title="More tabs" aria-label="More tabs">⋯</button>
      </div>
      <div class="tabcontent" id="tabcontent"></div>
    </main>
  </div>
  <footer class="statusbar">
    <span class="st-item" id="stConn"><span class="st-dot"></span> Ready</span>
    <span class="st-item">Duration: <span id="stDuration">-</span></span>
    <span class="st-item">Rows: <span id="stRows">-</span></span>
    <span class="grow" style="flex:1"></span>
    <span class="st-item" id="stPending"></span>
    <span class="st-item faint">Local only · 127.0.0.1</span>
  </footer>
</div>
<div id="contextMenu" class="ctxmenu hidden"></div>
<div id="modalRoot" class="hidden"></div>
<div id="toasts" class="toasts"></div>
<script>window.SMDG_READONLY_DEFAULT=${options.readOnlyDefault ? "true" : "false"};</script>
<script>${STUDIO_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

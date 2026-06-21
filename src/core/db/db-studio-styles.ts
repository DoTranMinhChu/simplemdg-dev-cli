export const STUDIO_STYLES = `
:root{
  --bg:#0b0f17;--bg-2:#0e1420;--bg-3:#121a28;--panel:#0d131e;--elev:#16203250;
  --border:#1f2c44;--border-2:#27374f;--text:#dce6f5;--muted:#8295b5;--faint:#5b6c8a;
  --accent:#3b82f6;--accent-2:#1d4ed8;--green:#22c55e;--red:#ef4444;--yellow:#f59e0b;
  --amber:#fbbf24;--chip:#1a2840;--sel:#16243d;--editbg:#3a2f08;--delbg:#3a1414;--insbg:#0f2e18;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:13px/1.45 "Segoe UI",Roboto,Arial,sans-serif;overflow:hidden}
button,input,select,textarea{font:inherit;color:inherit;outline:none}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#22314c;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}
.app{display:flex;flex-direction:column;height:100vh}
.hidden{display:none!important}
.spin{width:14px;height:14px;border:2px solid var(--border-2);border-top-color:var(--accent);border-radius:50%;display:inline-block;animation:sp .7s linear infinite;vertical-align:middle}
@keyframes sp{to{transform:rotate(360deg)}}
svg.ic{width:15px;height:15px;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}

/* top bar */
.topbar{display:flex;align-items:center;gap:9px;padding:8px 12px;background:linear-gradient(180deg,#101a2b,#0d1521);border-bottom:1px solid var(--border);flex:0 0 auto}
.brand{font-weight:700;color:#cfe0ff;letter-spacing:.2px;white-space:nowrap}
.brand .b2{color:var(--faint);font-weight:600}
.badge{padding:3px 9px;border-radius:999px;background:var(--chip);border:1px solid var(--border);color:var(--muted);font-size:12px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.badge.on{color:#cfe0ff;border-color:var(--accent)}
.badge.hana{color:#7dd3fc;border-color:#0e7490}
.badge.pg{color:#a5b4fc;border-color:#4338ca}
.badge.ro{cursor:pointer}
.badge.ro.active{color:#fff;background:#7c2d12;border-color:#b45309}
.badge.prod{color:#fff;background:#7f1d1d;border-color:#b91c1c}
.grow{flex:1}
.top-search{flex:0 1 320px}
.iconbtn{background:transparent;border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.iconbtn:hover{color:#cfe0ff;border-color:var(--border-2);background:var(--bg-3)}
.iconbtn.primary{background:var(--accent);border-color:var(--accent-2);color:#fff}
.iconbtn.primary:hover{filter:brightness(1.08);color:#fff}

/* body */
.body{display:flex;flex:1;min-height:0}
.sidebar{width:320px;min-width:220px;max-width:560px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.resizer{width:5px;cursor:col-resize}
.resizer:hover{background:var(--accent)}
.workspace{flex:1;display:flex;flex-direction:column;min-width:0}

/* sidebar sections */
.side-sec{display:flex;flex-direction:column;min-height:0;border-bottom:1px solid var(--border)}
.side-sec.flex{flex:1}
.side-head{display:flex;align-items:center;gap:7px;padding:9px 11px;cursor:pointer;color:var(--muted);user-select:none}
.side-head:hover{color:#cfe0ff}
.side-head .h-title{font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:700;flex:1}
.side-head .chev{transition:transform .15s}
.side-sec.collapsed .chev{transform:rotate(-90deg)}
.side-sec.collapsed .side-body{display:none}
.side-body{padding:0 9px 10px;overflow:auto;min-height:0}
.side-sec.flex .side-body{flex:1}
.side-actions{display:flex;gap:6px;margin-bottom:7px}

/* search box */
.searchbox{display:flex;align-items:center;gap:6px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:5px 8px;margin-bottom:7px}
.searchbox svg{color:var(--faint)}
.searchbox input{flex:1;background:transparent;border:0;color:var(--text)}
.searchbox .sbtn{background:transparent;border:0;color:var(--muted);cursor:pointer}
.searchbox .sbclr{color:var(--faint);cursor:pointer;display:none;flex:0 0 auto}
.searchbox .sbclr.show{display:inline-flex}
.searchbox .sbclr:hover{color:var(--text)}

/* buttons + inputs */
.btn{background:var(--accent);border:1px solid var(--accent-2);color:#fff;border-radius:8px;padding:6px 11px;cursor:pointer}
.btn:hover{filter:brightness(1.08)}
.btn.sec{background:#22304a;border-color:var(--border-2);color:#cfe0ff}
.btn.ghost{background:transparent;border-color:var(--border);color:var(--muted)}
.btn.danger{background:#7f1d1d;border-color:#b91c1c;color:#fff}
.btn.sm{padding:3px 8px;font-size:12px}
.btn:disabled{opacity:.45;cursor:not-allowed;filter:none}
.input,.select{width:100%;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:7px 9px;color:var(--text)}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:9px}
.field label{color:var(--muted);font-size:12px}
.note{color:var(--muted);font-size:12px}
.faint{color:var(--faint)}
.row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.right{justify-content:flex-end}

/* connection cards */
.conn-card{position:relative;background:var(--bg-3);border:1px solid var(--border);border-left:3px solid var(--faint);border-radius:9px;padding:8px 10px;margin-bottom:7px;cursor:pointer}
.conn-card:hover{border-color:var(--border-2);background:#152033}
.conn-card.active{border-color:var(--accent);background:var(--sel)}
.conn-top{display:flex;align-items:center;gap:7px}
.conn-name{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conn-sub{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.conn-tags{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap}
.tag{font-size:10.5px;padding:1px 7px;border-radius:999px;background:var(--chip);border:1px solid var(--border);color:var(--muted)}
.tag.env-DEV{color:#86efac;border-color:#166534}
.tag.env-QAS{color:#fde68a;border-color:#a16207}
.tag.env-PROD{color:#fecaca;border-color:#b91c1c}
.tag.env-SANDBOX{color:#a5b4fc;border-color:#4338ca}
.tag.type{color:#7dd3fc}
.star{cursor:pointer;color:var(--faint)}
.star.on{color:var(--amber)}
.skel{height:56px;border-radius:9px;margin-bottom:7px;background:linear-gradient(90deg,#121a28,#1a2740,#121a28);background-size:200% 100%;animation:shimmer 1.3s infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* tree */
.tree{font-size:12.5px}
.trow{display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:6px;cursor:pointer;white-space:nowrap}
.trow:hover{background:var(--bg-3)}
.trow.sel{background:var(--sel)}
.tchev{width:13px;color:var(--faint);flex:0 0 auto;text-align:center;transition:transform .12s}
.tchev.open{transform:rotate(90deg)}
.tchev.leaf{visibility:hidden}
.ticon{flex:0 0 auto;color:var(--muted);display:inline-flex}
.ticon.tbl{color:#7dd3fc}.ticon.viw{color:#c4b5fd}.ticon.prc{color:#fca5a5}.ticon.fun{color:#fcd34d}.ticon.syn{color:#67e8f9}.ticon.sch{color:#93c5fd}.ticon.db{color:#86efac}.ticon.fld{color:var(--muted)}
.tlabel{flex:1;overflow:hidden;text-overflow:ellipsis}
.tbadge{color:var(--faint);font-size:11px}
.tchildren{margin-left:13px;border-left:1px solid var(--border);padding-left:3px}
.tnote{color:var(--faint);font-size:11.5px;padding:3px 6px}
.tsearch{margin:3px 0 4px}

/* workspace tabs */
.tabbar{display:flex;align-items:stretch;background:var(--bg-2);border-bottom:1px solid var(--border);overflow-x:auto;flex:0 0 auto;min-height:38px}
.wtab{display:flex;align-items:center;gap:7px;padding:8px 13px;border-right:1px solid var(--border);color:var(--muted);cursor:pointer;white-space:nowrap;max-width:260px}
.wtab:hover{color:var(--text);background:var(--bg-3)}
.wtab.active{color:#bcd4ff;background:var(--bg-3);box-shadow:inset 0 -2px 0 var(--accent)}
.wtab .t-ico{display:inline-flex;color:var(--faint)}
.wtab .t-title{overflow:hidden;text-overflow:ellipsis}
.wtab .dot{width:7px;height:7px;border-radius:50%;background:var(--amber)}
.wtab .x{color:var(--faint);border-radius:4px;padding:0 3px}
.wtab .x:hover{color:#fff;background:#37425c}
.tabcontent{flex:1;min-height:0;position:relative;background:var(--bg)}
.tabpane{position:absolute;inset:0;display:flex;flex-direction:column;overflow:auto}

/* welcome */
.welcome{padding:26px;max-width:1000px;margin:0 auto;width:100%}
.welcome h1{margin:0 0 4px;font-size:22px}
.welcome .lede{color:var(--muted);margin-bottom:22px}
.wcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:24px}
.wcard{background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:16px;cursor:pointer}
.wcard:hover{border-color:var(--accent);background:var(--bg-3)}
.wcard .wc-ic{color:var(--accent);margin-bottom:8px}
.wcard h3{margin:0 0 4px;font-size:14px}
.wcard p{margin:0;color:var(--muted);font-size:12px}
.wcols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.wcol h4{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin:0 0 8px}
.wlist .wli{padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;background:var(--bg-2)}
.wlist .wli:hover{border-color:var(--border-2);background:var(--bg-3)}

/* toolbar + editor */
.toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--border);background:var(--bg-2)}
.pane-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:10px;gap:8px;overflow:auto}
.editor{width:100%;min-height:160px;resize:vertical;background:#0a1018;border:1px solid var(--border);border-radius:8px;padding:11px;color:#e7eefc;font-family:Consolas,"Cascadia Code",monospace;font-size:13px}
.errbox{background:#2a0f10;border:1px solid #7f1d1d;color:#fca5a5;border-radius:8px;padding:9px 11px;white-space:pre-wrap;font-family:Consolas,monospace;font-size:12px}

/* grid */
.gridwrap{flex:1;min-height:120px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg-3)}
table.grid{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
table.grid th,table.grid td{border-bottom:1px solid var(--border);border-right:1px solid var(--border);padding:6px 9px;text-align:left;white-space:nowrap;max-width:440px;overflow:hidden;text-overflow:ellipsis}
table.grid th{position:sticky;top:0;z-index:1;background:#172339;color:#cfe0ff;cursor:pointer;user-select:none}
table.grid th .sort{color:var(--accent);margin-left:4px}
table.grid tr:hover td{background:#13203450}
table.grid td.num{text-align:right;color:#a7f3d0}
table.grid th.rowhdr,table.grid td.rowhdr{width:54px;text-align:right;color:var(--faint);background:#15203550;cursor:pointer;position:sticky;left:0}
table.grid tr.selrow td{background:var(--sel)}
table.grid td.edited{background:var(--editbg);box-shadow:inset 0 0 0 1px var(--amber)}
table.grid tr.row-del td{background:var(--delbg);text-decoration:line-through;color:#fca5a5}
table.grid tr.row-ins td{background:var(--insbg)}
table.grid tr.row-err td{box-shadow:inset 0 0 0 1px var(--red)}
.rowflag{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.rowflag.d{background:var(--amber)}.rowflag.del{background:var(--red)}.rowflag.ins{background:var(--green)}
.cellinput{width:100%;background:#0a1018;border:1px solid var(--accent);border-radius:4px;color:#fff;padding:3px 5px;font:inherit}
.rowerr-msg{color:#fca5a5;font-size:11px}

/* sql tabs inside editor */
.sqltabs{display:flex;gap:4px;flex-wrap:wrap;padding:6px 10px 0}
.sqltab{padding:4px 10px;background:var(--bg-3);border:1px solid var(--border);border-bottom:0;border-radius:7px 7px 0 0;cursor:pointer;color:var(--muted);font-size:12px}
.sqltab.active{color:#cfe0ff;border-color:var(--accent);background:var(--sel)}
.sqltab .x{margin-left:7px}

/* status bar */
.statusbar{display:flex;align-items:center;gap:16px;padding:5px 12px;background:var(--bg-2);border-top:1px solid var(--border);color:var(--muted);font-size:12px;flex:0 0 auto}
.st-item{display:inline-flex;align-items:center;gap:6px}
.st-dot{width:8px;height:8px;border-radius:50%;background:var(--faint)}
.st-dot.ok{background:var(--green)}.st-dot.err{background:var(--red)}.st-dot.run{background:var(--amber);animation:sp 1s linear infinite}
.st-pending{color:var(--amber)}

/* metadata */
.meta-tabs{display:flex;gap:5px;padding:8px 10px 0}
.meta-tab{padding:5px 11px;border:1px solid var(--border);border-bottom:0;border-radius:7px 7px 0 0;cursor:pointer;color:var(--muted);font-size:12px}
.meta-tab.active{color:#cfe0ff;border-color:var(--accent);background:var(--sel)}
.kvs{display:grid;grid-template-columns:160px 1fr;gap:5px 14px;padding:6px}
.kvs .k{color:var(--muted)}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--chip);border:1px solid var(--border);font-size:11px;color:var(--muted)}
.pill.pk{color:#fde68a;border-color:#a16207}

/* modal + wizard */
.modal{position:fixed;inset:0;background:rgba(2,6,15,.62);display:flex;align-items:center;justify-content:center;z-index:60}
.dialog{background:var(--bg-2);border:1px solid var(--border-2);border-radius:14px;padding:18px;width:560px;max-width:94vw;max-height:90vh;overflow:auto;box-shadow:0 24px 80px rgba(0,0,0,.5)}
.dialog h3{margin:0 0 14px}
.steps{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.step{flex:1;min-width:80px;text-align:center;font-size:11px;color:var(--faint);padding:6px 4px;border-radius:8px;background:var(--bg-3);border:1px solid var(--border)}
.step.active{color:#cfe0ff;border-color:var(--accent)}
.step.done{color:var(--green)}
.wlistbox{max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:9px}
.wrow{padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:8px}
.wrow:hover{background:var(--bg-3)}
.wrow.sel{background:var(--sel)}
.swatches{display:flex;gap:7px;flex-wrap:wrap}
.swatch{width:24px;height:24px;border-radius:7px;cursor:pointer;border:2px solid transparent}
.swatch.sel{border-color:#fff}

/* context menu */
.ctxmenu{position:fixed;z-index:80;background:var(--bg-2);border:1px solid var(--border-2);border-radius:9px;padding:5px;min-width:190px;box-shadow:0 16px 50px rgba(0,0,0,.5)}
.ctxitem{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:7px;cursor:pointer;color:var(--text);font-size:12.5px}
.ctxitem:hover{background:var(--accent);color:#fff}
.ctxitem.danger{color:#fca5a5}
.ctxitem.danger:hover{background:#7f1d1d;color:#fff}
.ctxsep{height:1px;background:var(--border);margin:4px 6px}

/* toasts */
.toasts{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:90}
.toast{background:var(--bg-2);border:1px solid var(--border-2);border-left:3px solid var(--accent);border-radius:9px;padding:9px 13px;min-width:240px;max-width:380px;box-shadow:0 10px 34px rgba(0,0,0,.4);animation:slideup .18s ease}
.toast.ok{border-left-color:var(--green)}.toast.err{border-left-color:var(--red)}.toast.warn{border-left-color:var(--yellow)}
@keyframes slideup{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
.empty{color:var(--faint);padding:16px;text-align:center}
mark.hl{background:#facc15;color:#10151f;border-radius:3px;padding:0 1px}
/* tabs: pin + drag */
.wtab.pinned{background:#101a2b}
.wtab.pinned .t-title{max-width:90px}
.wtab.dragging{opacity:.5}
.wtab.dragover{box-shadow:inset 2px 0 0 var(--accent)}
.wtab .pin{color:var(--amber)}
/* sql preview popover */
.popover{position:absolute;z-index:55;background:var(--bg-2);border:1px solid var(--border-2);border-radius:10px;box-shadow:0 16px 50px rgba(0,0,0,.5);padding:10px;width:560px;max-width:90vw}
.popover pre{margin:0;background:#0a1018;border:1px solid var(--border);border-radius:8px;padding:10px;color:#cfe7ff;font-family:Consolas,monospace;font-size:12.5px;white-space:pre-wrap;max-height:240px;overflow:auto}
/* change summary bar */
.changebar{display:flex;align-items:center;gap:10px;padding:7px 10px;background:#2a230a;border:1px solid #a16207;border-radius:9px;margin:0 10px 8px;color:#fde68a}
.changebar .grow{flex:1}
/* breadcrumb */
.crumbs{display:flex;align-items:center;gap:6px;padding:6px 10px;color:var(--muted);font-size:12px;border-bottom:1px solid var(--border);background:var(--bg-2)}
.crumbs a{color:#8fc6ff;cursor:pointer}
.crumbs .sep{color:var(--faint)}
/* command palette */
.palette{position:fixed;top:80px;left:50%;transform:translateX(-50%);width:560px;max-width:92vw;background:var(--bg-2);border:1px solid var(--border-2);border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.55);z-index:85;overflow:hidden}
.palette input{width:100%;background:#0a1018;border:0;border-bottom:1px solid var(--border);padding:13px 15px;color:#fff;font-size:15px}
.palette .pitems{max-height:50vh;overflow:auto}
.palette .pitem{padding:9px 14px;cursor:pointer;display:flex;justify-content:space-between;gap:10px}
.palette .pitem.sel,.palette .pitem:hover{background:var(--accent);color:#fff}
.palette .pitem .kbd{color:var(--faint);font-size:11px}
.kbd{font-family:Consolas,monospace;background:var(--chip);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:11px}
.shorts{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px}
.shorts .srow{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid var(--border)}
/* editor gutter */
.editwrap{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#0a1018}
.gutter{padding:11px 8px;text-align:right;color:var(--faint);font-family:Consolas,"Cascadia Code",monospace;font-size:13px;line-height:1.5;white-space:pre;user-select:none;background:#0c131e;min-width:42px;overflow:hidden}
.editwrap .editor{border:0;border-radius:0;flex:1;line-height:1.5}
.ac{position:absolute;z-index:70;background:var(--bg-2);border:1px solid var(--border-2);border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.5);max-height:220px;overflow:auto;min-width:220px}
.ac .aci{padding:6px 11px;cursor:pointer;display:flex;justify-content:space-between;gap:10px}
.ac .aci.sel,.ac .aci:hover{background:var(--accent);color:#fff}
.ac .aci .t{color:var(--faint);font-size:11px}
.toggle{display:flex;align-items:center;gap:8px;padding:6px 0}
/* compact data-grid toolbar */
.gtoolbar{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:0 0 auto}
.wherebox{display:flex;align-items:center;gap:6px;flex:1;min-width:120px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:4px 9px}
.wherebox svg{color:var(--faint);flex:0 0 auto}
.wherebox input{flex:1;background:transparent;border:0;color:var(--text);font-family:Consolas,monospace}
.wherebox .clr{color:var(--faint);cursor:pointer;visibility:hidden;flex:0 0 auto}
.wherebox.has .clr{visibility:visible}
.wherebox .clr:hover{color:var(--text)}
.gbtn{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:#22304a;border:1px solid var(--border);border-radius:8px;color:#cfe0ff;cursor:pointer;flex:0 0 auto}
.gbtn:hover{background:#2a3b5a}
.gbtn.on{border-color:var(--accent);color:#fff;box-shadow:0 0 0 1px var(--accent) inset}
.gbtn.danger{color:#fca5a5}
.gbtn.danger:hover{background:#7f1d1d;color:#fff}
.gbtn:disabled{opacity:.4;cursor:not-allowed}
.gbtn:disabled:hover{background:#22304a}
.gbtn.spinning svg{animation:sp .7s linear infinite}
.gsep{width:1px;height:20px;background:var(--border);margin:0 2px;flex:0 0 auto}
.gridfoot{display:flex;align-items:center;gap:12px;padding:6px 10px;border-top:1px solid var(--border);background:var(--bg-2);color:var(--muted);font-size:12px;flex:0 0 auto}
.gridfoot select{background:var(--bg-3);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:3px 7px}
.gridfoot .pg{display:inline-flex;align-items:center;gap:7px}
.cnt-u{color:var(--amber)}.cnt-i{color:var(--green)}.cnt-d{color:var(--red)}
table.grid tr.selrow td{background:var(--sel)}
.fieldlist{max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px}
.fieldlist label{display:flex;gap:7px;align-items:center;padding:3px 4px;font-size:12.5px}

/* ---- BTP Target Explorer wizard ----------------------------------------- */
.wiz-step{display:flex;flex-direction:column;gap:0;height:100%}
.wiz-step-header{display:flex;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--border);flex:0 0 auto}
.wiz-breadcrumb{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.wiz-breadcrumb .crumb{cursor:pointer;color:var(--accent)}
.wiz-breadcrumb .crumb:hover{text-decoration:underline}
.wiz-breadcrumb .sep{color:var(--faint)}
.wiz-search{flex:1 1 0;min-width:0}
.wiz-body{flex:1 1 0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.wiz-footer{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--border);flex:0 0 auto}
.wiz-footer .spacer{flex:1}
.wiz-section{margin-top:8px}
.wiz-section-hdr{font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;padding:4px 6px 2px;display:flex;align-items:center;gap:8px}
.wiz-section-hdr .wiz-count{font-size:11px;font-weight:400;color:var(--faint)}
/* Target row */
.trow{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent}
.trow:hover{background:var(--bg-3);border-color:var(--border)}
.trow.active{background:var(--sel);border-color:var(--accent)}
.trow .trow-icon{font-size:15px;flex:0 0 auto;width:20px;text-align:center}
.trow .trow-main{flex:1 1 0;min-width:0}
.trow .trow-title{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trow .trow-meta{font-size:11px;color:var(--muted)}
.trow .trow-right{flex:0 0 auto;display:flex;align-items:center;gap:6px}
.trow .trow-fav{cursor:pointer;color:var(--faint);font-size:14px}
.trow .trow-fav.on{color:#f59e0b}
.trow .trow-fav:hover{color:#f59e0b}
.trow.disabled{cursor:not-allowed;opacity:.45}
.trow.disabled:hover{background:none;border-color:transparent}
.region-group{margin-top:6px}
.region-hdr{font-size:11px;color:var(--faint);padding:4px 6px 2px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;display:flex;align-items:center;gap:6px;cursor:pointer}
.region-hdr:hover{color:var(--muted)}
.region-hdr .chevron{font-size:10px;transition:transform .15s;display:inline-block}
.region-hdr.collapsed .chevron{transform:rotate(-90deg)}
.region-body{display:flex;flex-direction:column;gap:2px}
/* Cache status badge */
.cbadge{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;letter-spacing:.02em}
.cbadge.fresh{background:#064e3b;color:#6ee7b7}
.cbadge.stale{background:#78350f;color:#fde68a}
.cbadge.expired{background:#450a0a;color:#fca5a5}
.cbadge.missing{background:#1e293b;color:#64748b}
.cbadge.refreshing{background:#1e3a5f;color:#93c5fd}
.cbadge .spin{display:inline-block;animation:sp .7s linear infinite}
/* App + candidate rows */
.arow{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent}
.arow:hover{background:var(--bg-3);border-color:var(--border)}
.arow.active{background:var(--sel);border-color:var(--accent)}
.arow .arow-main{flex:1 1 0;min-width:0}
.arow .arow-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arow .arow-meta{font-size:11px;color:var(--muted)}
.arow .arow-state{font-size:11px;padding:1px 7px;border-radius:10px;flex:0 0 auto}
.arow .arow-state.started{color:#6ee7b7;background:#064e3b}
.arow .arow-state.stopped{color:#94a3b8;background:#1e293b}
/* Compact connection navigator */
.conn-compact{display:flex;flex-direction:column;gap:0;margin-bottom:4px}
.conn-group-hdr{display:flex;align-items:center;gap:6px;padding:5px 8px 4px;font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.04em;cursor:pointer;user-select:none;background:var(--bg-2);border-radius:6px;margin-bottom:2px}
.conn-group-hdr .chevron{font-size:10px;transition:transform .15s;display:inline-block;margin-left:auto}
.conn-group-hdr.collapsed .chevron{transform:rotate(-90deg)}
.conn-item{display:flex;align-items:center;gap:8px;padding:5px 10px 5px 20px;border-radius:7px;cursor:pointer;border:1px solid transparent}
.conn-item:hover{background:var(--bg-3);border-color:var(--border)}
.conn-item.active{background:var(--sel);border-color:var(--accent)}
.conn-item .ci-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--border)}
.conn-item .ci-dot.connected{background:#22c55e}
.conn-item .ci-name{flex:1 1 0;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conn-item .ci-type{font-size:10px;color:var(--faint);flex:0 0 auto}
.conn-item .ci-env{font-size:10px;padding:0 5px;border-radius:8px;flex:0 0 auto;font-weight:600}
.ci-env.PROD{background:#450a0a;color:#fca5a5}
.ci-env.QAS{background:#78350f;color:#fde68a}
.ci-env.DEV{background:#064e3b;color:#6ee7b7}
.ci-env.SANDBOX{background:#1e293b;color:#64748b}
`;


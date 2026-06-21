export const STUDIO_CLIENT_SCRIPT = `
"use strict";
(function(){
var RO_DEFAULT = !!window.SMDG_READONLY_DEFAULT;
var ENV_COLORS = { DEV:"#22c55e", QAS:"#f59e0b", PROD:"#ef4444", SANDBOX:"#6366f1", CUSTOM:"#3b82f6" };
var SWATCHES = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#ec4899","#84cc16","#64748b"];
var ICONS = {
  db:"M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  sch:"M12 3l9 5-9 5-9-5 9-5z|M3 12l9 5 9-5|M3 16l9 5 9-5",
  fld:"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  tbl:"M3 5h18v14H3z|M3 10h18|M9 5v14|M15 5v14",
  viw:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z|M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  prc:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M12 2v3|M12 19v3|M2 12h3|M19 12h3|M5 5l2 2|M17 17l2 2|M19 5l-2 2|M7 17l-2 2",
  fun:"M6 3h9l4 4v14H6z|M14 3v4h4|M9 12h6|M9 16h6",
  syn:"M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1|M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  idx:"M14 4l6 6-9 9H5v-6z|M3 21h18",
  search:"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|M21 21l-4.3-4.3",
  star:"M12 3l2.9 6 6.1.5-4.6 4 1.4 6-5.8-3.3L6.2 19.5l1.4-6L3 9.5 9.1 9z",
  refresh:"M21 12a9 9 0 1 1-3-6.7|M21 4v5h-5",
  x:"M6 6l12 12|M18 6L6 18",
  plus:"M12 5v14|M5 12h14",
  imp:"M12 3v12|M7 10l5 5 5-5|M5 21h14",
  sql:"M4 5h16v14H4z|M7 9l3 3-3 3|M13 15h4",
  run:"M13 3L4 14h7l-1 7 9-11h-7z",
  save:"M5 3h11l3 3v15H5z|M8 3v6h7V3|M8 21v-7h8v7",
  gear:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a8 8 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.7-1l2.3 1 2-3.4z",
  home:"M3 11l9-8 9 8|M5 10v10h14V10",
  table2:"M4 4h16v16H4z|M4 9h16|M9 4v16",
  col:"M5 4v16|M12 4v16|M19 4v16",
  trash:"M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13|M10 11v6|M14 11v6",
  chevL:"M15 6l-6 6 6 6",
  chevR:"M9 6l6 6-6 6",
  filter:"M3 5h18l-7 8v6l-4 2v-8z",
  undo:"M9 7L4 12l5 5|M4 12h11a5 5 0 0 1 0 10h-3"
};
function svgFor(name){var d=ICONS[name]||"";return '<svg class="ic" viewBox="0 0 24 24">'+d.split("|").map(function(p){return '<path d="'+p+'"></path>';}).join("")+'</svg>';}
function icEl(name,cls){var s=document.createElement("span");s.className="ticon "+(cls||"");s.innerHTML=svgFor(name);return s;}
function gbtn(icon,title,onClick,extra){var b=el("button",{class:"gbtn "+(extra||""),title:title,html:svgFor(icon)});b.addEventListener("click",function(e){onClick(e);});return b;}

/* ---------- dom helpers ---------- */
function $(id){return document.getElementById(id);}
function el(tag,attrs,kids){var n=document.createElement(tag);if(attrs)for(var k in attrs){var v=attrs[k];if(v==null)continue;if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k==="html")n.innerHTML=v;else if(k.slice(0,2)==="on"&&typeof v==="function")n.addEventListener(k.slice(2),v);else n.setAttribute(k,v);}if(kids!=null){(Array.isArray(kids)?kids:[kids]).forEach(function(c){if(c==null)return;n.appendChild(typeof c==="string"||typeof c==="number"?document.createTextNode(String(c)):c);});}return n;}
function clear(n){while(n&&n.firstChild)n.removeChild(n.firstChild);return n;}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(s){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[s];});}
function highlightMatch(text,search){var t=String(text==null?"":text);var s=String(search==null?"":search).trim();if(!s)return esc(t);var lt=t.toLowerCase(),ls=s.toLowerCase(),out="",i=0,idx;while((idx=lt.indexOf(ls,i))>=0){out+=esc(t.slice(i,idx))+'<mark class="hl">'+esc(t.slice(idx,idx+s.length))+'</mark>';i=idx+s.length;}out+=esc(t.slice(i));return out;}
function wireSearch(input,onRun,onClear){input.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();onRun();}else if(e.key==="Escape"){e.preventDefault();input.value="";if(onClear)onClear();else onRun();}});}
function debounce(fn,ms){var t;return function(){var a=arguments,c=this;clearTimeout(t);t=setTimeout(function(){fn.apply(c,a);},ms||220);};}
function topSpin(on){$("topSpin").className=on?"spin":"spin hidden";}

/* ---------- api ---------- */
function api(method,path,body){topSpin(true);var opt={method:method,headers:{}};if(body!==undefined){opt.headers["content-type"]="application/json";opt.body=JSON.stringify(body);}return fetch(path,opt).then(function(r){return r.text().then(function(t){var j;try{j=t?JSON.parse(t):{};}catch(e){j={error:t};}if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j;});}).finally(function(){topSpin(false);});}
function qstr(o){return Object.keys(o).filter(function(k){return o[k]!=null&&o[k]!=="";}).map(function(k){return encodeURIComponent(k)+"="+encodeURIComponent(o[k]);}).join("&");}

/* ---------- toast + status ---------- */
function toast(msg,kind){var t=el("div",{class:"toast "+(kind||""),text:msg});$("toasts").appendChild(t);setTimeout(function(){t.style.opacity="0";setTimeout(function(){t.remove();},250);},kind==="err"?5200:3000);}
function logMsg(msg,kind){toast(msg,kind);}
function setConnStatus(text,kind){$("stConn").innerHTML="";$("stConn").appendChild(el("span",{class:"st-dot "+(kind||"")}));$("stConn").appendChild(el("span",{text:" "+text}));}
function setRun(on){$("stConn").firstChild.className="st-dot "+(on?"run":"ok");}

/* ---------- global state ---------- */
var S = { connections:[], activeConnId:"", connType:"", activeSchema:"", readOnly:RO_DEFAULT, tabs:[], activeTabId:"", seq:0, savedQueries:[], settings:{ restoreWorkspace:true, defaultRowLimit:100, defaultSchema:"", readOnlyByDefault:RO_DEFAULT, queryTimeoutMs:30000, autoFormatGeneratedSql:true, autoSaveDelayMs:500, maxHistoryItems:300, showProductionWarning:true, theme:"dark" } };
function activeConn(){return S.connections.filter(function(c){return c.id===S.activeConnId;})[0];}

/* ====================================================================
   CONTEXT MENU
   ==================================================================== */
function showCtx(x,y,items){var m=$("contextMenu");clear(m);items.forEach(function(it){if(it.sep){m.appendChild(el("div",{class:"ctxsep"}));return;}m.appendChild(el("div",{class:"ctxitem"+(it.danger?" danger":""),onclick:function(){hideCtx();it.onClick();}},[icEl(it.icon||"",""),el("span",{text:it.label})]));});m.classList.remove("hidden");var w=m.offsetWidth,h=m.offsetHeight;m.style.left=Math.min(x,window.innerWidth-w-8)+"px";m.style.top=Math.min(y,window.innerHeight-h-8)+"px";}
function hideCtx(){$("contextMenu").classList.add("hidden");}
document.addEventListener("click",hideCtx);
document.addEventListener("scroll",hideCtx,true);

/* ====================================================================
   MODAL
   ==================================================================== */
function openModal(node){var root=$("modalRoot");clear(root);var overlay=el("div",{class:"modal",onclick:function(e){if(e.target===overlay)closeModal();}},[node]);root.appendChild(overlay);root.classList.remove("hidden");}
function closeModal(){$("modalRoot").classList.add("hidden");clear($("modalRoot"));}

/* ====================================================================
   CONNECTIONS
   ==================================================================== */
function loadConnections(){var box=$("connList");box.innerHTML='<div class="skel"></div><div class="skel"></div>';return api("GET","/api/connections").then(function(r){S.connections=r.connections||[];renderConnections();}).catch(function(e){box.innerHTML='<div class="empty">'+esc(e.message)+'</div>';});}
var _collapsedGroups={};
function renderConnections(){
  var raw=($("connSearch").value||"");var q=raw.toLowerCase();
  var box=clear($("connList"));
  var rows=S.connections.filter(function(c){
    return (c.name+" "+c.type+" "+(c.org||"")+" "+(c.app||"")+" "+(c.environment||"")).toLowerCase().indexOf(q)>=0;
  });
  if(!rows.length){
    box.appendChild(el("div",{class:"empty",text:S.connections.length?"No results found":"No connections yet. Click + New or Import."}));
    return;
  }
  // Group: favorites first, then by environment
  var favs=rows.filter(function(c){return c.isFavorite;});
  var byEnv={};
  rows.filter(function(c){return !c.isFavorite;}).forEach(function(c){
    var env=c.environment||"OTHER";
    if(!byEnv[env])byEnv[env]=[];
    byEnv[env].push(c);
  });
  var ENV_ORDER=["PROD","QAS","DEV","SANDBOX","CUSTOM","OTHER"];

  function mkItem(c,q){
    var color=c.color||ENV_COLORS[c.environment]||"#64748b";
    var item=el("div",{class:"conn-item"+(c.id===S.activeConnId?" active":""),oncontextmenu:function(e){e.preventDefault();connMenu(e,c);}});
    item.addEventListener("click",function(){activateConnection(c.id);});
    var dot=el("div",{class:"ci-dot"+(S.activeConnId===c.id?" connected":""),style:"background:"+color});
    var nameEl=el("span",{class:"ci-name",title:c.name});nameEl.innerHTML=highlightMatch(c.name,q||"");
    var typeEl=el("span",{class:"ci-type",text:c.type==="hana"?"HANa":"PG"});
    item.appendChild(dot);item.appendChild(nameEl);item.appendChild(typeEl);
    return item;
  }

  function mkGroup(label,items,groupKey){
    if(!items.length)return null;
    var isCollapsed=!!_collapsedGroups[groupKey];
    var grp=el("div",{class:"conn-compact"});
    var hdr=el("div",{class:"conn-group-hdr"+(isCollapsed?" collapsed":"")});
    hdr.appendChild(el("span",{text:label}));
    hdr.appendChild(el("span",{class:"wiz-count",text:String(items.length)}));
    hdr.appendChild(el("span",{class:"chevron",text:isCollapsed?"▸":"▾"}));
    var grpBody=el("div");
    if(isCollapsed)grpBody.style.display="none";
    items.forEach(function(c){grpBody.appendChild(mkItem(c,raw));});
    hdr.addEventListener("click",function(){
      _collapsedGroups[groupKey]=!_collapsedGroups[groupKey];
      hdr.classList.toggle("collapsed");
      grpBody.style.display=_collapsedGroups[groupKey]?"none":"";
      hdr.querySelector(".chevron").textContent=_collapsedGroups[groupKey]?"▸":"▾";
    });
    grp.appendChild(hdr);grp.appendChild(grpBody);
    return grp;
  }

  var favGroup=mkGroup("★ Favorites",favs,"favs");
  if(favGroup)box.appendChild(favGroup);
  ENV_ORDER.forEach(function(env){
    var g=mkGroup(env,byEnv[env]||[],env);
    if(g)box.appendChild(g);
  });
}
function connCard(c,q){
  /* kept for any code that may still reference it; delegates to compact item */
  var color=c.color||ENV_COLORS[c.environment]||"#64748b";
  var card=el("div",{class:"conn-card"+(c.id===S.activeConnId?" active":""),style:"border-left-color:"+color,oncontextmenu:function(e){e.preventDefault();connMenu(e,c);}});
  card.addEventListener("click",function(){activateConnection(c.id);});
  var star=el("span",{class:"star"+(c.isFavorite?" on":""),title:"Favorite",onclick:function(e){e.stopPropagation();toggleFavorite(c);}});star.innerHTML=svgFor("star");
  card.appendChild(el("div",{class:"conn-top"},[icEl("db","db"),el("span",{class:"conn-name",html:highlightMatch(c.name,q||""),title:c.name}),star]));
  var sub=[c.org,c.space].filter(Boolean).join(" / ")||c.host;
  card.appendChild(el("div",{class:"conn-sub",text:sub,title:sub}));
  var tags=el("div",{class:"conn-tags"});
  tags.appendChild(el("span",{class:"tag type",text:c.type==="hana"?"HANA":"PostgreSQL"}));
  if(c.environment)tags.appendChild(el("span",{class:"tag env-"+c.environment,text:c.environment}));
  if(c.schema||c.serviceName)tags.appendChild(el("span",{class:"tag",text:c.serviceName||c.schema}));
  card.appendChild(tags);
  return card;
}
function isProdConn(c){return c&&/prod|production|prd|live/i.test((c.environment||"")+" "+(c.org||"")+" "+(c.app||"")+" "+(c.space||""));}
function activateConnection(id){S.activeConnId=id;var c=activeConn();S.connType=c?c.type:"";renderConnections();updateTopBadges();buildTreeForConnection();if(c&&isProdConn(c))logMsg("Warning: '"+c.name+"' looks like a production target.","warn");}
function updateTopBadges(){var c=activeConn();$("connBadge").textContent=c?("Conn: "+c.name):"No connection";$("connBadge").className="badge"+(c?" on":"");var tb=$("typeBadge");if(c){tb.classList.remove("hidden");tb.className="badge "+(c.type==="hana"?"hana":"pg");tb.textContent=c.type==="hana"?"HANA":"PostgreSQL";}else tb.classList.add("hidden");$("schemaBadge").textContent="Schema: "+(S.activeSchema||"-");var pb=$("prodBadge");if(c&&isProdConn(c))pb.classList.remove("hidden");else pb.classList.add("hidden");}
function toggleFavorite(c){api("POST","/api/connections/update",{id:c.id,isFavorite:!c.isFavorite}).then(function(){return loadConnections();}).catch(function(e){logMsg(e.message,"err");});}
function connMenu(e,c){showCtx(e.clientX,e.clientY,[
  {label:"Open SQL Console",icon:"sql",onClick:function(){S.activeConnId=c.id;S.connType=c.type;renderConnections();updateTopBadges();openSqlTab();}},
  {label:"Connect / Refresh tree",icon:"refresh",onClick:function(){activateConnection(c.id);}},
  {sep:true},
  {label:"Test connection",icon:"run",onClick:function(){testConn(c);}},
  {label:"Edit (name, color, env)",icon:"gear",onClick:function(){editConnModal(c);}},
  {label:c.isFavorite?"Unfavorite":"Favorite",icon:"star",onClick:function(){toggleFavorite(c);}},
  {label:"Refresh from BTP app env",icon:"imp",onClick:function(){if(c.app){api("POST","/api/connections/import-from-app",{app:c.app,serviceName:c.serviceName,type:c.type}).then(function(){logMsg("Refreshed from "+c.app,"ok");return loadConnections();}).catch(function(er){logMsg(er.message,"err");});}else logMsg("This connection has no linked BTP app.","warn");}},
  {label:"Duplicate",icon:"plus",onClick:function(){api("POST","/api/connections/duplicate",{id:c.id}).then(function(){return loadConnections();}).then(function(){logMsg("Duplicated.","ok");});}},
  {sep:true},
  {label:"Remove",icon:"x",danger:true,onClick:function(){if(confirm("Remove connection '"+c.name+"'?"))api("POST","/api/connections/remove",{id:c.id}).then(function(){if(S.activeConnId===c.id){S.activeConnId="";clear($("tree"));updateTopBadges();}return loadConnections();}).then(function(){logMsg("Removed.","ok");});}}
]);}
function testConn(c){setConnStatus("Testing "+c.name+"...","run");api("POST","/api/connections/test",{connectionId:c.id}).then(function(r){if(r.success){setConnStatus("Connected",  "ok");logMsg("Connection OK ("+(r.serverVersion||"")+") "+r.durationMs+"ms","ok");}else{setConnStatus("Failed","err");logMsg("Test failed: "+r.message,"err");}}).catch(function(e){setConnStatus("Failed","err");logMsg(e.message,"err");});}
function editConnModal(c){var sel={color:c.color||"",env:c.environment||""};var nameI=el("input",{class:"input",value:c.name});var sw=el("div",{class:"swatches"});SWATCHES.forEach(function(col){var s=el("div",{class:"swatch"+(sel.color===col?" sel":""),style:"background:"+col,onclick:function(){sel.color=col;Array.prototype.forEach.call(sw.children,function(x){x.classList.remove("sel");});s.classList.add("sel");}});sw.appendChild(s);});
  var envSel=el("select",{class:"select"});["","DEV","QAS","PROD","SANDBOX","CUSTOM"].forEach(function(en){envSel.appendChild(el("option",{value:en,text:en||"(none)"}));});envSel.value=sel.env;
  var d=el("div",{class:"dialog"},[el("h3",{text:"Edit connection"}),el("div",{class:"field"},[el("label",{text:"Display name"}),nameI]),el("div",{class:"field"},[el("label",{text:"Color"}),sw]),el("div",{class:"field"},[el("label",{text:"Environment"}),envSel]),el("div",{class:"row right"},[el("button",{class:"btn ghost",text:"Cancel",onclick:closeModal}),el("button",{class:"btn",text:"Save",onclick:function(){api("POST","/api/connections/update",{id:c.id,name:nameI.value.trim()||c.name,color:sel.color,environment:envSel.value}).then(function(){closeModal();return loadConnections();}).then(function(){updateTopBadges();logMsg("Connection updated.","ok");}).catch(function(e){logMsg(e.message,"err");});}})])]);openModal(d);}

/* ====================================================================
   OBJECT TREE (DBeaver-style, lazy)
   ==================================================================== */
function treeNode(opts){
  var chev=el("span",{class:"tchev"+(opts.leaf?" leaf":""),html:"\\u203a"});
  var label=el("span",{class:"tlabel",title:opts.label});if(opts.labelHtml)label.innerHTML=opts.labelHtml;else label.textContent=opts.label;
  var badge=el("span",{class:"tbadge"});
  var spin=el("span",{class:"hidden"});
  var row=el("div",{class:"trow"},[chev,icEl(opts.icon,opts.iconCls),label,badge,spin]);
  var kids=el("div",{class:"tchildren hidden"});
  var node=el("div",{class:"tnode"},[row,kids]);
  node._loaded=false;node._open=false;
  function setLoading(on){spin.className=on?"spin":"hidden";}
  function setBadge(t){badge.textContent=t==null?"":"("+t+")";}
  function expand(){if(opts.leaf)return;node._open=true;chev.classList.add("open");kids.classList.remove("hidden");if(!node._loaded&&opts.onExpand){node._loaded=true;setLoading(true);Promise.resolve(opts.onExpand(kids,setBadge)).catch(function(e){kids.appendChild(el("div",{class:"tnote",text:"Error: "+e.message}));}).finally(function(){setLoading(false);});}}
  function collapse(){node._open=false;chev.classList.remove("open");kids.classList.add("hidden");}
  function toggle(){node._open?collapse():expand();}
  if(!opts.leaf)chev.addEventListener("click",function(e){e.stopPropagation();toggle();});
  row.addEventListener("click",function(){if(opts.onClick)opts.onClick();else if(!opts.leaf)toggle();});
  if(opts.onDblClick)row.addEventListener("dblclick",opts.onDblClick);
  if(opts.onMenu)row.addEventListener("contextmenu",function(e){e.preventDefault();opts.onMenu(e);});
  node._row=row;node._kids=kids;node._expand=expand;node._reload=function(){node._loaded=false;clear(kids);if(node._open)expand();};
  return node;
}
function buildTreeForConnection(){var t=clear($("tree"));var c=activeConn();if(!c){t.appendChild(el("div",{class:"tnote",text:"Select a connection."}));return;}
  var root=treeNode({label:c.name,icon:"db",iconCls:"db",onExpand:function(kids){
    var cat=treeNode({label:"Catalog",icon:"fld",iconCls:"fld",onExpand:function(k2){
      var schemas=treeNode({label:"Schemas",icon:"sch",iconCls:"sch",onExpand:loadSchemasNode});
      k2.appendChild(schemas);schemas._expand();
    }});
    kids.appendChild(cat);cat._expand();
  }});
  t.appendChild(root);root._expand();
}
function loadSchemasNode(kids,setBadge){return api("GET","/api/catalog/schemas?"+qstr({connectionId:S.activeConnId})).then(function(r){var schemas=r.schemas||[];setBadge(schemas.length);var c=activeConn();var preferred=c&&c.schema;schemas.sort(function(a,b){return (a.isSystem?1:0)-(b.isSystem?1:0);});schemas.forEach(function(s){kids.appendChild(schemaNode(s));});var pref=schemas.filter(function(s){return s.name===preferred;})[0]||schemas.filter(function(s){return !s.isSystem;})[0];if(pref){S.activeSchema=pref.name;updateTopBadges();}});}
function schemaNode(s){return treeNode({label:s.name,icon:"sch",iconCls:"sch",onClick:function(){S.activeSchema=s.name;updateTopBadges();},onExpand:function(kids){
  var folders=[["Tables","table","tbl"],["Views","view","viw"],["Procedures","procedure","prc"],["Functions","function","fun"],["Synonyms","synonym","syn"],["Indexes","index","idx"]];
  folders.forEach(function(f){kids.appendChild(folderNode(s.name,f[0],f[1],f[2]));});
}});}
function folderNode(schema,label,kind,iconCls){return treeNode({label:label,icon:"fld",iconCls:"fld",onExpand:function(kids,setBadge){
  if(kind==="index"){kids.appendChild(el("div",{class:"tnote",text:"Open a table's Structure to view its indexes."}));setBadge(null);return;}
  var listBox=el("div");
  var search=el("input",{class:"input",placeholder:"Search "+label.toLowerCase()+"..."});
  var sb=el("div",{class:"searchbox tsearch"},[el("span",{html:svgFor("search")}),search]);
  kids.appendChild(sb);kids.appendChild(listBox);
  var run=function(){var sp=el("span",{class:"spin"});clear(listBox).appendChild(el("div",{class:"tnote"},[sp," loading..."]));var q=search.value||"";api("GET","/api/catalog/objects?"+qstr({connectionId:S.activeConnId,schema:schema,kinds:kind,search:q})).then(function(r){var objs=r.objects||[];setBadge(objs.length);clear(listBox);if(!objs.length){listBox.appendChild(el("div",{class:"tnote",text:q?"No results found":"None."}));return;}objs.forEach(function(o){listBox.appendChild(objectNode(schema,o,iconCls,q));});}).catch(function(e){clear(listBox).appendChild(el("div",{class:"tnote",text:e.message}));});};
  search.addEventListener("input",debounce(run,250));wireSearch(search,run);
  run();
}});}
function objectNode(schema,o,iconCls,q){var canData=o.kind==="table"||o.kind==="view"||o.kind==="column-view";return treeNode({label:o.name,labelHtml:highlightMatch(o.name,q),icon:iconCls,iconCls:iconCls,leaf:true,
  onClick:function(){selectTreeRow(this);},
  onDblClick:canData?function(){openDataTab(schema,o.name);}:null,
  onMenu:canData?function(e){objectMenu(e,schema,o);}:function(e){objectMenu(e,schema,o,true);}
});}
var _selRow=null;
function selectTreeRow(node){if(_selRow)_selRow._row.classList.remove("sel");_selRow=node;node._row.classList.add("sel");}
function objectMenu(e,schema,o,limited){var qn='"'+schema+'"."'+o.name+'"';var items=[];if(!limited){items.push({label:"Open Data",icon:"table2",onClick:function(){openDataTab(schema,o.name);}});items.push({label:"Open Structure",icon:"col",onClick:function(){openStructureTab(schema,o.name);}});items.push({sep:true});items.push({label:"Generate SELECT",icon:"sql",onClick:function(){api("POST","/api/table/sql",{connectionId:S.activeConnId,schema:schema,table:o.name,limit:100}).then(function(r){openSqlTab(r.select,o.name);});}});items.push({label:"Generate COUNT",icon:"sql",onClick:function(){api("POST","/api/table/sql",{connectionId:S.activeConnId,schema:schema,table:o.name}).then(function(r){openSqlTab(r.count,o.name);});}});}
  items.push({label:"Copy Full Name",icon:"col",onClick:function(){navigator.clipboard.writeText(qn);logMsg("Copied "+qn,"ok");}});
  items.push({label:"Copy Name",icon:"col",onClick:function(){navigator.clipboard.writeText(o.name);logMsg("Copied "+o.name,"ok");}});
  if(!limited){items.push({sep:true});
    items.push({label:"Copy SELECT",icon:"sql",onClick:function(){api("POST","/api/table/generate-sql",{connectionId:S.activeConnId,schema:schema,table:o.name,limit:100}).then(function(r){navigator.clipboard.writeText(r.select);logMsg("Copied SELECT","ok");}).catch(function(er){logMsg(er.message,"err");});}});
    items.push({label:"Copy INSERT template",icon:"sql",onClick:function(){api("POST","/api/table/generate-sql",{connectionId:S.activeConnId,schema:schema,table:o.name}).then(function(r){navigator.clipboard.writeText(r.insert);logMsg("Copied INSERT template","ok");}).catch(function(er){logMsg(er.message,"err");});}});
    items.push({label:"Copy UPDATE template",icon:"sql",onClick:function(){api("POST","/api/table/generate-sql",{connectionId:S.activeConnId,schema:schema,table:o.name}).then(function(r){navigator.clipboard.writeText(r.update);logMsg("Copied UPDATE template","ok");}).catch(function(er){logMsg(er.message,"err");});}});
  }
  showCtx(e.clientX,e.clientY,items);}

/* ====================================================================
   WORKSPACE TABS
   ==================================================================== */
var _dragTabId=null;
function orderedTabs(){return S.tabs.slice().sort(function(a,b){return (b.pinned?1:0)-(a.pinned?1:0);});}
function renderTabBar(){var bar=clear($("tabbar"));orderedTabs().forEach(function(tab){var chip=el("div",{class:"wtab"+(tab.id===S.activeTabId?" active":"")+(tab.pinned?" pinned":""),draggable:"true"});chip.addEventListener("click",function(){switchTab(tab.id);});chip.addEventListener("contextmenu",function(e){e.preventDefault();tabMenu(e,tab);});
  chip.addEventListener("dragstart",function(e){_dragTabId=tab.id;chip.classList.add("dragging");if(e.dataTransfer)e.dataTransfer.effectAllowed="move";});
  chip.addEventListener("dragend",function(){chip.classList.remove("dragging");Array.prototype.forEach.call(bar.children,function(x){x.classList.remove("dragover");});});
  chip.addEventListener("dragover",function(e){e.preventDefault();chip.classList.add("dragover");});
  chip.addEventListener("dragleave",function(){chip.classList.remove("dragover");});
  chip.addEventListener("drop",function(e){e.preventDefault();chip.classList.remove("dragover");if(_dragTabId&&_dragTabId!==tab.id)reorderTab(_dragTabId,tab.id);});
  chip.appendChild(el("span",{class:"t-ico"+(tab.pinned?" pin":""),html:svgFor(tab.pinned?"star":(tab.icon||"sql"))}));
  chip.appendChild(el("span",{class:"t-title",text:tab.title,title:tab.title}));
  if(tab.dirty)chip.appendChild(el("span",{class:"dot"}));
  if(tab.closable!==false)chip.appendChild(el("span",{class:"x",html:svgFor("x"),onclick:function(e){e.stopPropagation();closeTab(tab.id);}}));
  bar.appendChild(chip);});}
function reorderTab(srcId,targetId){var src=tabById(srcId);var ti=-1;for(var i=0;i<S.tabs.length;i++)if(S.tabs[i].id===targetId)ti=i;if(!src||ti<0)return;S.tabs=S.tabs.filter(function(t){return t.id!==srcId;});var idx=-1;for(var j=0;j<S.tabs.length;j++)if(S.tabs[j].id===targetId)idx=j;S.tabs.splice(idx,0,src);renderTabBar();scheduleWorkspaceSave();}
function tabMenu(e,tab){showCtx(e.clientX,e.clientY,[
  {label:"Close",icon:"x",onClick:function(){closeTab(tab.id);}},
  {label:"Close Others",icon:"x",onClick:function(){closeOtherTabs(tab.id);}},
  {label:"Close Tabs to the Right",icon:"x",onClick:function(){closeTabsToRight(tab.id);}},
  {sep:true},
  {label:tab.pinned?"Unpin Tab":"Pin Tab",icon:"star",onClick:function(){tab.pinned=!tab.pinned;renderTabBar();scheduleWorkspaceSave();}},
  {label:"Rename Tab",icon:"gear",onClick:function(){var n=prompt("Tab name",tab.title);if(n){tab.title=n;renderTabBar();scheduleWorkspaceSave();}}},
  {label:"Duplicate Tab",icon:"plus",onClick:function(){duplicateTab(tab);}}
]);}
function duplicateTab(tab){if(tab.kind==="sql"&&tab.state.editor)openSqlTab(tab.state.editor.value,tab.title);else if(tab.kind==="data"&&tab.meta)openDataTab(tab.meta.schema,tab.meta.table);else if(tab.kind==="structure"&&tab.meta)openStructureTab(tab.meta.schema,tab.meta.table);}
function closeOtherTabs(keepId){var others=S.tabs.filter(function(t){return t.id!==keepId&&t.closable!==false;});if(others.some(function(t){return t.dirty;})&&!confirm("Close other tabs? Unsaved changes will be lost."))return;others.forEach(function(t){t.el.remove();});S.tabs=S.tabs.filter(function(t){return t.id===keepId||t.closable===false;});switchTab(keepId);renderTabBar();scheduleWorkspaceSave();}
function closeTabsToRight(fromId){var ord=orderedTabs();var i=0;for(var k=0;k<ord.length;k++)if(ord[k].id===fromId)i=k;var toClose=ord.slice(i+1).filter(function(t){return t.closable!==false;});if(toClose.some(function(t){return t.dirty;})&&!confirm("Close tabs to the right? Unsaved changes will be lost."))return;var ids={};toClose.forEach(function(t){ids[t.id]=1;t.el.remove();});S.tabs=S.tabs.filter(function(t){return !ids[t.id];});if(ids[S.activeTabId])switchTab(fromId);renderTabBar();scheduleWorkspaceSave();}
function nextTab(dir){var ord=orderedTabs();if(ord.length<2)return;var i=0;for(var k=0;k<ord.length;k++)if(ord[k].id===S.activeTabId)i=k;var ni=(i+dir+ord.length)%ord.length;switchTab(ord[ni].id);}
function openTab(spec){var ex=S.tabs.filter(function(t){return t.key===spec.key;})[0];if(ex){switchTab(ex.id);return ex;}var id=spec.restoreId||("wt"+(++S.seq));var pane=el("div",{class:"tabpane hidden"});$("tabcontent").appendChild(pane);var now=new Date().toISOString();var tab={id:id,key:spec.key,kind:spec.kind,title:spec.title,icon:spec.icon,dirty:false,closable:spec.closable!==false,el:pane,state:{},connectionId:spec.connectionId||"",meta:spec.meta||null,pinned:!!spec.pinned,openedAt:now};S.tabs.push(tab);spec.build(pane,tab);renderTabBar();switchTab(id);scheduleWorkspaceSave();return tab;}
function switchTab(id){S.activeTabId=id;S.tabs.forEach(function(t){t.el.classList.toggle("hidden",t.id!==id);});renderTabBar();var tab=tabById(id);if(tab&&tab.onShow)tab.onShow();updatePendingStatus();scheduleWorkspaceSave();}
function tabById(id){return S.tabs.filter(function(t){return t.id===id;})[0];}
function setDirty(tab,on){tab.dirty=on;renderTabBar();updatePendingStatus();}
function closeTab(id){var tab=tabById(id);if(!tab)return;if(tab.dirty&&!confirm("'"+tab.title+"' has unsaved changes. Close anyway?"))return;tab.el.remove();var idx=S.tabs.indexOf(tab);S.tabs=S.tabs.filter(function(t){return t.id!==id;});if(S.activeTabId===id){var next=S.tabs[Math.max(0,idx-1)];if(next)switchTab(next.id);else openWelcome();}renderTabBar();scheduleWorkspaceSave();}
function updatePendingStatus(){var tab=tabById(S.activeTabId);var n=tab&&tab.state&&tab.state.g?pendingCount(tab.state.g):0;$("stPending").textContent=n>0?(n+" pending change"+(n>1?"s":"")):"";$("stPending").className=n>0?"st-item st-pending":"st-item";}

/* ---- workspace persistence ---- */
function kindToType(k){return k==="data"?"data-grid":k==="structure"?"metadata":k;}
function serializeWorkspace(){var tabs=S.tabs.filter(function(t){return t.kind!=="welcome";}).map(function(t){var st={id:t.id,type:kindToType(t.kind),title:t.title,pinned:!!t.pinned,dirty:!!t.dirty,connectionId:t.connectionId||undefined,openedAt:t.openedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(t.meta){st.schema=t.meta.schema;st.objectName=t.meta.table;st.objectType=t.meta.objectType;}if(t.kind==="sql"&&t.state.editor)st.sql=t.state.editor.value;if(t.kind==="data"&&t.state.g){var g=t.state.g;st.filter=g.whereI.value;st.pageSize=parseInt(g.pageSel.value,10);st.pageIndex=g.offset;st.sort=g.orderBy?[{column:g.orderBy,direction:g.orderDir}]:[];}return st;});return {version:1,activeTabId:S.activeTabId,tabs:tabs,tabGroups:[],layout:{readOnly:S.readOnly,sidebarWidth:$("sidebar").offsetWidth},updatedAt:new Date().toISOString()};}
var _wsTimer=null;
function scheduleWorkspaceSave(){if(_wsTimer)clearTimeout(_wsTimer);_wsTimer=setTimeout(function(){api("PUT","/api/studio/workspace",serializeWorkspace()).catch(function(){});},Math.max(400,S.settings.autoSaveDelayMs||500));}
function loadSettings(){return api("GET","/api/studio/settings").then(function(r){if(r.settings)S.settings=r.settings;}).catch(function(){});}
function restoreWorkspace(){if(!S.settings.restoreWorkspace)return Promise.resolve();return api("GET","/api/studio/workspace").then(function(r){var ws=r.workspace;if(!ws||!ws.tabs||!ws.tabs.length)return;var active=null;ws.tabs.forEach(function(st){try{
  if(st.type==="sql"){if(st.connectionId){var c=byId(st.connectionId);if(c){S.activeConnId=c.id;S.connType=c.type;}}var t=openSqlTab(st.sql||"",null);t.title=st.title;t.pinned=!!st.pinned;if(st.id===ws.activeTabId)active=t.id;}
  else if(st.type==="data-grid"){var cd=byId(st.connectionId);if(!cd){logMsg("Tab '"+st.title+"' not restored: connection removed.","warn");return;}S.activeConnId=cd.id;S.connType=cd.type;var dt=openDataTab(st.schema,st.objectName,{where:st.filter,pageSize:st.pageSize,sort:st.sort,offset:st.pageIndex});dt.pinned=!!st.pinned;if(st.id===ws.activeTabId)active=dt.id;}
  else if(st.type==="metadata"){var cm=byId(st.connectionId);if(!cm)return;S.activeConnId=cm.id;S.connType=cm.type;var mt=openStructureTab(st.schema,st.objectName);mt.pinned=!!st.pinned;if(st.id===ws.activeTabId)active=mt.id;}
}catch(e){}});updateTopBadges();renderTabBar();if(active)switchTab(active);logMsg("Workspace restored ("+ws.tabs.length+" tab"+(ws.tabs.length>1?"s":"")+").","ok");}).catch(function(){});}
function byId(id){return S.connections.filter(function(c){return c.id===id;})[0];}

/* ====================================================================
   WELCOME
   ==================================================================== */
function openWelcome(){openTab({key:"welcome",kind:"welcome",title:"Welcome",icon:"home",closable:false,build:buildWelcome});}
function buildWelcome(pane){var w=el("div",{class:"welcome"});w.appendChild(el("h1",{text:"SimpleMDG CF DB Studio"}));w.appendChild(el("div",{class:"lede",text:"A local HANA / PostgreSQL explorer with BTP credential import. Local only \\u00b7 127.0.0.1"}));
  var cards=el("div",{class:"wcards"});
  cards.appendChild(wcard("imp","Import from BTP App","Read cf env and detect HANA/PostgreSQL credentials.",openBtpWizard));
  cards.appendChild(wcard("plus","Add direct connection","Connect by host/port/user like DBeaver.",function(){newConnModal();}));
  cards.appendChild(wcard("sql","Open SQL Console","Write and run SQL with safety checks.",function(){if(!S.activeConnId)return logMsg("Select a connection first.","warn");openSqlTab();}));
  cards.appendChild(wcard("db","Connect to cached DB","Pick a saved connection from the left.",function(){if(S.connections[0])activateConnection(S.connections[0].id);}));
  w.appendChild(cards);
  var cols=el("div",{class:"wcols"});
  var recent=el("div",{class:"wcol"},[el("h4",{text:"Recent connections"})]);var rl=el("div",{class:"wlist"});S.connections.slice(0,5).forEach(function(c){rl.appendChild(el("div",{class:"wli",onclick:function(){activateConnection(c.id);}},[el("b",{text:c.name}),el("div",{class:"note",text:(c.type==="hana"?"HANA":"PostgreSQL")+" \\u00b7 "+(c.org||c.host)})]));});if(!S.connections.length)rl.appendChild(el("div",{class:"empty",text:"None yet."}));recent.appendChild(rl);
  var rq=el("div",{class:"wcol"},[el("h4",{text:"Recent queries"})]);var ql=el("div",{class:"wlist"});S.savedQueries.slice(0,5).forEach(function(q){ql.appendChild(el("div",{class:"wli",onclick:function(){openSqlTab(q.sql,q.name);}},[el("b",{text:q.name}),el("div",{class:"note",text:(q.connectionType||"")+" \\u00b7 "+new Date(q.updatedAt).toLocaleString()})]));});if(!S.savedQueries.length)ql.appendChild(el("div",{class:"empty",text:"None yet."}));rq.appendChild(ql);
  cols.appendChild(recent);cols.appendChild(rq);w.appendChild(cols);
  pane.appendChild(w);
}
function wcard(icon,title,desc,onClick){return el("div",{class:"wcard",onclick:onClick},[el("div",{class:"wc-ic",html:svgFor(icon)}),el("h3",{text:title}),el("p",{text:desc})]);}

/* ====================================================================
   SQL CONSOLE TAB
   ==================================================================== */
var DANGER=/\\b(drop|truncate|alter|grant|revoke)\\b/i;
function openSqlTab(sql,nameHint,queryId){var title="SQL"+(nameHint?": "+nameHint:" Console");return openTab({key:"sql:"+(++S.seq),kind:"sql",title:title,icon:"sql",connectionId:S.activeConnId,meta:{queryId:queryId||null},build:function(pane,tab){tab.connectionId=S.activeConnId;buildSqlPane(pane,tab,sql!=null?sql:"select * from DUMMY");}});}
function buildSqlPane(pane,tab,initialSql){
  var editor=el("textarea",{class:"editor",spellcheck:"false"});editor.value=initialSql;tab.state.editor=editor;
  var gutter=el("div",{class:"gutter",text:"1"});
  function syncGutter(){var lines=editor.value.split("\\n").length;var s="";for(var i=1;i<=lines;i++)s+=i+"\\n";gutter.textContent=s;gutter.scrollTop=editor.scrollTop;}
  tab.state.syncGutter=syncGutter;
  editor.addEventListener("input",function(){setDirty(tab,true);syncGutter();scheduleWorkspaceSave();});
  editor.addEventListener("scroll",function(){gutter.scrollTop=editor.scrollTop;});
  editor.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();runMode(tab,"selected");}else if(e.key==="F5"){e.preventDefault();runMode(tab,"all");}else if((e.ctrlKey||e.metaKey)&&(e.key==="s"||e.key==="S")){e.preventDefault();saveQueryTab(tab);}});
  var editwrap=el("div",{class:"editwrap"},[gutter,editor]);
  var limitSel=el("select",{class:"select",style:"width:auto"});["100","500","1000","5000","0"].forEach(function(v){limitSel.appendChild(el("option",{value:v,text:v==="0"?"No limit":v}));});limitSel.value=String(S.settings.defaultRowLimit||100);tab.state.limit=limitSel;
  var runBtn=el("button",{class:"btn",onclick:function(){runMode(tab,"selected");}},[el("span",{html:svgFor("run")})," Run"]);tab.state.runBtn=runBtn;
  var runMenu=el("button",{class:"btn",style:"padding:6px 7px",html:"\\u25be",title:"Run options",onclick:function(e){showCtx(e.clientX,e.clientY,[{label:"Run Selected (Ctrl+Enter)",icon:"run",onClick:function(){runMode(tab,"selected");}},{label:"Run Current Statement",icon:"run",onClick:function(){runMode(tab,"current");}},{label:"Run All (F5)",icon:"run",onClick:function(){runMode(tab,"all");}},{label:"Explain",icon:"sql",onClick:function(){runMode(tab,"explain");}}]);}});
  var tb=el("div",{class:"toolbar"},[runBtn,runMenu,el("button",{class:"btn sec",text:"Format",onclick:function(){api("POST","/api/sql/format",{sql:editor.value}).then(function(r){setEditorValue(tab,r.sql);}).catch(function(){setEditorValue(tab,formatSql(editor.value));});}}),el("span",{class:"note",text:"Limit"}),limitSel,el("button",{class:"btn ghost",text:"Save",title:"Ctrl+S",onclick:function(){saveQueryTab(tab);}}),el("button",{class:"btn ghost",text:"CSV",onclick:function(){exportResult(tab,"csv");}}),el("button",{class:"btn ghost",text:"JSON",onclick:function(){exportResult(tab,"json");}}),el("span",{class:"grow"}),el("span",{class:"note",id:"sqlmeta_"+tab.id})]);
  var body=el("div",{class:"pane-body"});var errBox=el("div",{class:"errbox hidden"});var grid=el("div",{class:"gridwrap"});tab.state.err=errBox;tab.state.grid=grid;
  body.appendChild(editwrap);body.appendChild(errBox);body.appendChild(el("div",{class:"note",text:"Result"}));body.appendChild(grid);
  pane.appendChild(tb);pane.appendChild(body);syncGutter();
}
function setEditorValue(tab,v){tab.state.editor.value=v;if(tab.state.syncGutter)tab.state.syncGutter();setDirty(tab,true);scheduleWorkspaceSave();}
function splitRangesClient(sql){var ranges=[],buf="",start=-1,inStr=false,q="",inLine=false,inBlock=false;function push(e){if(buf.trim())ranges.push({sql:buf.trim(),start:start,end:e});buf="";start=-1;}for(var i=0;i<sql.length;i++){var ch=sql[i],nx=sql[i+1];if(start===-1&&!/\\s/.test(ch))start=i;if(inLine){buf+=ch;if(ch==="\\n")inLine=false;continue;}if(inBlock){buf+=ch;if(ch==="*"&&nx==="/"){buf+=nx;i++;inBlock=false;}continue;}if(inStr){buf+=ch;if(ch===q)inStr=false;continue;}if(ch==="-"&&nx==="-"){inLine=true;buf+=ch;continue;}if(ch==="/"&&nx==="*"){inBlock=true;buf+=ch;continue;}if(ch==="'"||ch==='"'){inStr=true;q=ch;buf+=ch;continue;}if(ch===";"){push(i);continue;}buf+=ch;}push(sql.length);return ranges;}
function statementAtCursor(sql,off){var r=splitRangesClient(sql);for(var i=0;i<r.length;i++)if(off>=r[i].start&&off<=r[i].end+1)return r[i].sql;return (r[r.length-1]||{}).sql||sql.trim();}
function runMode(tab,mode){var ed=tab.state.editor;var hasSel=ed.selectionStart!=ed.selectionEnd;var sel=hasSel?ed.value.substring(ed.selectionStart,ed.selectionEnd).trim():"";var sql;if(mode==="all")sql=ed.value.trim();else if(mode==="current")sql=statementAtCursor(ed.value,ed.selectionStart);else if(mode==="explain"){if(S.connType!=="postgresql")return logMsg("Explain currently supports PostgreSQL.","warn");sql="EXPLAIN "+(sel||statementAtCursor(ed.value,ed.selectionStart));}else sql=sel||statementAtCursor(ed.value,ed.selectionStart);if(!sql)return logMsg("Nothing to run.","warn");execSql(tab,sql);}
function execSql(tab,sql,confirmed){if(!S.activeConnId)return logMsg("Select a connection first.","warn");
  if(!confirmed&&DANGER.test(sql)){if(!confirm("This statement may modify or drop data:\\n\\n"+sql.slice(0,160)+"\\n\\nRun anyway?"))return;}
  tab.state.err.classList.add("hidden");tab.state.runBtn.disabled=true;tab.state.runBtn.innerHTML="";tab.state.runBtn.appendChild(el("span",{class:"spin"}));tab.state.runBtn.appendChild(document.createTextNode(" Running..."));setRun(true);setConnStatus("Running query...","run");
  var limit=parseInt(tab.state.limit.value,10);
  api("POST","/api/query/run",{connectionId:S.activeConnId,sql:sql,limit:limit,readOnly:S.readOnly,confirmDangerous:true}).then(function(r){
    tab.state.runBtn.innerHTML=svgFor("run")+" Run";tab.state.runBtn.disabled=false;setConnStatus("Connected","ok");
    if(r.blocked){tab.state.err.textContent="Read-only mode blocks: "+(r.safety&&r.safety.matchedKeywords?r.safety.matchedKeywords.join(", "):"write/DDL");tab.state.err.classList.remove("hidden");return;}
    if(!r.ok){tab.state.err.textContent="SQL failed ("+(S.connType==="hana"?"HANA":"PostgreSQL")+")\\n"+r.error;tab.state.err.classList.remove("hidden");return;}
    tab.state.lastResult=r.result;renderResultGrid(tab.state.grid,r.result,null);
    $("sqlmeta_"+tab.id).textContent="Rows: "+r.result.rowCount+(r.result.affectedRows!=null?" \\u00b7 Affected: "+r.result.affectedRows:"")+" \\u00b7 "+r.result.durationMs+"ms"+(r.result.truncated?" \\u00b7 truncated":"");
    $("stDuration").textContent=r.result.durationMs+"ms";$("stRows").textContent=r.result.rowCount+" rows";
  }).catch(function(e){tab.state.runBtn.innerHTML=svgFor("run")+" Run";tab.state.runBtn.disabled=false;setConnStatus("Connected","ok");tab.state.err.textContent=e.message;tab.state.err.classList.remove("hidden");});
}
function saveQueryTab(tab){var sql=tab.state.editor.value.trim();if(!sql)return logMsg("Nothing to save.","warn");var qid=tab.meta&&tab.meta.queryId;if(qid){api("PUT","/api/queries/"+encodeURIComponent(qid),{name:tab.title.replace(/^SQL: ?/,""),sql:sql}).then(function(){setDirty(tab,false);loadSavedQueries();logMsg("Query updated.","ok");}).catch(function(e){logMsg(e.message,"err");});return;}var name=prompt("Save query as","Query "+new Date().toLocaleString());if(!name)return;api("POST","/api/queries",{name:name,sql:sql,connectionId:S.activeConnId,connectionType:S.connType}).then(function(r){if(tab.meta)tab.meta.queryId=r.query.id;tab.title="SQL: "+name;setDirty(tab,false);renderTabBar();loadSavedQueries();logMsg("Query saved.","ok");}).catch(function(e){logMsg(e.message,"err");});}
function exportResult(tab,fmt){var res=tab.state.lastResult;if(!res||!res.rows.length)return logMsg("No result to export.","warn");var fields=res.fields&&res.fields.length?res.fields:Object.keys(res.rows[0]);fetch(fmt==="csv"?"/api/export/csv":"/api/export/json",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fields:fields,rows:res.rows})}).then(function(r){return r.blob();}).then(function(b){var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=fmt==="csv"?"result.csv":"result.json";a.click();logMsg("Exported "+fmt.toUpperCase(),"ok");});}
function formatSql(sql){return sql.replace(/\\s+/g," ").replace(/\\b(select|from|where|and|or|order by|group by|having|limit|offset|inner join|left join|right join|join|on|union|values|set|insert into|update|delete from|create table|alter table)\\b/gi,function(m){return "\\n"+m.toUpperCase();}).trim();}

/* generic read-only result grid (sql console) */
function renderResultGrid(box,result,onSort){clear(box);if(!result||!result.rows||!result.rows.length){box.appendChild(el("div",{class:"empty",text:result&&result.affectedRows!=null?("Affected rows: "+result.affectedRows):"No rows."}));return;}var fields=result.fields&&result.fields.length?result.fields:Object.keys(result.rows[0]);var table=el("table",{class:"grid"});var thead=el("thead");var htr=el("tr");htr.appendChild(el("th",{class:"rowhdr",text:"#"}));fields.forEach(function(f){htr.appendChild(el("th",{text:f,title:f}));});thead.appendChild(htr);table.appendChild(thead);var tb=el("tbody");result.rows.forEach(function(row,ri){var tr=el("tr");tr.appendChild(el("td",{class:"rowhdr",text:ri+1}));fields.forEach(function(f){var v=row[f];var disp=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);var td=el("td",{class:typeof v==="number"?"num":"",title:disp,text:disp.length>400?disp.slice(0,400)+"\\u2026":disp});td.addEventListener("dblclick",function(){openCellViewer(v);});tr.appendChild(td);});tb.appendChild(tr);});table.appendChild(tb);box.appendChild(table);}

/* ====================================================================
   DATA GRID TAB (editable, pending changes)
   ==================================================================== */
function openDataTab(schema,table,restore){return openTab({key:"data:"+S.activeConnId+":"+schema+"."+table,kind:"data",title:table,icon:"table2",connectionId:S.activeConnId,meta:{schema:schema,table:table,objectType:"table"},build:function(pane,tab){tab.connectionId=S.activeConnId;buildDataPane(pane,tab,schema,table,restore);}});}
var _pop=null;
function showPopover(node,anchor){closePop();_pop=node;node.style.position="fixed";document.body.appendChild(node);var r=anchor.getBoundingClientRect();node.style.left=Math.min(r.left,window.innerWidth-node.offsetWidth-10)+"px";node.style.top=(r.bottom+6)+"px";setTimeout(function(){document.addEventListener("mousedown",popOutside,true);},0);}
function popOutside(e){if(_pop&&!_pop.contains(e.target))closePop();}
function closePop(){if(_pop){_pop.remove();_pop=null;document.removeEventListener("mousedown",popOutside,true);}}
function showFilterSql(tab,anchor){var g=tab.state.g;api("POST","/api/sql/generate-table-query",{connectionId:S.activeConnId,schema:g.schema,table:g.table,where:g.whereI.value||"",sort:g.orderBy?[{column:g.orderBy,direction:g.orderDir}]:[],limit:parseInt(g.pageSel.value,10),offset:g.offset}).then(function(r){var pre=el("pre",{text:r.sql});var pop=el("div",{class:"popover"},[el("div",{class:"row",style:"margin-bottom:8px"},[el("b",{text:"Generated SQL"}),el("span",{style:"flex:1"}),el("button",{class:"btn sm sec",text:"Copy",onclick:function(){navigator.clipboard.writeText(r.sql);logMsg("Copied SQL","ok");}}),el("button",{class:"btn sm",text:"Open in Console",onclick:function(){closePop();openSqlTab(r.sql,g.table);}}),el("button",{class:"btn sm ghost",text:"Close",onclick:closePop})]),pre]);showPopover(pop,anchor);}).catch(function(e){logMsg(e.message,"err");});}
function pendingCount(g){return Object.keys(g.edits).length+Object.keys(g.deletes).length+g.inserts.length;}
function rowKeyOf(g,row){return g.pk.map(function(k){return String(row[k]);}).join("\\u0001");}
function buildDataPane(pane,tab,schema,table,restore){
  var g={schema:schema,table:table,pk:[],columns:[],rows:[],offset:0,pageSize:100,where:"",orderBy:"",orderDir:"asc",total:null,edits:{},deletes:{},inserts:[],errors:{},editable:false,sel:{},iseq:0,undo:[],redo:[]};tab.state.g=g;
  var whereI=el("input",{spellcheck:"false",placeholder:"WHERE clause, e.g. STATUS = 'A' AND CREATEDBY LIKE '%admin%'"});g.whereI=whereI;
  var clr=el("span",{class:"clr",html:svgFor("x"),title:"Clear filter"});
  var whereBox=el("div",{class:"wherebox"},[el("span",{html:svgFor("filter")}),whereI,clr]);
  var apply=function(){g.where=whereI.value;g.offset=0;applyBtn.classList.remove("on");loadData(tab);};
  var applyBtn=gbtn("run","Apply filter (Enter)",apply);g.applyBtn=applyBtn;
  clr.addEventListener("click",function(){whereI.value="";whereBox.classList.remove("has");apply();});
  whereI.addEventListener("input",function(){whereBox.classList.toggle("has",!!whereI.value);applyBtn.classList.toggle("on",whereI.value!==g.where);});
  whereI.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();apply();if(e.ctrlKey||e.metaKey)showFilterSql(tab,applyBtn);}else if(e.key==="Escape"){e.preventDefault();whereI.value="";whereBox.classList.remove("has");apply();}});
  var insBtn=gbtn("plus","Insert row",function(){addInsertRow(tab);});g.insBtn=insBtn;
  var delBtn=gbtn("trash","Mark selected rows for delete",function(){toggleDeleteSelected(tab);},"danger");g.delBtn=delBtn;
  var tb=el("div",{class:"gtoolbar"},[whereBox,applyBtn,gbtn("sql","Show generated SQL",function(e){showFilterSql(tab,e.currentTarget);}),gbtn("refresh","Refresh data",function(e){var b=e.currentTarget;b.classList.add("spinning");loadData(tab,function(){b.classList.remove("spinning");});}),el("span",{class:"gsep"}),insBtn,delBtn,gbtn("col","Open structure",function(){openStructureTab(schema,table);}),el("span",{class:"gsep"}),gbtn("imp","Export data",function(e){openExportMenu(tab,e.currentTarget);})]);
  var changeBar=el("div",{class:"changebar hidden"});g.changeBar=changeBar;
  var grid=el("div",{class:"gridwrap"});g.grid=grid;
  var pageSel=el("select");["100","500","1000"].forEach(function(v){pageSel.appendChild(el("option",{value:v,text:v}));});g.pageSel=pageSel;
  pageSel.addEventListener("change",function(){g.offset=0;loadData(tab);});
  var rangeSpan=el("span",{class:"note"});g.rangeSpan=rangeSpan;var durSpan=el("span",{class:"note"});g.durSpan=durSpan;
  var footer=el("div",{class:"gridfoot"},[rangeSpan,el("span",{style:"flex:1"}),el("span",{class:"pg"},[gbtn("chevL","Previous page",function(){g.offset=Math.max(0,g.offset-parseInt(pageSel.value,10));loadData(tab);}),el("span",{class:"note",text:"Rows"}),pageSel,gbtn("chevR","Next page",function(){g.offset+=parseInt(pageSel.value,10);loadData(tab);})]),durSpan]);
  pane.appendChild(crumbs((activeConn()||{}).name,schema,table));pane.appendChild(tb);pane.appendChild(changeBar);pane.appendChild(grid);pane.appendChild(footer);
  updateDirtyButtons(tab);
  api("GET","/api/catalog/columns?"+qstr({connectionId:S.activeConnId,schema:schema,table:table})).then(function(r){g.columns=r.columns||[];}).catch(function(){});
  api("GET","/api/catalog/primary-key?"+qstr({connectionId:S.activeConnId,schema:schema,table:table})).then(function(r){g.pk=(r.primaryKey&&r.primaryKey.columns)||[];g.editable=g.pk.length>0;insBtn.disabled=!g.editable;delBtn.disabled=!g.editable;insBtn.title=g.editable?"Insert row":"Read-only (no primary key)";renderGrid(tab);}).catch(function(){});
  if(restore){g.where=restore.where||"";whereI.value=g.where;whereBox.classList.toggle("has",!!g.where);g.offset=restore.offset||0;if(restore.pageSize)pageSel.value=String(restore.pageSize);if(restore.sort&&restore.sort[0]){g.orderBy=restore.sort[0].column;g.orderDir=restore.sort[0].direction;}}
  loadData(tab);
  loadCount(tab);
}
function selectedKeys(g){return Object.keys(g.sel);}
function loadData(tab,onDone){var g=tab.state.g;g.pageSize=parseInt(g.pageSel.value,10);clear(g.grid).appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," loading data..."]));$("stDuration").textContent="…";api("POST","/api/table/data",{connectionId:S.activeConnId,schema:g.schema,table:g.table,limit:g.pageSize,offset:g.offset,where:g.where,orderBy:g.orderBy,orderDirection:g.orderDir}).then(function(r){g.rows=r.result.rows;g.sel={};renderGrid(tab);var to=g.offset+r.result.rowCount;g.rangeSpan.textContent="Showing "+(r.result.rowCount?g.offset+1:0)+"-"+to+(g.total!=null?" of "+g.total.toLocaleString():"");g.durSpan.textContent="Duration: "+r.result.durationMs+"ms · Offset: "+g.offset;$("stDuration").textContent=r.result.durationMs+"ms";$("stRows").textContent=(g.total!=null?g.total+" total":r.result.rowCount+" rows");if(onDone)onDone();}).catch(function(e){clear(g.grid).appendChild(el("div",{class:"errbox",text:"Cannot load data.\\nReason: "+e.message+"\\nAction: test the connection or refresh from BTP app env."}));if(onDone)onDone();});}
function loadCount(tab){var g=tab.state.g;api("POST","/api/table/count",{connectionId:S.activeConnId,schema:g.schema,table:g.table}).then(function(r){g.total=r.count;$("stRows").textContent=r.count+" total";}).catch(function(){});}
function dataSortToggle(tab,field){var g=tab.state.g;if(g.orderBy===field)g.orderDir=g.orderDir==="asc"?"desc":"asc";else{g.orderBy=field;g.orderDir="asc";}g.offset=0;loadData(tab);}
function renderGrid(tab){var g=tab.state.g;var box=clear(g.grid);if(!g.rows.length&&!g.inserts.length){box.appendChild(el("div",{class:"empty",text:"No rows."}));return;}
  var fields=g.columns.length?g.columns.map(function(c){return c.name;}):(g.rows[0]?Object.keys(g.rows[0]):[]);g.fields=fields;
  var table=el("table",{class:"grid"});var thead=el("thead");var htr=el("tr");htr.appendChild(el("th",{class:"rowhdr",text:"#"}));fields.forEach(function(f){var arrow=g.orderBy===f?(g.orderDir==="desc"?" \\u25BC":" \\u25B2"):"";var th=el("th",{title:"Click to sort",text:f+arrow});th.addEventListener("click",function(){dataSortToggle(tab,f);});htr.appendChild(th);});thead.appendChild(htr);table.appendChild(thead);
  var tbody=el("tbody");
  g.rows.forEach(function(row,ri){var key=rowKeyOf(g,row);var deleted=!!g.deletes[key];var edited=g.edits[key];var err=g.errors[key];var tr=el("tr",{class:(g.sel[key]?"selrow ":"")+(deleted?"row-del ":"")+(err?"row-err ":""),"data-ri":ri});
    tr.addEventListener("contextmenu",function(e){e.preventDefault();rowContextMenu(e,tab,row);});
    var flag=edited?'<span class="rowflag d"></span>':(deleted?'<span class="rowflag del"></span>':"");
    var num=el("td",{class:"rowhdr",html:flag+(g.offset+ri+1),title:err||""});num.addEventListener("click",function(e){if(!(e.ctrlKey||e.metaKey||e.shiftKey))g.sel={};if(g.sel[key])delete g.sel[key];else g.sel[key]=true;renderGrid(tab);});tr.appendChild(num);
    fields.forEach(function(f){var hasEdit=edited&&Object.prototype.hasOwnProperty.call(edited,f);var v=hasEdit?edited[f]:row[f];var disp=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);var td=el("td",{class:(typeof v==="number"?"num ":"")+(hasEdit?"edited":""),title:disp,text:disp.length>400?disp.slice(0,400)+"\\u2026":disp});if(g.editable&&!deleted){td.addEventListener("dblclick",function(){startEdit(tab,td,ri,f,row);});}else{td.addEventListener("dblclick",function(){openCellViewer(v);});}tr.appendChild(td);});
    if(err){tr.title=err;}
    tbody.appendChild(tr);});
  g.inserts.forEach(function(ins){var tr=el("tr",{class:"row-ins"});tr.appendChild(el("td",{class:"rowhdr",html:'<span class="rowflag ins"></span>'+"new",onclick:function(){g.inserts=g.inserts.filter(function(x){return x!==ins;});updateDirtyButtons(tab);renderGrid(tab);}}));
    fields.forEach(function(f){var inp=el("input",{class:"cellinput",value:ins.values[f]!=null?ins.values[f]:""});inp.addEventListener("input",function(){if(inp.value==="")delete ins.values[f];else ins.values[f]=inp.value;});var td=el("td");td.appendChild(inp);tr.appendChild(td);});
    if(ins.error){tr.classList.add("row-err");tr.title=ins.error;}
    tbody.appendChild(tr);});
  table.appendChild(tbody);box.appendChild(table);
  updateDirtyButtons(tab);
}
function startEdit(tab,td,ri,field,row){if(td.querySelector("input"))return;var g=tab.state.g;var colIdx=g.fields?g.fields.indexOf(field):-1;var key=rowKeyOf(g,row);var cur=g.edits[key]&&Object.prototype.hasOwnProperty.call(g.edits[key],field)?g.edits[key][field]:row[field];var input=el("input",{class:"cellinput"});input.value=cur==null?"":typeof cur==="object"?JSON.stringify(cur):String(cur);clear(td).appendChild(input);input.focus();input.select();var done=false;function commit(){if(done)return true;done=true;var origStr=row[field]==null?"":String(row[field]);if(input.value!==origStr){gridPushUndo(tab);g.edits[key]=g.edits[key]||{};g.edits[key][field]=input.value;}else if(g.edits[key]){delete g.edits[key][field];if(!Object.keys(g.edits[key]).length)delete g.edits[key];}return true;}
  input.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();commit();renderGrid(tab);editAt(tab,ri+1,colIdx);}else if(e.key==="Tab"){e.preventDefault();commit();renderGrid(tab);editAt(tab,ri,colIdx+1);}else if(e.key==="Escape"){e.preventDefault();done=true;renderGrid(tab);}});
  input.addEventListener("blur",function(){if(!done){commit();renderGrid(tab);}});}
function toastAction(msg,actionLabel,onAction){var t=el("div",{class:"toast"});t.appendChild(el("span",{text:msg+" "}));t.appendChild(el("a",{class:"link",text:actionLabel,onclick:function(){onAction();t.remove();}}));$("toasts").appendChild(t);setTimeout(function(){t.style.opacity="0";setTimeout(function(){t.remove();},250);},6000);}
function toggleDeleteSelected(tab){var g=tab.state.g;if(!g.editable)return logMsg("Cannot delete: table has no primary key.","warn");var keys=selectedKeys(g);if(!keys.length)return logMsg("Select one or more rows (click the row number).","warn");
  if(keys.every(function(k){return g.deletes[k];})){gridPushUndo(tab);keys.forEach(function(k){delete g.deletes[k];});renderGrid(tab);return;}
  var mark=function(){gridPushUndo(tab);keys.forEach(function(k){g.deletes[k]=true;});g.sel={};renderGrid(tab);toastAction(keys.length+" row"+(keys.length>1?"s":"")+" marked for delete. They are removed only when you Save Changes.","Undo",function(){gridUndo(tab);});};
  if(keys.length>1){if(confirm("Mark "+keys.length+" selected rows for deletion?\\nThey will not be deleted until you click Save Changes."))mark();}else mark();}
function addInsertRow(tab){var g=tab.state.g;gridPushUndo(tab);g.inserts.push({iseq:++g.iseq,values:{}});renderGrid(tab);}
function revertAll(tab){var g=tab.state.g;g.edits={};g.deletes={};g.inserts=[];g.errors={};renderGrid(tab);logMsg("Reverted pending changes.","ok");}
function updateDirtyButtons(tab){var g=tab.state.g;var nu=Object.keys(g.edits).length,nd=Object.keys(g.deletes).length,ni=g.inserts.length;var n=nu+nd+ni;if(g.saveBtn)g.saveBtn.style.display=n>0?"":"none";if(g.revertBtn)g.revertBtn.style.display=n>0?"":"none";setDirty(tab,n>0);if(g.changeBar){if(n>0){g.changeBar.classList.remove("hidden");clear(g.changeBar);g.changeBar.appendChild(el("span",{},["Pending: ",el("span",{class:"cnt-u",text:nu+" edit"+(nu===1?"":"s")})," · ",el("span",{class:"cnt-i",text:ni+" insert"+(ni===1?"":"s")})," · ",el("span",{class:"cnt-d",text:nd+" delete"+(nd===1?"":"s")})]));g.changeBar.appendChild(el("span",{style:"flex:1"}));g.changeBar.appendChild(el("button",{class:"btn sm",title:"Ctrl+S",text:"Save",onclick:function(){saveDataChanges(tab);}}));g.changeBar.appendChild(el("button",{class:"btn sm ghost",title:"Revert all (Ctrl+Z to undo)",text:"Revert",onclick:function(){revertAll(tab);}}));g.changeBar.appendChild(el("button",{class:"btn sm ghost",text:"Show changes",onclick:function(){showChanges(tab);}}));}else g.changeBar.classList.add("hidden");}}
function gridFields(g){return g.columns.length?g.columns.map(function(c){return c.name;}):(g.rows[0]?Object.keys(g.rows[0]):[]);}
function exportFilename(g,fmt,suffix){var conn=(activeConn()||{}).name||"db";var stamp=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);return (conn+"_"+g.schema+"_"+g.table+(suffix?"_"+suffix:"")+"_"+stamp+"."+fmt).replace(/[^a-z0-9._-]+/gi,"-");}
function exportRowsToFile(fields,rows,fmt,filename){return fetch(fmt==="csv"?"/api/export/csv":"/api/export/json",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fields:fields,rows:rows})}).then(function(r){return r.blob();}).then(function(b){var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=filename;a.click();});}
function exportCurrentPage(tab,fmt){var g=tab.state.g;if(!g.rows.length)return logMsg("No rows to export.","warn");logMsg("Preparing export…","ok");exportRowsToFile(gridFields(g),g.rows,fmt,exportFilename(g,fmt,"page")).then(function(){logMsg("Exported current page as "+fmt.toUpperCase(),"ok");});}
function exportSelected(tab,fmt){var g=tab.state.g;var rows=g.rows.filter(function(r){return g.sel[rowKeyOf(g,r)];});if(!rows.length)return logMsg("Select rows first (click row numbers).","warn");exportRowsToFile(gridFields(g),rows,fmt,exportFilename(g,fmt,"selected")).then(function(){logMsg("Exported "+rows.length+" selected row(s) as "+fmt.toUpperCase(),"ok");});}
function exportViaApi(tab,source,fmt,extra){var g=tab.state.g;logMsg("Preparing export…","ok");var body={connectionId:S.activeConnId,schema:g.schema,objectName:g.table,objectType:"table",source:source,format:fmt,whereClause:g.where,limit:g.pageSize,offset:g.offset,sort:g.orderBy?[{column:g.orderBy,direction:g.orderDir}]:[]};if(extra)for(var k in extra)body[k]=extra[k];return fetch("/api/export/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t||("HTTP "+r.status));});return r.blob();}).then(function(b){var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=exportFilename(g,fmt,source);a.click();logMsg("Export completed ("+fmt.toUpperCase()+")","ok");}).catch(function(e){logMsg("Export failed: "+e.message,"err");});}
function openExportMenu(tab,anchor){var r=anchor.getBoundingClientRect();showCtx(r.left,r.bottom+4,[
  {label:"Current page · CSV",icon:"imp",onClick:function(){exportCurrentPage(tab,"csv");}},
  {label:"Current page · JSON",icon:"imp",onClick:function(){exportCurrentPage(tab,"json");}},
  {sep:true},
  {label:"Current query/filter · CSV",icon:"imp",onClick:function(){exportViaApi(tab,"current-query","csv");}},
  {label:"Current query/filter · JSON",icon:"imp",onClick:function(){exportViaApi(tab,"current-query","json");}},
  {sep:true},
  {label:"Selected rows · CSV",icon:"imp",onClick:function(){exportSelected(tab,"csv");}},
  {label:"Selected rows · JSON",icon:"imp",onClick:function(){exportSelected(tab,"json");}},
  {sep:true},
  {label:"Export custom…",icon:"gear",onClick:function(){exportCustomModal(tab);}}
]);}
function exportCustomModal(tab){var g=tab.state.g;var cols=gridFields(g);
  var src=el("select",{class:"select"});[["current-page","Current page"],["current-query","Current query/filter"],["selected-rows","Selected rows"],["whole-table","Whole table (can be large)"]].forEach(function(o){src.appendChild(el("option",{value:o[0],text:o[1]}));});
  var fmt=el("select",{class:"select"});[["csv","CSV"],["json","JSON"]].forEach(function(f){fmt.appendChild(el("option",{value:f[0],text:f[1]}));});
  var checks={};var list=el("div",{class:"fieldlist"});cols.forEach(function(c){var cb=el("input",{type:"checkbox"});cb.checked=true;checks[c]=cb;list.appendChild(el("label",{},[cb,c]));});
  var warn=el("div",{class:"note"});src.addEventListener("change",function(){warn.textContent=src.value==="whole-table"?"Whole-table export can be large and may take a while.":"";});
  var d=el("div",{class:"dialog"},[el("h3",{text:"Export data"}),
    el("div",{class:"field"},[el("label",{text:"Source"}),src]),warn,
    el("div",{class:"field"},[el("label",{text:"Columns"}),list]),
    el("div",{class:"field"},[el("label",{text:"Format"}),fmt]),
    el("div",{class:"row right"},[el("button",{class:"btn ghost",text:"Cancel",onclick:closeModal}),el("button",{class:"btn",text:"Export",onclick:function(){
      var selectedColumns=cols.filter(function(c){return checks[c].checked;});if(!selectedColumns.length)return logMsg("Select at least one column.","warn");
      var source=src.value,format=fmt.value;
      if(source==="whole-table"&&!confirm("Export the whole table? This can be large."))return;
      closeModal();
      if(source==="current-page"){exportRowsToFile(selectedColumns,g.rows,format,exportFilename(g,format,"page")).then(function(){logMsg("Exported.","ok");});}
      else if(source==="selected-rows"){var rows=g.rows.filter(function(r){return g.sel[rowKeyOf(g,r)];});if(!rows.length)return logMsg("No rows selected.","warn");exportRowsToFile(selectedColumns,rows,format,exportFilename(g,format,"selected")).then(function(){logMsg("Exported.","ok");});}
      else{exportViaApi(tab,source,format,{selectedColumns:selectedColumns});}
    }})])]);
  openModal(d);}
function rowContextMenu(e,tab,row){var g=tab.state.g;showCtx(e.clientX,e.clientY,[
  {label:"View row details",icon:"viw",onClick:function(){openCellViewer(row);}},
  {label:"Copy row as JSON",icon:"col",onClick:function(){navigator.clipboard.writeText(JSON.stringify(row,null,2));logMsg("Copied row JSON","ok");}},
  {label:"Copy INSERT statement",icon:"sql",onClick:function(){copyRowDml(g,row,"insert");}},
  {label:"Copy UPDATE statement",icon:"sql",onClick:function(){copyRowDml(g,row,"update");}}
]);}
function copyRowDml(g,row,kind){var fields=gridFields(g);var qn='"'+g.schema+'"."'+g.table+'"';function lit(v){return v==null?"NULL":typeof v==="number"?String(v):"'"+String(v).replace(/'/g,"''")+"'";}
  var sql;if(kind==="insert"){sql="INSERT INTO "+qn+" ("+fields.map(function(f){return '"'+f+'"';}).join(", ")+")\\nVALUES ("+fields.map(function(f){return lit(row[f]);}).join(", ")+");";}
  else{var setp=fields.filter(function(f){return g.pk.indexOf(f)<0;}).map(function(f){return '"'+f+'" = '+lit(row[f]);}).join(",\\n  ");var wherep=(g.pk.length?g.pk:fields).map(function(f){return '"'+f+'" = '+lit(row[f]);}).join("\\n  AND ");sql="UPDATE "+qn+"\\nSET\\n  "+setp+"\\nWHERE\\n  "+wherep+";";}
  navigator.clipboard.writeText(sql);logMsg("Copied "+kind.toUpperCase()+" statement","ok");}
function saveDataChanges(tab){var g=tab.state.g;if(S.readOnly)return logMsg("Read-only mode is on.","warn");
  var updates=Object.keys(g.edits).map(function(key){var row=g.rows.filter(function(r){return rowKeyOf(g,r)===key;})[0];var keyObj={};g.pk.forEach(function(k){keyObj[k]=row[k];});return {key:keyObj,changes:g.edits[key]};});
  var deletes=Object.keys(g.deletes).map(function(key){var row=g.rows.filter(function(r){return rowKeyOf(g,r)===key;})[0];var keyObj={};g.pk.forEach(function(k){keyObj[k]=row[k];});return {key:keyObj,_k:key};});
  var inserts=g.inserts.filter(function(i){return Object.keys(i.values).length;}).map(function(i){return {values:i.values,_ref:i};});
  var total=updates.length+deletes.length+inserts.length;if(!total)return logMsg("No changes to save.","warn");
  if(!confirm("Save changes?\\n\\nUpdates: "+updates.length+"\\nInserts: "+inserts.length+"\\nDeletes: "+deletes.length))return;
  setConnStatus("Saving changes...","run");
  api("POST","/api/table/save-changes",{connectionId:S.activeConnId,schema:g.schema,table:g.table,primaryKeyColumns:g.pk,updates:updates.map(function(u){return {key:u.key,changes:u.changes};}),inserts:inserts.map(function(i){return {values:i.values};}),deletes:deletes.map(function(d){return {key:d.key};}),readOnly:S.readOnly}).then(function(resp){setConnStatus("Connected","ok");
    if(resp.blocked){logMsg(resp.error||"Blocked by read-only.","err");return;}
    var rr=resp.result.rowResults||[];var ui=0;
    // updates first, then inserts, then deletes (server order)
    var failedU=0,failedI=0,failedD=0;
    updates.forEach(function(u){var res=rr[ui++];if(res&&res.success){delete g.edits[rowKeyOf(g,g.rows.filter(function(r){return JSON.stringify(pkObj(g,r))===JSON.stringify(u.key);})[0]||{})];}else{failedU++;var k=rowKeyFromKeyObj(g,u.key);g.errors[k]=res?res.error:"failed";}});
    inserts.forEach(function(i){var res=rr[ui++];if(res&&res.success){g.inserts=g.inserts.filter(function(x){return x!==i._ref;});}else{i._ref.error=res?res.error:"failed";failedI++;}});
    deletes.forEach(function(d){var res=rr[ui++];if(res&&res.success){delete g.deletes[d._k];}else{g.errors[d._k]=res?res.error:"failed";failedD++;}});
    var ok=resp.result.updated+resp.result.inserted+resp.result.deleted;var fail=failedU+failedI+failedD;
    if(fail===0){logMsg(ok+" change(s) saved.","ok");loadData(tab);loadCount(tab);}
    else{logMsg(ok+" saved, "+fail+" failed. Failed rows kept pending with error markers.","err");renderGrid(tab);}
    updateDirtyButtons(tab);
  }).catch(function(e){setConnStatus("Connected","ok");logMsg("Save failed: "+e.message,"err");});
}
function pkObj(g,row){var o={};g.pk.forEach(function(k){o[k]=row[k];});return o;}
function rowKeyFromKeyObj(g,keyObj){return g.pk.map(function(k){return String(keyObj[k]);}).join("\\u0001");}

/* ====================================================================
   STRUCTURE / METADATA TAB
   ==================================================================== */
function openStructureTab(schema,table){return openTab({key:"struct:"+S.activeConnId+":"+schema+"."+table,kind:"structure",title:"Structure: "+table,icon:"col",connectionId:S.activeConnId,meta:{schema:schema,table:table,objectType:"table"},build:function(pane,tab){tab.connectionId=S.activeConnId;buildStructure(pane,tab,schema,table);}});}
function buildStructure(pane,tab,schema,table){
  var subtabs=el("div",{class:"meta-tabs"});var body=el("div",{class:"pane-body"});
  var defs=[["columns","Columns"],["indexes","Indexes"],["ddl","DDL"],["info","Info"]];
  var active="columns";var data={};
  function render(){clear(body);if(active==="columns")renderCols();else if(active==="indexes")renderIdx();else if(active==="ddl")renderDdl();else renderInfo();Array.prototype.forEach.call(subtabs.children,function(ch,i){ch.classList.toggle("active",defs[i][0]===active);});}
  defs.forEach(function(d){subtabs.appendChild(el("div",{class:"meta-tab",text:d[1],onclick:function(){active=d[0];render();}}));});
  pane.appendChild(crumbs((activeConn()||{}).name,schema,table));
  pane.appendChild(el("div",{class:"toolbar"},[el("b",{text:'"'+schema+'"."'+table+'"'}),el("span",{class:"grow"}),el("button",{class:"btn sec",text:"Open Data",onclick:function(){openDataTab(schema,table);}})]));
  pane.appendChild(subtabs);pane.appendChild(body);
  function renderCols(){body.appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," loading..."]));api("GET","/api/catalog/columns?"+qstr({connectionId:S.activeConnId,schema:schema,table:table})).then(function(r){data.columns=r.columns||[];if(active!=="columns")return;clear(body);var t=el("table",{class:"grid"});t.appendChild(el("thead",{html:"<tr><th>Name</th><th>Type</th><th>Length</th><th>Scale</th><th>Nullable</th><th>Key</th><th>Default</th><th>Comment</th></tr>"}));var tb=el("tbody");data.columns.forEach(function(c){tb.appendChild(el("tr",{html:"<td>"+esc(c.name)+"</td><td>"+esc(c.dataType)+'</td><td class="num">'+esc(c.length==null?"":c.length)+'</td><td class="num">'+esc(c.scale==null?"":c.scale)+"</td><td>"+(c.nullable?"YES":"NO")+"</td><td>"+(c.isPrimaryKey?'<span class="pill pk">PK</span>':"")+"</td><td>"+esc(c.defaultValue==null?"":c.defaultValue)+"</td><td>"+esc(c.comment==null?"":c.comment)+"</td>"}));});t.appendChild(tb);clear(body).appendChild(t);}).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});}
  function renderIdx(){body.appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," loading..."]));api("GET","/api/catalog/constraints?"+qstr({connectionId:S.activeConnId,schema:schema,table:table})).then(function(r){if(active!=="indexes")return;clear(body);var pk=r.primaryKey&&r.primaryKey.columns||[];body.appendChild(el("div",{class:"kvs"},[el("div",{class:"k",text:"Primary key"}),el("div",{text:pk.length?pk.join(", "):"(none)"})]));var idx=r.indexes||[];if(!idx.length){body.appendChild(el("div",{class:"empty",text:"No indexes."}));return;}var t=el("table",{class:"grid"});t.appendChild(el("thead",{html:"<tr><th>Index</th><th>Columns</th><th>Unique</th><th>Primary</th></tr>"}));var tb=el("tbody");idx.forEach(function(i){tb.appendChild(el("tr",{html:"<td>"+esc(i.name)+"</td><td>"+esc((i.columns||[]).join(", "))+"</td><td>"+(i.isUnique?"YES":"NO")+"</td><td>"+(i.isPrimaryKey?"YES":"NO")+"</td>"}));});t.appendChild(tb);body.appendChild(t);}).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});}
  function renderDdl(){body.appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," generating..."]));api("GET","/api/catalog/ddl?"+qstr({connectionId:S.activeConnId,schema:schema,table:table})).then(function(r){if(active!=="ddl")return;clear(body);var ta=el("textarea",{class:"editor",readonly:"readonly"});ta.value=r.ddl;body.appendChild(el("div",{class:"row"},[el("button",{class:"btn sec",text:"Open in SQL Console",onclick:function(){openSqlTab(r.ddl,table);}}),el("button",{class:"btn ghost",text:"Copy",onclick:function(){navigator.clipboard.writeText(r.ddl);logMsg("Copied DDL","ok");}})]));body.appendChild(ta);}).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});}
  function renderInfo(){body.appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," loading..."]));api("POST","/api/table/count",{connectionId:S.activeConnId,schema:schema,table:table}).then(function(r){if(active!=="info")return;clear(body).appendChild(el("div",{class:"kvs"},[el("div",{class:"k",text:"Schema"}),el("div",{text:schema}),el("div",{class:"k",text:"Object"}),el("div",{text:table}),el("div",{class:"k",text:"Row count"}),el("div",{text:String(r.count)}),el("div",{class:"k",text:"Columns"}),el("div",{text:String((data.columns||[]).length)})]));}).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});}
  render();
}

/* ====================================================================
   SAVED QUERIES
   ==================================================================== */
function loadSavedQueries(){return api("GET","/api/queries").then(function(r){S.savedQueries=r.queries||[];renderSavedQueries();}).catch(function(){});}
function renderSavedQueries(){var raw=($("querySearch").value||"");var q=raw.toLowerCase();var box=clear($("queryList"));var rows=S.savedQueries.filter(function(x){return (x.name+" "+(x.tags||[]).join(" ")).toLowerCase().indexOf(q)>=0;});if(!rows.length){box.appendChild(el("div",{class:"empty",text:S.savedQueries.length?"No results found":"No saved queries."}));return;}rows.forEach(function(x){var item=el("div",{class:"wli",onclick:function(){openSqlTab(x.sql,x.name,x.id);},oncontextmenu:function(e){e.preventDefault();queryMenu(e,x);}});item.appendChild(el("b",{html:highlightMatch(x.name,raw)}));item.appendChild(el("div",{class:"note",text:(x.connectionType||"")+" \\u00b7 "+new Date(x.updatedAt).toLocaleDateString()}));box.appendChild(item);});}
function queryMenu(e,x){showCtx(e.clientX,e.clientY,[{label:"Open",icon:"sql",onClick:function(){openSqlTab(x.sql,x.name);}},{label:"Rename",icon:"gear",onClick:function(){var n=prompt("New name",x.name);if(n)api("PUT","/api/queries/"+encodeURIComponent(x.id),{name:n}).then(loadSavedQueries);}},{label:"Delete",icon:"x",danger:true,onClick:function(){if(confirm("Delete '"+x.name+"'?"))api("DELETE","/api/queries/"+encodeURIComponent(x.id)).then(loadSavedQueries);}}]);}

/* ====================================================================
   DIRECT CONNECTION MODAL
   ==================================================================== */
function newConnModal(){var typeSel=el("select",{class:"select"});typeSel.appendChild(el("option",{value:"postgresql",text:"PostgreSQL"}));typeSel.appendChild(el("option",{value:"hana",text:"SAP HANA"}));
  var f={name:el("input",{class:"input"}),host:el("input",{class:"input"}),port:el("input",{class:"input",value:"5432"}),database:el("input",{class:"input"}),schema:el("input",{class:"input",value:"public"}),user:el("input",{class:"input"}),pass:el("input",{class:"input",type:"password"}),ssl:el("input",{type:"checkbox"})};f.ssl.checked=true;
  typeSel.addEventListener("change",function(){f.port.value=typeSel.value==="hana"?"443":"5432";f.schema.value=typeSel.value==="hana"?"":"public";});
  var msg=el("div",{class:"note"});
  function body(){return {name:f.name.value.trim(),type:typeSel.value,host:f.host.value.trim(),port:parseInt(f.port.value,10)||(typeSel.value==="hana"?443:5432),database:f.database.value.trim(),schema:f.schema.value.trim(),username:f.user.value.trim(),password:f.pass.value,ssl:f.ssl.checked};}
  var d=el("div",{class:"dialog"},[el("h3",{text:"New direct connection"}),el("div",{class:"field"},[el("label",{text:"Name"}),f.name]),el("div",{class:"field"},[el("label",{text:"Type"}),typeSel]),el("div",{class:"row"},[el("div",{class:"field",style:"flex:1"},[el("label",{text:"Host"}),f.host]),el("div",{class:"field",style:"width:110px"},[el("label",{text:"Port"}),f.port])]),el("div",{class:"row"},[el("div",{class:"field",style:"flex:1"},[el("label",{text:"Database"}),f.database]),el("div",{class:"field",style:"flex:1"},[el("label",{text:"Schema"}),f.schema])]),el("div",{class:"row"},[el("div",{class:"field",style:"flex:1"},[el("label",{text:"Username"}),f.user]),el("div",{class:"field",style:"flex:1"},[el("label",{text:"Password"}),f.pass])]),el("label",{class:"note"},[f.ssl," Use SSL"]),el("div",{class:"row right"},[el("button",{class:"btn ghost",text:"Cancel",onclick:closeModal}),el("button",{class:"btn sec",text:"Test",onclick:function(){msg.textContent="Testing...";api("POST","/api/connections/test-draft",body()).then(function(r){msg.textContent=r.success?("OK "+(r.serverVersion||"")):("Failed: "+r.message);});}}),el("button",{class:"btn",text:"Save & use",onclick:function(){var b=body();if(!b.name||!b.host||!b.username)return msg.textContent="Name, host, username required.";api("POST","/api/connections/create",b).then(function(r){closeModal();return loadConnections().then(function(){activateConnection(r.connection.id);});}).catch(function(e){msg.textContent=e.message;});}})]),msg]);openModal(d);}

/* ====================================================================
   BTP IMPORT WIZARD
   ==================================================================== */
/* ====================================================================
   BTP TARGET EXPLORER WIZARD (multi-target, cache-first)
   ==================================================================== */
function cacheBadge(status,ago){
  var label=status==="fresh"?"Fresh":status==="stale"?"Stale":status==="expired"?"Expired":status==="refreshing"?"Refreshing":"—";
  var spinning=status==="refreshing";
  var b=el("span",{class:"cbadge "+(status||"missing")});
  if(spinning)b.appendChild(el("span",{class:"spin",text:"⟳"}));
  b.appendChild(el("span",{text:" "+label+(ago?" · "+ago:"")}));
  return b;
}
function openBtpWizard(){
  var st={targetKey:"",targetLabel:"",app:"",svc:null,color:"",targets:{favorites:[],recent:[],byRegion:{},regions:[],totalTargets:0},unsubSse:null};
  var steps=el("div",{class:"steps"});
  ["Target","App","Database","Save"].forEach(function(s){steps.appendChild(el("div",{class:"step",text:s}));});
  function setStep(i){Array.prototype.forEach.call(steps.children,function(ch,idx){ch.className="step"+(idx===i?" active":idx<i?" done":"");});}
  var body=el("div",{style:"min-height:320px"});
  var msg=el("div",{class:"note",style:"margin-top:8px"});

  /* ---- helper: highlight query in text ---- */
  function hl(text,q){return q?highlightMatch(text,q):esc(text);}

  /* ---- Step 1: Target Explorer ---- */
  function stepTarget(){
    setStep(0);
    clear(body).appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," loading targets..."]));
    api("GET","/api/btp/targets").then(function(r){
      st.targets=r;
      renderTargetStep(r,"");
    }).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});
  }

  function renderTargetStep(r,q){
    clear(body);
    var search=el("input",{class:"input",placeholder:"Search org / space / region...",value:q});
    body.appendChild(el("div",{class:"field",style:"margin-bottom:6px"},[search]));
    // Status line: cached count + age + per-region refresh progress.
    var refreshingRegions=(r.regionStatus||[]).filter(function(x){return x.refreshState==="refreshing";}).length;
    var statusTxt="Cached "+(r.totalTargets||0)+" targets";
    if(r.lastUpdatedAgo)statusTxt+=" · updated "+r.lastUpdatedAgo;
    if(refreshingRegions)statusTxt+=" · refreshing "+refreshingRegions+"/"+(r.regionStatus||[]).length+" regions...";
    body.appendChild(el("div",{class:"note",style:"margin-bottom:8px"},[el("span",{text:statusTxt})]));
    var lowerQ=(q||"").toLowerCase();
    var scroll=el("div",{class:"wiz-body",style:"max-height:340px;overflow:auto"});

    function mkTrow(t){
      var key=t.key;var isFav=t.isFavorite;
      var envLabel=t.environment?el("span",{class:"ci-env "+t.environment,text:t.environment}):null;
      var row=el("div",{class:"trow"+(st.targetKey===key?" active":"")});
      var icon=el("div",{class:"trow-icon",text:isFav?"★":"○"});
      var main=el("div",{class:"trow-main"});
      var title=el("div",{class:"trow-title"});
      title.innerHTML=hl(t.org+(t.space?(" / "+t.space):""),lowerQ);
      var meta=el("div",{class:"trow-meta",text:t.region+(t.cachedAppCount!=null?" · "+t.cachedAppCount+" apps":"")});
      main.appendChild(title);main.appendChild(meta);
      var right=el("div",{class:"trow-right"});
      if(t.cacheStatus&&t.cacheStatus!=="missing")right.appendChild(cacheBadge(t.cacheStatus,t.updatedAgo));
      if(envLabel)right.appendChild(envLabel);
      var favBtn=el("span",{class:"trow-fav"+(isFav?" on":""),title:isFav?"Remove favorite":"Add favorite",text:"★"});
      favBtn.addEventListener("click",function(e){e.stopPropagation();api("POST","/api/btp/favorite",{targetKey:key,add:!isFav}).then(function(){return api("GET","/api/btp/targets");}).then(function(nr){st.targets=nr;renderTargetStep(nr,search.value);});});
      right.appendChild(favBtn);
      row.appendChild(icon);row.appendChild(main);row.appendChild(right);
      row.addEventListener("click",function(){st.targetKey=key;st.targetLabel=t.org+(t.space?" / "+t.space:"")+" ("+t.region+")";stepApps();});
      return row;
    }

    function filterTargets(arr){
      if(!lowerQ)return arr;
      return arr.filter(function(t){return (t.org+" "+t.space+" "+t.region+" "+(t.environment||"")).toLowerCase().indexOf(lowerQ)>=0;});
    }

    function addSection(title,items){
      if(!items.length)return;
      scroll.appendChild(el("div",{class:"wiz-section-hdr"},[el("span",{text:title}),el("span",{class:"wiz-count",text:String(items.length)})]));
      items.forEach(function(t){scroll.appendChild(mkTrow(t));});
    }

    var favs=filterTargets(r.favorites||[]);
    var recs=filterTargets(r.recent||[]).filter(function(t){return !favs.find(function(f){return f.key===t.key;});});
    var favKeys=new Set((r.favorites||[]).map(function(t){return t.key;}));
    var recentKeys=new Set((r.recent||[]).map(function(t){return t.key;}));

    addSection("★ Favorites",favs);
    addSection("◷ Recent",recs);

    // All by region (excluding already shown)
    var shownKeys=new Set(favs.concat(recs).map(function(t){return t.key;}));
    var regions=r.regions||[];
    if(regions.length){
      scroll.appendChild(el("div",{class:"wiz-section-hdr"},[el("span",{text:"All Targets"})]));
      regions.forEach(function(region){
        var items=filterTargets((r.byRegion[region]||[])).filter(function(t){return !shownKeys.has(t.key);});
        if(!items.length)return;
        var hdr=el("div",{class:"region-hdr"});
        var chev=el("span",{class:"chevron",text:"▾"});
        hdr.appendChild(el("span",{text:"🌍 "+region}));
        hdr.appendChild(el("span",{class:"wiz-count",text:String(items.length)}));
        hdr.appendChild(chev);
        var regionBody=el("div",{class:"region-body"});
        items.forEach(function(t){regionBody.appendChild(mkTrow(t));});
        hdr.addEventListener("click",function(){hdr.classList.toggle("collapsed");regionBody.style.display=hdr.classList.contains("collapsed")?"none":"";chev.textContent=hdr.classList.contains("collapsed")?"▸":"▾";});
        scroll.appendChild(hdr);
        scroll.appendChild(regionBody);
      });
    }

    if(!favs.length&&!recs.length&&!regions.length){
      scroll.appendChild(el("div",{class:"empty",text:"No cached targets found. Run: smdg cf apps"}));
    }

    body.appendChild(scroll);
    body.appendChild(el("div",{class:"row right",style:"margin-top:8px"},[
      el("button",{class:"btn ghost",text:"Cancel",onclick:closeModal}),
      el("button",{class:"btn sec",text:"⟳ Refresh all regions",title:"Scan all enabled regions in the background",onclick:function(){api("POST","/api/btp/targets/refresh",{}).then(function(){logMsg("Refreshing CF targets across regions...","ok");return api("GET","/api/btp/targets");}).then(function(nr){st.targets=nr;renderTargetStep(nr,search.value);}).catch(function(e){logMsg(e.message,"err");});}})
    ]));

    search.addEventListener("input",debounce(function(){renderTargetStep(st.targets,search.value);},200));

    // SSE: refresh target list when cache updates
    if(st.unsubSse)st.unsubSse();
    st.unsubSse=onSseEvent(function(ev){if(ev&&(ev.resource==="cf-apps"||ev.resource==="cf-cross-region-targets")){api("GET","/api/btp/targets").then(function(nr){st.targets=nr;renderTargetStep(nr,search.value);});}});
  }

  /* ---- Step 2: App Selector ---- */
  function stepApps(forceRefresh){
    if(st.unsubSse){st.unsubSse();st.unsubSse=null;}
    setStep(1);
    clear(body).appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," loading apps for "+esc(st.targetLabel)+"..."]));
    var url="/api/btp/apps?targetKey="+encodeURIComponent(st.targetKey)+(forceRefresh?"&refresh=true":"");
    api("GET",url).then(function(r){
      renderAppsStep(r,"",forceRefresh);
    }).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});
  }

  function renderAppsStep(r,q){
    clear(body);
    if(r.error&&!r.apps.length){
      body.appendChild(el("div",{class:"errbox",text:r.error}));
      body.appendChild(el("div",{class:"row right",style:"margin-top:8px"},[el("button",{class:"btn ghost",text:"◁ Back",onclick:stepTarget})]));
      return;
    }
    var breadcrumb=el("div",{class:"wiz-breadcrumb",style:"margin-bottom:8px"});
    breadcrumb.appendChild(el("span",{class:"crumb",text:"Targets",onclick:stepTarget}));
    breadcrumb.appendChild(el("span",{class:"sep",text:" › "}));
    breadcrumb.appendChild(el("span",{text:st.targetLabel}));
    body.appendChild(breadcrumb);

    if(r.cacheStatus&&r.cacheStatus!=="fresh"){
      var warn=el("div",{class:"note",style:"margin-bottom:6px"});
      warn.appendChild(cacheBadge(r.cacheStatus,r.updatedAgo));
      if(r.warning)warn.appendChild(el("span",{text:" "+r.warning,style:"margin-left:6px"}));
      body.appendChild(warn);
    }

    var apps=r.apps||[];var lowerQ=(q||"").toLowerCase();
    var search=el("input",{class:"input",placeholder:"Search apps...",value:q});
    body.appendChild(el("div",{class:"field",style:"margin-bottom:8px"},[search]));
    var scroll=el("div",{class:"wiz-body",style:"max-height:340px;overflow:auto"});

    function drawApps(){
      clear(scroll);var qv=(search.value||"").toLowerCase();
      var filtered=apps.filter(function(a){return (a.name||"").toLowerCase().indexOf(qv)>=0||(a.routes||"").toLowerCase().indexOf(qv)>=0;});
      if(!filtered.length){scroll.appendChild(el("div",{class:"empty",text:apps.length?"No results":"No apps found for this target"}));return;}
      filtered.forEach(function(a){
        var running=(a.requestedState||a.state||"").toLowerCase()==="started";
        var row=el("div",{class:"arow",onclick:function(){st.app=a.name;stepServices();}});
        var main=el("div",{class:"arow-main"});
        var nameDiv=el("div",{class:"arow-name"});nameDiv.innerHTML=hl(a.name,qv);
        var meta=el("div",{class:"arow-meta",text:(a.routes||"")+(a.buildpacks?" · "+a.buildpacks:"")});
        main.appendChild(nameDiv);main.appendChild(meta);
        var state=el("span",{class:"arow-state "+(running?"started":"stopped"),text:running?"● Running":"○ Stopped"});
        row.appendChild(main);row.appendChild(state);
        scroll.appendChild(row);
      });
    }
    search.addEventListener("input",debounce(drawApps,200));
    body.appendChild(scroll);
    body.appendChild(el("div",{class:"row right",style:"margin-top:8px"},[
      el("button",{class:"btn ghost",text:"◁ Back",onclick:stepTarget}),
      el("button",{class:"btn sec",text:"⟳ Refresh",onclick:function(){stepApps(true);}})
    ]));
    drawApps();
  }

  /* ---- Step 3: DB Services ---- */
  function stepServices(){
    setStep(2);
    clear(body).appendChild(el("div",{class:"empty"},[el("span",{class:"spin"})," reading CF env for "+esc(st.app)+"..."]));
    var url="/api/btp/db-candidates?targetKey="+encodeURIComponent(st.targetKey)+"&appName="+encodeURIComponent(st.app);
    api("GET",url).then(function(r){
      clear(body);
      var breadcrumb=el("div",{class:"wiz-breadcrumb",style:"margin-bottom:8px"});
      breadcrumb.appendChild(el("span",{class:"crumb",text:"Targets",onclick:stepTarget}));
      breadcrumb.appendChild(el("span",{class:"sep",text:" › "}));
      breadcrumb.appendChild(el("span",{class:"crumb",text:st.targetLabel,onclick:function(){stepApps();}}));
      breadcrumb.appendChild(el("span",{class:"sep",text:" › "}));
      breadcrumb.appendChild(el("span",{text:st.app}));
      body.appendChild(breadcrumb);
      var svcs=r.candidates||[];
      if(!svcs.length){
        body.appendChild(el("div",{class:"errbox",text:r.error||"No HANA/PostgreSQL service detected in "+st.app+". The app may not be running on the current CF target."}));
        body.appendChild(el("div",{class:"row right",style:"margin-top:8px"},[el("button",{class:"btn ghost",text:"◁ Back",onclick:function(){stepApps();}})]));
        return;
      }
      var list=el("div",{class:"wiz-body",style:"max-height:280px;overflow:auto"});
      svcs.forEach(function(svc){
        list.appendChild(el("div",{class:"arow",onclick:function(){st.svc=svc;stepSave();}},[
          el("div",{class:"arow-main"},[
            el("div",{class:"arow-name",text:svc.serviceName||svc.service||"Unnamed service"}),
            el("div",{class:"arow-meta",text:svc.type+" · "+svc.host+" · "+(svc.schema||svc.database||"")})
          ])
        ]));
      });
      body.appendChild(list);
      body.appendChild(el("div",{class:"row right",style:"margin-top:8px"},[
        el("button",{class:"btn ghost",text:"◁ Back",onclick:function(){stepApps();}})
      ]));
    }).catch(function(e){clear(body).appendChild(el("div",{class:"errbox",text:e.message}));});
  }

  /* ---- Step 4: Save ---- */
  function stepSave(){
    setStep(3);clear(body);
    var svc=st.svc;
    var nameI=el("input",{class:"input",value:(st.app+" / "+svc.serviceName)});
    var envSel=el("select",{class:"select"});
    ["","DEV","QAS","PROD","SANDBOX","CUSTOM"].forEach(function(en){envSel.appendChild(el("option",{value:en,text:en||"(none)"}));});
    var sel={color:""};var sw=el("div",{class:"swatches"});
    SWATCHES.forEach(function(col){var s=el("div",{class:"swatch",style:"background:"+col,onclick:function(){sel.color=col;Array.prototype.forEach.call(sw.children,function(x){x.classList.remove("sel");});s.classList.add("sel");}});sw.appendChild(s);});
    var fav=el("input",{type:"checkbox"});
    body.appendChild(el("div",{class:"kvs"},[
      el("div",{class:"k",text:"Service"}),el("div",{text:svc.serviceName||""}),
      el("div",{class:"k",text:"Type"}),el("div",{text:svc.type||""}),
      el("div",{class:"k",text:"Host"}),el("div",{text:svc.host||""})
    ]));
    body.appendChild(el("div",{class:"field"},[el("label",{text:"Display name"}),nameI]));
    body.appendChild(el("div",{class:"field"},[el("label",{text:"Environment"}),envSel]));
    body.appendChild(el("div",{class:"field"},[el("label",{text:"Color"}),sw]));
    body.appendChild(el("label",{class:"note"},[fav," Mark as favorite"]));
    body.appendChild(el("div",{class:"row right",style:"margin-top:12px"},[
      el("button",{class:"btn ghost",text:"◁ Back",onclick:stepServices}),
      el("button",{class:"btn",text:"Save & activate",onclick:function(){
        msg.textContent="Importing & testing...";
        api("POST","/api/connections/import-from-app",{app:st.app,serviceName:svc.serviceName,type:svc.type}).then(function(r){
          var id=r.connection.id;
          return api("POST","/api/connections/update",{id:id,name:nameI.value.trim(),environment:envSel.value,color:sel.color,isFavorite:fav.checked}).then(function(){
            return api("POST","/api/connections/test",{connectionId:id}).then(function(t){
              closeModal();
              return loadConnections().then(function(){
                activateConnection(id);
                logMsg(t.success?("Imported & connected: "+nameI.value):("Imported (test failed: "+t.message+")"),t.success?"ok":"warn");
              });
            });
          });
        }).catch(function(e){msg.textContent=e.message;});
      }})
    ]));
    body.appendChild(msg);
  }

  var d=el("div",{class:"dialog",style:"width:700px;max-width:95vw"},[el("h3",{text:"Import from BTP App"}),steps,body]);
  openModal(d);
  stepTarget();
}

/* ====================================================================
   READ-ONLY + INIT
   ==================================================================== */
/* ====================================================================
   KEYBOARD + COMMAND PALETTE + SETTINGS
   ==================================================================== */
function isTyping(t){return t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable);}
function saveActive(){var t=tabById(S.activeTabId);if(!t)return;if(t.kind==="sql")saveQueryTab(t);else if(t.kind==="data")saveDataChanges(t);else logMsg("Nothing to save in this tab.","warn");}
function onGlobalKey(e){var k=e.key;var ctrl=e.ctrlKey||e.metaKey;
  if(ctrl&&e.shiftKey&&(k==="P"||k==="p")){e.preventDefault();openCommandPalette();return;}
  if(k==="Escape"){hideCtx();closePop();if(_palette){closePalette();return;}return;}
  if(ctrl&&k==="Tab"){e.preventDefault();nextTab(e.shiftKey?-1:1);return;}
  if(ctrl&&(k==="w"||k==="W")){e.preventDefault();if(S.activeTabId)closeTab(S.activeTabId);return;}
  if(ctrl&&!e.shiftKey&&(k==="f"||k==="F")&&!isTyping(e.target)){e.preventDefault();$("topSearch").focus();return;}
  if(k==="F5"&&!isTyping(e.target)){var ft=tabById(S.activeTabId);if(ft&&ft.kind==="sql"){e.preventDefault();runMode(ft,"all");}return;}
  if(ctrl&&(k==="s"||k==="S")&&!isTyping(e.target)){e.preventDefault();saveActive();return;}
  var at=tabById(S.activeTabId);
  if(at&&at.kind==="data"&&at.state.g&&!isTyping(e.target)){var g=at.state.g;
    if(ctrl&&(k==="s"||k==="S")){e.preventDefault();saveDataChanges(at);return;}
    if(ctrl&&(k==="z"||k==="Z")){e.preventDefault();gridUndo(at);return;}
    if(ctrl&&(k==="y"||k==="Y")){e.preventDefault();gridRedo(at);return;}
    if(k==="Delete"){e.preventDefault();toggleDeleteSelected(at);return;}
  }
}
var PALETTE=[
  {label:"New SQL Console",run:function(){if(!S.activeConnId)logMsg("Select a connection first.","warn");else openSqlTab();}},
  {label:"Run SQL (current tab)",run:function(){var t=tabById(S.activeTabId);if(t&&t.kind==="sql")runMode(t,"selected");}},
  {label:"Save Query / Grid Changes",run:saveActive},
  {label:"Import from BTP App",run:function(){openBtpWizard();}},
  {label:"New direct connection",run:function(){newConnModal();}},
  {label:"Focus Connections",run:function(){$("connSearch").focus();}},
  {label:"Focus Object Explorer",run:function(){var s=document.querySelector("#secTree .tsearch input");if(s)s.focus();else $("topSearch").focus();}},
  {label:"Toggle Read-only",run:function(){toggleReadOnly();}},
  {label:"Open Active Table Structure",run:function(){var t=tabById(S.activeTabId);if(t&&t.meta&&t.meta.table)openStructureTab(t.meta.schema,t.meta.table);else logMsg("No active table.","warn");}},
  {label:"Export Result CSV",run:function(){var t=tabById(S.activeTabId);if(t&&t.kind==="sql")exportResult(t,"csv");else if(t&&t.kind==="data")exportCurrentPage(t,"csv");}},
  {label:"Close Active Tab",run:function(){if(S.activeTabId)closeTab(S.activeTabId);}},
  {label:"Show Keyboard Shortcuts",run:function(){showShortcuts();}},
  {label:"Open Settings",run:function(){openSettings();}}
];
var _palette=null;
function openCommandPalette(){closePalette();var input=el("input",{placeholder:"Type a command..."});var list=el("div",{class:"pitems"});var sel=0;var filtered=PALETTE.slice();
  function draw(){clear(list);var q=input.value.toLowerCase();filtered=PALETTE.filter(function(c){return c.label.toLowerCase().indexOf(q)>=0;});filtered.forEach(function(c,i){list.appendChild(el("div",{class:"pitem"+(i===sel?" sel":""),onclick:function(){closePalette();c.run();}},[el("span",{html:highlightMatch(c.label,input.value)})]));});}
  input.addEventListener("input",function(){sel=0;draw();});
  input.addEventListener("keydown",function(e){if(e.key==="ArrowDown"){e.preventDefault();sel=Math.min(filtered.length-1,sel+1);draw();}else if(e.key==="ArrowUp"){e.preventDefault();sel=Math.max(0,sel-1);draw();}else if(e.key==="Enter"){e.preventDefault();if(filtered[sel]){closePalette();filtered[sel].run();}}else if(e.key==="Escape"){e.preventDefault();closePalette();}});
  var ov=el("div",{class:"modal",onclick:function(e){if(e.target===ov)closePalette();}},[el("div",{class:"palette"},[input,list])]);document.body.appendChild(ov);_palette=ov;draw();input.focus();}
function closePalette(){if(_palette){_palette.remove();_palette=null;}}
function showShortcuts(){var rows=[["Ctrl+Shift+P","Command palette"],["Ctrl+Tab","Next tab"],["Ctrl+Shift+Tab","Previous tab"],["Ctrl+W","Close active tab"],["Ctrl+S","Save query / grid changes"],["Ctrl+F","Focus search"],["Escape","Close popup / clear search"],["Ctrl+Enter","Run selected / current SQL"],["F5","Run all SQL"],["Ctrl+Z / Ctrl+Y","Undo / redo (editor & grid)"],["Delete","Mark grid row for delete"],["Enter / Tab","Confirm cell edit & move"],["Esc","Cancel cell edit"]];
  var grid=el("div",{class:"shorts"});rows.forEach(function(r){grid.appendChild(el("div",{class:"srow"},[el("span",{text:r[1]}),el("span",{class:"kbd",text:r[0]})]));});
  openModal(el("div",{class:"dialog"},[el("h3",{text:"Keyboard shortcuts"}),grid,el("div",{class:"row right",style:"margin-top:14px"},[el("button",{class:"btn",text:"Close",onclick:closeModal})])]));}
function openSettings(){var s=S.settings;var restore=el("input",{type:"checkbox"});restore.checked=s.restoreWorkspace;var ro=el("input",{type:"checkbox"});ro.checked=s.readOnlyByDefault;var prod=el("input",{type:"checkbox"});prod.checked=s.showProductionWarning;var fmt=el("input",{type:"checkbox"});fmt.checked=s.autoFormatGeneratedSql;var limit=el("input",{class:"input",value:String(s.defaultRowLimit)});var schema=el("input",{class:"input",value:s.defaultSchema||""});var timeout=el("input",{class:"input",value:String(s.queryTimeoutMs)});var maxh=el("input",{class:"input",value:String(s.maxHistoryItems)});var delay=el("input",{class:"input",value:String(s.autoSaveDelayMs)});
  var d=el("div",{class:"dialog"},[el("h3",{text:"Studio settings"}),el("label",{class:"toggle"},[restore," Restore workspace on startup"]),el("label",{class:"toggle"},[ro," Read-only by default"]),el("label",{class:"toggle"},[prod," Show production warning"]),el("label",{class:"toggle"},[fmt," Auto-format generated SQL"]),el("div",{class:"field"},[el("label",{text:"Default row limit"}),limit]),el("div",{class:"field"},[el("label",{text:"Default schema"}),schema]),el("div",{class:"field"},[el("label",{text:"Query timeout (ms)"}),timeout]),el("div",{class:"field"},[el("label",{text:"Max history items"}),maxh]),el("div",{class:"field"},[el("label",{text:"Auto-save delay (ms)"}),delay]),el("div",{class:"row right"},[el("button",{class:"btn ghost",text:"Cancel",onclick:closeModal}),el("button",{class:"btn",text:"Save",onclick:function(){api("PUT","/api/studio/settings",{restoreWorkspace:restore.checked,readOnlyByDefault:ro.checked,showProductionWarning:prod.checked,autoFormatGeneratedSql:fmt.checked,defaultRowLimit:parseInt(limit.value,10)||100,defaultSchema:schema.value.trim(),queryTimeoutMs:parseInt(timeout.value,10)||30000,maxHistoryItems:parseInt(maxh.value,10)||300,autoSaveDelayMs:parseInt(delay.value,10)||500}).then(function(r){S.settings=r.settings;closeModal();logMsg("Settings saved.","ok");}).catch(function(e){logMsg(e.message,"err");});}})])]);openModal(d);}
function openCellViewer(value){var raw=value==null?"":typeof value==="object"?JSON.stringify(value):String(value);var pretty=raw;try{pretty=JSON.stringify(JSON.parse(raw),null,2);}catch(e){}var ta=el("textarea",{class:"editor",style:"min-height:300px"});ta.value=pretty;openModal(el("div",{class:"dialog",style:"width:700px"},[el("h3",{text:"Cell value"}),ta,el("div",{class:"row right",style:"margin-top:10px"},[el("button",{class:"btn ghost",text:"Copy",onclick:function(){navigator.clipboard.writeText(raw);logMsg("Copied value","ok");}}),el("button",{class:"btn",text:"Close",onclick:closeModal})])]));}
function crumbs(connName,schema,table){var c=el("div",{class:"crumbs"});c.appendChild(el("a",{text:connName||"Connection",onclick:function(){if(S.activeConnId)activateConnection(S.activeConnId);}}));c.appendChild(el("span",{class:"sep",text:"\\u203a"}));c.appendChild(el("a",{text:schema,onclick:function(){S.activeSchema=schema;updateTopBadges();}}));c.appendChild(el("span",{class:"sep",text:"\\u203a"}));c.appendChild(el("span",{text:table}));return c;}

/* ---- grid undo/redo + change review ---- */
function gridSnapshot(g){return JSON.stringify({edits:g.edits,deletes:g.deletes,inserts:g.inserts});}
function gridApplySnap(g,s){var o=JSON.parse(s);g.edits=o.edits;g.deletes=o.deletes;g.inserts=o.inserts;}
function gridPushUndo(tab){var g=tab.state.g;g.undo.push(gridSnapshot(g));if(g.undo.length>60)g.undo.shift();g.redo=[];}
function gridUndo(tab){var g=tab.state.g;if(!g.undo.length)return logMsg("Nothing to undo.","warn");g.redo.push(gridSnapshot(g));gridApplySnap(g,g.undo.pop());renderGrid(tab);}
function gridRedo(tab){var g=tab.state.g;if(!g.redo.length)return logMsg("Nothing to redo.","warn");g.undo.push(gridSnapshot(g));gridApplySnap(g,g.redo.pop());renderGrid(tab);}
function showChanges(tab){var g=tab.state.g;var out=[];Object.keys(g.edits).forEach(function(key){var row=g.rows.filter(function(r){return rowKeyOf(g,r)===key;})[0]||{};Object.keys(g.edits[key]).forEach(function(col){out.push(["update",key,col,String(row[col]==null?"":row[col]),String(g.edits[key][col])]);});});Object.keys(g.deletes).forEach(function(key){out.push(["delete",key,"","",""]);});g.inserts.forEach(function(ins){out.push(["insert","(new)",Object.keys(ins.values).join(","),"",JSON.stringify(ins.values)]);});
  var t=el("table",{class:"grid"});t.appendChild(el("thead",{html:"<tr><th>Type</th><th>Row key</th><th>Column</th><th>Old</th><th>New</th></tr>"}));var tb=el("tbody");if(!out.length)tb.appendChild(el("tr",{html:'<td colspan="5">No pending changes.</td>'}));out.forEach(function(r){tb.appendChild(el("tr",{html:r.map(function(c){return "<td>"+esc(c)+"</td>";}).join("")}));});t.appendChild(tb);
  openModal(el("div",{class:"dialog",style:"width:780px"},[el("h3",{text:"Pending changes"}),el("div",{class:"gridwrap",style:"max-height:52vh"},[t]),el("div",{class:"row right",style:"margin-top:12px"},[el("button",{class:"btn",text:"Close",onclick:closeModal})])]));}
function editAt(tab,ri,colIdx){var g=tab.state.g;if(ri<0||ri>=g.rows.length||colIdx<0||!g.fields||colIdx>=g.fields.length)return;var tr=g.grid.querySelector('tr[data-ri="'+ri+'"]');if(!tr)return;var tds=tr.querySelectorAll("td");var td=tds[colIdx+1];if(td)startEdit(tab,td,ri,g.fields[colIdx],g.rows[ri]);}

function applyReadOnly(){var b=$("roBadge");b.className="badge ro"+(S.readOnly?" active":"");b.textContent=S.readOnly?"Read-only":"Read/Write";}
function toggleReadOnly(){S.readOnly=!S.readOnly;applyReadOnly();logMsg("Read-only mode: "+(S.readOnly?"ON":"OFF"),"ok");}

function initSidebarCollapse(){Array.prototype.forEach.call(document.querySelectorAll(".side-head"),function(h){h.addEventListener("click",function(){h.parentNode.classList.toggle("collapsed");});});}
function initResizer(){var r=$("resizer"),sb=$("sidebar"),drag=false;r.addEventListener("mousedown",function(){drag=true;document.body.style.userSelect="none";});window.addEventListener("mousemove",function(e){if(!drag)return;sb.style.width=Math.min(560,Math.max(220,e.clientX))+"px";});window.addEventListener("mouseup",function(){drag=false;document.body.style.userSelect="";});}

/* ====================================================================
   SSE CACHE EVENT CONSUMER
   ==================================================================== */
var _sseListeners=[];
function onSseEvent(fn){_sseListeners.push(fn);return function(){var i=_sseListeners.indexOf(fn);if(i>=0)_sseListeners.splice(i,1);};}
function connectSse(){
  if(!window.EventSource)return;
  var es=new EventSource("/api/events");
  es.onmessage=function(e){
    var ev;try{ev=JSON.parse(e.data);}catch(ex){return;}
    _sseListeners.forEach(function(fn){try{fn(ev);}catch(ex){}});
  };
  es.onerror=function(){es.close();setTimeout(connectSse,6000);};
}

window.addEventListener("load",function(){
  applyReadOnly();
  initSidebarCollapse();initResizer();
  $("roBadge").addEventListener("click",toggleReadOnly);
  $("btnImport").addEventListener("click",openBtpWizard);
  $("btnImport2").addEventListener("click",openBtpWizard);
  $("btnNewConn").addEventListener("click",newConnModal);
  $("btnSettings").addEventListener("click",openSettings);
  $("btnHome").addEventListener("click",openWelcome);
  window.addEventListener("keydown",onGlobalKey);
  $("connSearch").addEventListener("input",debounce(renderConnections,200));wireSearch($("connSearch"),renderConnections);
  $("querySearch").addEventListener("input",debounce(renderSavedQueries,200));wireSearch($("querySearch"),renderSavedQueries);
  $("topSearch").addEventListener("input",debounce(function(){$("connSearch").value=$("topSearch").value;renderConnections();},200));
  $("btnNewQuery").addEventListener("click",function(){if(!S.activeConnId)return logMsg("Select a connection first.","warn");openSqlTab();});
  Array.prototype.forEach.call(document.querySelectorAll(".searchbox"),function(box){var inp=box.querySelector("input");if(!inp)return;var x=el("span",{class:"sbclr",html:svgFor("x"),title:"Clear (Esc)"});x.addEventListener("click",function(){inp.value="";inp.dispatchEvent(new Event("input"));inp.focus();});inp.addEventListener("input",function(){x.classList.toggle("show",!!inp.value);});box.appendChild(x);});
  setConnStatus("Ready","ok");
  connectSse();
  openWelcome();
  loadSettings().then(function(){return loadConnections();}).then(function(){return restoreWorkspace();});
  loadSavedQueries();
});
})();
`;

export function getDashboardHtml(workspaceName: string): string {
  const escaped = workspaceName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped} — InTandem</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%230b0c0a'/><circle cx='9' cy='12' r='6' fill='none' stroke='%235fe39a' stroke-width='3'/><circle cx='16' cy='12' r='6' fill='none' stroke='%2359c2ff' stroke-width='3' opacity='.9'/></svg>">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}

:root {
  --bg: #0b0c0a;
  --panel: #0e100d;
  --line: #232821;
  --line-2: #161a14;
  --ink: #c9cec2;
  --dim: #828a7c;
  --faint: #4d544a;
  --accent: #5fe39a;
  --accent-d: rgba(95,227,154,.13);
  --green: #5fe39a;
  --amber: #ffb454;
  --red: #f07178;
  --blue: #59c2ff;
  --purple: #d2a6ff;
  --teal: #5ccfe6;
  --p0:#59c2ff;--p1:#5fe39a;--p2:#ffb454;--p3:#d2a6ff;--p4:#f07178;--p5:#5ccfe6;--p6:#ffd173;--p7:#f29e74;
  --mono: ui-monospace,'SF Mono','Cascadia Mono','JetBrains Mono','Fira Mono',Menlo,Consolas,monospace;
  --sidebar-w: 240px;
}

@media(prefers-color-scheme:light){:root{
  --bg:#f4f1e8;--panel:#eeeadd;--line:#d5d0bd;--line-2:#e3dfd0;
  --ink:#2a2f26;--dim:#68705f;--faint:#a0a693;
  --accent:#0e7d52;--accent-d:rgba(14,125,82,.1);
  --green:#0e7d52;--amber:#96660a;--red:#bf3a30;--blue:#1d63c9;--purple:#7a4bd0;--teal:#0c7d76;
  --p0:#1d63c9;--p1:#0e7d52;--p2:#96660a;--p3:#7a4bd0;--p4:#bf3a30;--p5:#0c7d76;--p6:#7d6604;--p7:#b0532a;
}}
:root[data-theme="light"]{
  --bg:#f4f1e8;--panel:#eeeadd;--line:#d5d0bd;--line-2:#e3dfd0;
  --ink:#2a2f26;--dim:#68705f;--faint:#a0a693;
  --accent:#0e7d52;--accent-d:rgba(14,125,82,.1);
  --green:#0e7d52;--amber:#96660a;--red:#bf3a30;--blue:#1d63c9;--purple:#7a4bd0;--teal:#0c7d76;
  --p0:#1d63c9;--p1:#0e7d52;--p2:#96660a;--p3:#7a4bd0;--p4:#bf3a30;--p5:#0c7d76;--p6:#7d6604;--p7:#b0532a;
}
:root[data-theme="dark"]{
  --bg:#0b0c0a;--panel:#0e100d;--line:#232821;--line-2:#161a14;
  --ink:#c9cec2;--dim:#828a7c;--faint:#4d544a;
  --accent:#5fe39a;--accent-d:rgba(95,227,154,.13);
  --green:#5fe39a;--amber:#ffb454;--red:#f07178;--blue:#59c2ff;--purple:#d2a6ff;--teal:#5ccfe6;
  --p0:#59c2ff;--p1:#5fe39a;--p2:#ffb454;--p3:#d2a6ff;--p4:#f07178;--p5:#5ccfe6;--p6:#ffd173;--p7:#f29e74;
}

html{font-size:13px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--mono);color:var(--ink);background:var(--bg);line-height:1.5;overflow:hidden;height:100vh;display:flex;flex-direction:column}
button,input{font-family:inherit}
::selection{background:var(--accent);color:var(--bg)}

::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--line);border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:var(--faint)}

/* ── Status line (top) ── */
.topbar{height:38px;display:flex;align-items:center;gap:12px;padding:0 14px;background:var(--panel);border-bottom:1px solid var(--line);flex-shrink:0;font-size:.92rem;transition:border-color .25s}
.topbar.warn{border-bottom-color:var(--amber)}
.topbar.err{border-bottom-color:var(--red)}

.logo{flex-shrink:0;display:block}
.brand{color:var(--accent);font-weight:700;letter-spacing:.12em;font-size:.86rem;flex-shrink:0}
.sep{color:var(--faint)}
.ws-name{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}

.code{display:none;align-items:center;gap:6px;font-size:.8rem;color:var(--dim);background:none;border:1px solid var(--line);padding:2px 9px;cursor:pointer;transition:color .15s,border-color .15s;border-radius:2px}
.code:hover,.code:focus-visible{color:var(--accent);border-color:var(--accent)}
.code:focus-visible{outline:1px solid var(--accent);outline-offset:1px}
.code.copied{color:var(--green);border-color:var(--green)}
.code-ic{opacity:.6;font-size:.78rem}
.flex1{flex:1}

.topbar-r{display:flex;align-items:center;gap:14px;flex-shrink:0;font-size:.8rem}
.uptime{color:var(--faint);font-variant-numeric:tabular-nums}
.conn{display:flex;align-items:center;gap:6px;color:var(--accent);letter-spacing:.06em;transition:color .25s}
.conn.warn{color:var(--amber)}
.conn.err{color:var(--red)}
.conn-dot{width:6px;height:6px;background:currentColor;animation:pulse 2.4s ease infinite}
.conn.warn .conn-dot{animation-duration:.7s}
.conn.err .conn-dot{animation:none;opacity:.5}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}

.theme-btn{width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--line);border-radius:2px;color:var(--faint);cursor:pointer;font-size:.85rem;line-height:1;transition:color .15s,border-color .15s}
.theme-btn:hover{color:var(--ink);border-color:var(--dim)}
.theme-btn:focus-visible{outline:1px solid var(--accent);outline-offset:1px}

/* ── Layout ── */
.layout{display:flex;flex:1;min-height:0}
.sidebar{width:var(--sidebar-w);flex-shrink:0;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow-y:auto}
.main{flex:1;display:flex;flex-direction:column;min-width:0}

/* ── Sidebar ── */
.sb-sec{padding:14px 12px 10px}
.sh{display:flex;align-items:center;gap:8px;font-size:.72rem;letter-spacing:.16em;color:var(--faint);text-transform:uppercase;margin-bottom:8px}
.sh .rule{flex:1;border-top:1px solid var(--line-2)}
.shv{color:var(--dim);letter-spacing:.02em;font-variant-numeric:tabular-nums}

.peer{display:flex;gap:8px;padding:4px 4px;align-items:baseline;transition:background .1s}
.peer:hover{background:var(--line-2)}
.peer-blk{flex-shrink:0}
.peer-name{color:var(--ink);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.9rem}
.peer-time{color:var(--faint);font-size:.76rem;font-variant-numeric:tabular-nums;flex-shrink:0}
.peer-sub{padding:0 4px 3px 16px;color:var(--faint);font-size:.76rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:-3px}
.sb-empty{color:var(--faint);font-size:.82rem;padding:6px 4px}

.kv{display:flex;align-items:baseline;gap:8px;padding:3px 4px;cursor:pointer;background:none;border:none;width:100%;text-align:left;color:var(--dim);font-size:.85rem;transition:background .1s}
.kv:hover{background:var(--line-2);color:var(--ink)}
.kv:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}
.kv .lead{flex:1;border-bottom:1px dotted var(--line);transform:translateY(-3px)}
.kv-v{color:var(--ink);font-variant-numeric:tabular-nums}

.sb-foot{margin-top:auto;padding:10px 14px;border-top:1px solid var(--line-2);font-size:.74rem;color:var(--faint);display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden}
.cursor{display:inline-block;width:7px;height:12px;background:var(--accent);animation:blink 1.1s steps(1) infinite;flex-shrink:0}
@keyframes blink{50%{opacity:0}}

/* ── Tabs ── */
.tab-bar{display:flex;gap:2px;padding:5px 10px;border-bottom:1px solid var(--line);background:var(--panel);overflow-x:auto;flex-shrink:0}
.tab-btn{font-size:.85rem;padding:3px 10px;color:var(--dim);background:none;border:none;border-radius:2px;cursor:pointer;transition:color .12s,background .12s;white-space:nowrap;display:flex;align-items:center;gap:7px}
.tab-btn .k{color:var(--faint);font-size:.76rem}
.tab-btn:hover{color:var(--ink);background:var(--line-2)}
.tab-btn.active{background:var(--accent);color:var(--bg);font-weight:600}
.tab-btn.active .k,.tab-btn.active .tab-ct{color:var(--bg);opacity:.75}
.tab-btn:focus-visible{outline:1px solid var(--accent);outline-offset:1px}
.tab-ct{font-size:.76rem;color:var(--faint);font-variant-numeric:tabular-nums}

.tab-panel{flex:1;overflow-y:auto;display:none}
.tab-panel.active{display:flex;flex-direction:column;animation:panelIn .15s ease}
@keyframes panelIn{from{opacity:0}to{opacity:1}}

.pop{animation:flash .6s ease}
@keyframes flash{0%{color:var(--accent)}100%{}}

/* ── Activity ── */
.feed-bar{display:flex;align-items:baseline;gap:10px;padding:10px 16px 2px}
.feed-ct{font-size:.76rem;color:var(--faint)}
.fin-wrap{display:flex;align-items:baseline;gap:5px;color:var(--accent)}
.fin{background:transparent;border:none;border-bottom:1px solid var(--line);color:var(--ink);font-size:.82rem;width:180px;outline:none;padding:1px 3px;transition:border-color .15s}
.fin::placeholder{color:var(--faint)}
.fin:focus{border-color:var(--accent)}
.feed{flex:1;padding:6px 8px;font-size:.85rem;display:flex;flex-direction:column}
.feed-row{display:flex;gap:0;padding:2px 8px;transition:background .1s;line-height:1.6}
.feed-row:hover{background:var(--line-2)}
.feed-row.new{animation:rowIn 1.4s ease}
@keyframes rowIn{0%{background:var(--accent-d)}100%{background:transparent}}
.feed-ts{color:var(--faint);flex-shrink:0;font-variant-numeric:tabular-nums;width:76px}
.feed-ic{width:22px;flex-shrink:0;text-align:center}
.feed-who{flex-shrink:0;width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px}
.feed-what{color:var(--dim);word-break:break-word}
.feed-what .hl{color:var(--ink)}

/* ── Kanban ── */
.kanban{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line-2);flex:1;align-content:stretch}
@media(max-width:960px){.kanban{grid-template-columns:repeat(2,1fr)}}
@media(max-width:500px){.kanban{grid-template-columns:1fr}}
.k-col{background:var(--bg);display:flex;flex-direction:column;padding:10px;gap:6px;min-height:120px}
.k-hdr{font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);display:flex;align-items:center;gap:7px;padding-bottom:6px}
.k-cnt{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums;letter-spacing:0}

.t-card{padding:7px 10px;border:1px solid var(--line-2);border-left:2px solid var(--faint);transition:background .12s,border-color .12s;cursor:default}
.t-card:hover{background:var(--line-2);border-color:var(--line)}
.t-card.open{border-left-color:var(--dim)}
.t-card.claimed{border-left-color:var(--blue)}
.t-card.in_progress{border-left-color:var(--amber)}
.t-card.done{border-left-color:var(--green);opacity:.5}
.t-card.done .t-title{text-decoration:line-through}
.t-card.blocked{border-left-color:var(--red);border-style:dashed}
.t-title{font-size:.85rem;line-height:1.45;word-break:break-word}
.t-meta{display:flex;align-items:baseline;gap:8px;margin-top:4px;font-size:.74rem;color:var(--faint);flex-wrap:wrap}
.t-id{color:var(--faint)}
.t-pri{text-transform:uppercase;letter-spacing:.06em;font-size:.7rem}
.t-pri.critical{color:var(--red)}
.t-pri.high{color:var(--amber)}
.t-pri.medium{color:var(--blue)}
.t-pri.low{color:var(--faint)}
.t-res{font-size:.76rem;color:var(--faint);margin-top:5px;padding-top:5px;border-top:1px dotted var(--line);word-break:break-word}
.k-empty{font-size:.78rem;color:var(--faint);padding:10px 2px;opacity:.7}

/* ── Tables ── */
.tw{padding:10px 16px 16px;flex:1;overflow-y:auto}
.dt{width:100%;border-collapse:collapse;font-size:.85rem}
.dt th{text-align:left;padding:7px 12px 7px 0;color:var(--faint);font-weight:500;font-size:.7rem;text-transform:uppercase;letter-spacing:.13em;border-bottom:1px solid var(--line);white-space:nowrap}
.dt td{padding:6px 12px 6px 0;border-bottom:1px solid var(--line-2);vertical-align:top}
.dt tbody tr{transition:background .1s}
.dt tbody tr:hover{background:var(--line-2)}
.dt td:first-child,.dt th:first-child{padding-left:4px}
.dt td:last-child,.dt th:last-child{word-break:break-word}
.dim{color:var(--faint)}

.sev{letter-spacing:.04em;font-size:.8rem;white-space:nowrap}
.sev-critical{color:var(--red)}
.sev-high{color:var(--amber)}
.sev-medium{color:var(--blue)}
.sev-low,.sev-info{color:var(--faint)}

.gauge{letter-spacing:1px;font-size:.8rem}
.lock-ttl{font-variant-numeric:tabular-nums}
.exp{color:var(--red)}
.ok-g{color:var(--green)}
.var-key{color:var(--teal)}
.var-val{color:var(--dim);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}

.msg-t{text-transform:uppercase;letter-spacing:.08em;font-size:.72rem;color:var(--faint);white-space:nowrap}
.msg-t.finding{color:var(--red)}
.msg-t.task{color:var(--amber)}
.msg-t.handoff{color:var(--purple)}
.msg-t.question{color:var(--blue)}

.spec-st{letter-spacing:.04em;font-size:.8rem;white-space:nowrap}
.spec-proposed{color:var(--amber)}
.spec-approved{color:var(--green)}
.spec-withdrawn{color:var(--faint)}
.spec-type{color:var(--purple);font-size:.8rem}
.spec-row{cursor:pointer}
.spec-caret{display:inline-block;color:var(--faint);margin-right:8px;transition:transform .15s}
.expanded .spec-caret{transform:rotate(90deg)}
.spec-detail td{padding-top:2px}
.spec-pre{font-size:.8rem;color:var(--dim);white-space:pre-wrap;word-break:break-word;border-left:2px solid var(--line);padding:6px 0 6px 14px;margin:2px 0 8px 12px;max-height:280px;overflow:auto;line-height:1.55}
.rv{margin-right:12px;font-size:.8rem;white-space:nowrap}
.rv.ok{color:var(--green)}
.rv.chg{color:var(--amber)}
.cons{color:var(--faint);font-size:.76rem;margin-top:2px;letter-spacing:1px}
.cons .cf{color:var(--accent)}

.sum-row{display:flex;gap:16px;padding:2px 4px 10px;font-size:.8rem;flex-wrap:wrap}

/* ── Peer focus ── */
.pn{cursor:pointer}
.pn:hover{text-decoration:underline}
.peer.pn:hover{text-decoration:none}
.peer.focused{background:var(--accent-d)}
.peer.dimmed{opacity:.45}
.focus-bar{display:flex;align-items:baseline;gap:10px;padding:4px 16px;border-bottom:1px solid var(--line);background:var(--accent-d);font-size:.8rem;color:var(--dim);flex-shrink:0}
.fb-hint{color:var(--faint);font-size:.74rem}

/* ── Expandable details ── */
.t-card.expandable{cursor:pointer}
.t-desc{font-size:.78rem;color:var(--dim);margin-top:5px;line-height:1.55;word-break:break-word}
.t-deps{font-size:.74rem;margin-top:4px;color:var(--faint)}
.t-deps .dep-done{color:var(--green)}
.t-deps .dep-open{color:var(--amber)}
.fd-row.expandable{cursor:pointer}
.fd-detail td{padding-top:0}
.fd-box{border-left:2px solid var(--line);padding:4px 0 5px 14px;margin:2px 0 8px 2px;font-size:.8rem;color:var(--ink);line-height:1.6}
.fd-meta{color:var(--faint);font-size:.74rem}
.fd-pat{color:var(--dim);font-size:.78rem}
.hit{animation:rowIn 1.4s ease}

/* ── Global search ── */
.search-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:90;display:flex;align-items:flex-start;justify-content:center;padding-top:11vh}
:root[data-theme="light"] .search-ov{background:rgba(40,40,30,.25)}
.search-box{width:min(680px,92vw);background:var(--panel);border:1px solid var(--line);box-shadow:0 12px 40px rgba(0,0,0,.35)}
.search-line{display:flex;gap:9px;padding:10px 14px;border-bottom:1px solid var(--line);color:var(--accent);align-items:baseline}
.search-line input{flex:1;background:none;border:none;outline:none;color:var(--ink);font:inherit;font-size:.95rem}
.search-line input::placeholder{color:var(--faint)}
.search-ct{color:var(--faint);font-size:.76rem;white-space:nowrap}
.search-res{max-height:52vh;overflow-y:auto;padding:5px 0 8px}
.sr-grp{padding:8px 14px 3px;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.sr-item{display:flex;gap:10px;padding:4px 14px;cursor:pointer;align-items:baseline}
.sr-item.sel,.sr-item:hover{background:var(--accent-d)}
.sr-ic{width:15px;color:var(--faint);flex-shrink:0;text-align:center}
.sr-p{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-s{color:var(--faint);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:auto;max-width:38%;flex-shrink:0}
.sr-hint{padding:7px 14px;border-top:1px solid var(--line-2);color:var(--faint);font-size:.72rem}

/* ── Command line ── */
.sbar-cmd{display:flex;align-items:baseline;gap:3px;flex:1;color:var(--accent)}
.sbar-cmd input{flex:1;background:none;border:none;outline:none;color:var(--ink);font:inherit;font-size:.82rem}
.sbar-key{color:var(--faint);font-size:.72rem;flex-shrink:0}

/* ── Empty ── */
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:48px 20px;text-align:center}
.empty-t{color:var(--dim);font-size:.9rem;letter-spacing:.04em}
.empty-h{color:var(--faint);font-size:.78rem;max-width:400px;line-height:1.6}
.empty-h code{color:var(--dim);border:1px solid var(--line-2);padding:0 5px;border-radius:2px;font-size:.74rem}

/* ── Status bar ── */
.sbar{height:26px;display:flex;align-items:center;gap:9px;padding:0 14px;background:var(--panel);border-top:1px solid var(--line);font-size:.78rem;color:var(--dim);overflow:hidden;flex-shrink:0}
.sbar-mark{color:var(--accent);flex-shrink:0}
.sbar-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}

/* ── Toast ── */
.toast-area{position:fixed;bottom:38px;right:14px;z-index:100;display:flex;flex-direction:column-reverse;gap:6px;pointer-events:none}
.toast{display:flex;align-items:baseline;gap:9px;font-size:.82rem;padding:7px 13px;background:var(--panel);border:1px solid var(--line);border-left:2px solid var(--accent);color:var(--dim);pointer-events:auto;animation:tIn .18s ease;max-width:360px}
.toast-ic{color:var(--accent);flex-shrink:0}
.toast.ok{border-left-color:var(--green)}.toast.ok .toast-ic{color:var(--green)}
.toast.info{border-left-color:var(--blue)}.toast.info .toast-ic{color:var(--blue)}
.toast.warn{border-left-color:var(--amber)}.toast.warn .toast-ic{color:var(--amber)}
.toast.out{animation:tOut .15s ease forwards}
@keyframes tIn{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
@keyframes tOut{from{opacity:1}to{opacity:0}}

@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  .cursor{opacity:1}
}

/* ── Mobile ── */
@media(max-width:768px){
  .sidebar{display:none}
  .mobile-bar{display:flex!important}
  .ws-name{display:none}
  .uptime{display:none}
}
.mobile-bar{display:none;padding:6px 14px;gap:16px;background:var(--panel);border-bottom:1px solid var(--line);font-size:.8rem;color:var(--dim);overflow-x:auto;flex-shrink:0}
.m-stat{display:flex;align-items:baseline;gap:5px;white-space:nowrap}
.m-val{color:var(--ink);font-variant-numeric:tabular-nums}
</style>
</head>
<body>

<div class="toast-area" id="toasts"></div>

<div class="search-ov" id="searchOv" hidden>
  <div class="search-box">
    <div class="search-line">/<input id="searchIn" placeholder="search tasks, findings, specs, messages, vars, activity" spellcheck="false" aria-label="Global search"><span class="search-ct" id="searchCt"></span></div>
    <div class="search-res" id="searchRes"></div>
    <div class="sr-hint">&#x2191;&#x2193; navigate &#xB7; enter jump &#xB7; esc close</div>
  </div>
</div>

<div class="topbar" id="topbar">
  <svg class="logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="9" cy="12" r="6" fill="none" stroke="var(--accent)" stroke-width="2.4"/><circle cx="15.5" cy="12" r="6" fill="none" stroke="var(--blue)" stroke-width="2.4" opacity=".8"/></svg>
  <span class="brand">INTANDEM</span>
  <span class="sep">/</span>
  <span class="ws-name" id="wsName">${escaped}</span>
  <span class="code" id="joinCode" tabindex="0" role="button" title="Click to copy invite code"><span id="codeText"></span><span class="code-ic">&#x29C9;</span></span>
  <span class="flex1"></span>
  <div class="topbar-r">
    <span class="uptime" id="uptime" title="Session uptime">00:00</span>
    <div class="conn" id="conn">
      <span class="conn-dot"></span>
      <span id="connText">connecting</span>
    </div>
    <button class="theme-btn" id="themeBtn" aria-label="Toggle theme">&#x25D1;</button>
  </div>
</div>

<div class="mobile-bar" id="mobileBar">
  <div class="m-stat"><span>peers</span> <span class="m-val" id="mPeers">0</span></div>
  <div class="m-stat"><span>tasks</span> <span class="m-val" id="mTasks">0</span></div>
  <div class="m-stat"><span>locks</span> <span class="m-val" id="mLocks">0</span></div>
  <div class="m-stat"><span>findings</span> <span class="m-val" id="mFindings">0</span></div>
  <div class="m-stat"><span>specs</span> <span class="m-val" id="mSpecs">0</span></div>
</div>

<div class="layout">
  <aside class="sidebar">
    <div class="sb-sec">
      <div class="sh">peers <span class="rule"></span> <span class="shv" id="peerLbl">0/5</span></div>
      <div id="peerList"></div>
    </div>
    <div class="sb-sec">
      <div class="sh">overview <span class="rule"></span></div>
      <div>
        <button class="kv" data-goto="tasks"><span>tasks</span><span class="lead"></span><span class="kv-v" id="sT">0</span></button>
        <button class="kv" data-goto="locks"><span>locks</span><span class="lead"></span><span class="kv-v" id="sL">0</span></button>
        <button class="kv" data-goto="findings"><span>findings</span><span class="lead"></span><span class="kv-v" id="sF">0</span></button>
        <button class="kv" data-goto="specs"><span>specs</span><span class="lead"></span><span class="kv-v" id="sSp">0</span></button>
        <button class="kv" data-goto="vars"><span>vars</span><span class="lead"></span><span class="kv-v" id="sV">0</span></button>
        <button class="kv" data-goto="messages"><span>messages</span><span class="lead"></span><span class="kv-v" id="sM">0</span></button>
      </div>
    </div>
    <div class="sb-foot"><span id="sbFoot">&nbsp;</span><span class="cursor"></span></div>
  </aside>

  <div class="main">
    <div class="tab-bar" role="tablist">
      <button class="tab-btn active" data-tab="activity" role="tab" aria-selected="true"><span class="k">1</span>activity <span class="tab-ct" id="tcA">0</span></button>
      <button class="tab-btn" data-tab="tasks" role="tab" aria-selected="false"><span class="k">2</span>tasks <span class="tab-ct" id="tcT">0</span></button>
      <button class="tab-btn" data-tab="locks" role="tab" aria-selected="false"><span class="k">3</span>locks <span class="tab-ct" id="tcL">0</span></button>
      <button class="tab-btn" data-tab="findings" role="tab" aria-selected="false"><span class="k">4</span>findings <span class="tab-ct" id="tcF">0</span></button>
      <button class="tab-btn" data-tab="specs" role="tab" aria-selected="false"><span class="k">5</span>specs <span class="tab-ct" id="tcSp">0</span></button>
      <button class="tab-btn" data-tab="vars" role="tab" aria-selected="false"><span class="k">6</span>vars <span class="tab-ct" id="tcV">0</span></button>
      <button class="tab-btn" data-tab="messages" role="tab" aria-selected="false"><span class="k">7</span>messages <span class="tab-ct" id="tcM">0</span></button>
    </div>

    <div class="focus-bar" id="focusBar" hidden></div>

    <div class="tab-panel active" id="panelActivity" role="tabpanel">
      <div class="feed-bar">
        <span class="feed-ct" id="feedCt">0 events</span>
        <span class="flex1"></span>
        <span class="fin-wrap">/<input class="fin" id="actFilterIn" placeholder="filter" spellcheck="false" aria-label="Filter activity"></span>
      </div>
      <div class="feed" id="activityFeed"></div>
    </div>
    <div class="tab-panel" id="panelTasks" role="tabpanel">
      <div class="kanban">
        <div class="k-col" id="colOpen"></div>
        <div class="k-col" id="colClaimed"></div>
        <div class="k-col" id="colProgress"></div>
        <div class="k-col" id="colDone"></div>
      </div>
    </div>
    <div class="tab-panel" id="panelLocks" role="tabpanel"><div class="tw" id="locksW"></div></div>
    <div class="tab-panel" id="panelFindings" role="tabpanel"><div class="tw" id="findingsW"></div></div>
    <div class="tab-panel" id="panelSpecs" role="tabpanel"><div class="tw" id="specsW"></div></div>
    <div class="tab-panel" id="panelVars" role="tabpanel"><div class="tw" id="varsW"></div></div>
    <div class="tab-panel" id="panelMessages" role="tabpanel"><div class="tw" id="msgsW"></div></div>
  </div>
</div>

<div class="sbar"><span class="sbar-mark">&#x258C;</span><span class="sbar-text" id="sbarText">ready</span><span class="sbar-cmd" id="cmdWrap" hidden>:<input id="cmdIn" spellcheck="false" aria-label="Command"></span><span class="sbar-key">/ search &#xB7; : cmd</span></div>

<script>
(function(){
  let state={workspace:null,peers:[],tasks:[],locks:[],claims:[],findings:[],specs:[],vars:[],activity:[],messages:[]};
  let ws=null,reconnectDelay=1000,reconnectTimer=null,lostTimer=null,startedAt=Date.now();
  let expandedSpecs={},expandedTasks={},expandedFindings={},actFilter='',peerFocus=null;

  const $=id=>document.getElementById(id);
  const esc=s=>{const d=document.createElement('div');d.textContent=s;return d.innerHTML};

  const peerColors=['var(--p0)','var(--p1)','var(--p2)','var(--p3)','var(--p4)','var(--p5)','var(--p6)','var(--p7)'];
  function colorFor(n){let h=0;for(let i=0;i<n.length;i++)h=((h<<5)-h+n.charCodeAt(i))|0;return peerColors[Math.abs(h)%peerColors.length]}

  // Theme
  let theme=localStorage.getItem('intandem-theme');
  if(theme)document.documentElement.setAttribute('data-theme',theme);
  function updateThemeIcon(){
    const dark=(theme==='dark')||(!theme&&matchMedia('(prefers-color-scheme:dark)').matches);
    $('themeBtn').textContent=dark?'\\u2600':'\\u25D1';
  }
  updateThemeIcon();
  $('themeBtn').onclick=()=>{
    const dark=(theme==='dark')||(!theme&&matchMedia('(prefers-color-scheme:dark)').matches);
    theme=dark?'light':'dark';
    document.documentElement.setAttribute('data-theme',theme);
    localStorage.setItem('intandem-theme',theme);
    updateThemeIcon();
  };

  // Copy join code
  function copyCode(el){
    const t=el.getAttribute('data-code');
    if(!t)return;
    navigator.clipboard.writeText(t).then(()=>{
      el.classList.add('copied');
      const c=$('codeText'),o=c.textContent;
      c.textContent='copied \\u2713';
      setTimeout(()=>{c.textContent=o;el.classList.remove('copied')},1200);
    });
  }
  $('joinCode').onclick=function(){copyCode(this)};
  $('joinCode').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();copyCode(this)}};

  // Tabs
  const tabBtns=document.querySelectorAll('.tab-btn');
  const tabPanels=document.querySelectorAll('.tab-panel');
  const tabOrder=['activity','tasks','locks','findings','specs','vars','messages'];
  function switchTab(name){
    tabBtns.forEach(b=>{
      const on=b.dataset.tab===name;
      b.classList.toggle('active',on);
      b.setAttribute('aria-selected',String(on));
    });
    tabPanels.forEach(p=>p.classList.toggle('active',p.id==='panel'+name.charAt(0).toUpperCase()+name.slice(1)));
  }
  tabBtns.forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.querySelectorAll('.kv').forEach(c=>c.addEventListener('click',()=>switchTab(c.dataset.goto)));
  document.addEventListener('keydown',e=>{
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'))return;
    if(e.key==='/'){e.preventDefault();openSearch();return}
    if(e.key===':'){e.preventDefault();openCmd();return}
    if(e.key==='Escape'&&peerFocus){toggleFocus(peerFocus);return}
    const i=parseInt(e.key,10)-1;
    if(i>=0&&i<tabOrder.length)switchTab(tabOrder[i]);
  });
  $('actFilterIn').addEventListener('input',e=>{actFilter=e.target.value.trim().toLowerCase();renderActivity()});
  $('actFilterIn').addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';actFilter='';renderActivity();e.target.blur()}});

  // Uptime
  setInterval(()=>{
    const s=Math.floor((Date.now()-startedAt)/1000);
    const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    $('uptime').textContent=(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
  },1000);

  // Toast
  function toast(text,kind){
    const icons={ok:'\\u2713',info:'\\u25B8',warn:'!'};
    const c=$('toasts'),t=document.createElement('div');
    t.className='toast'+(kind?' '+kind:'');
    const ic=document.createElement('span');ic.className='toast-ic';ic.textContent=icons[kind]||'\\u258C';
    const tx=document.createElement('span');tx.textContent=text;
    t.appendChild(ic);t.appendChild(tx);c.appendChild(t);
    setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),160)},2800);
  }

  // E2E decryption: peer messages are AES-256-GCM encrypted with a key
  // HKDF-derived from the workspace token. This page authenticates with that
  // same token (URL param), so it can decrypt client-side — the hub itself
  // never sees plaintext. Mirrors encryptMessage() in src/shared/crypto.ts.
  const wsToken=new URLSearchParams(location.search).get('token');
  let encKeyP=null;
  function encKey(){
    if(!encKeyP){
      const te=new TextEncoder();
      encKeyP=crypto.subtle.importKey('raw',te.encode(wsToken),'HKDF',false,['deriveKey'])
        .then(km=>crypto.subtle.deriveKey(
          {name:'HKDF',hash:'SHA-256',salt:te.encode('intandem-e2e-v2'),info:te.encode('intandem-enc')},
          km,{name:'AES-GCM',length:256},false,['decrypt']));
    }
    return encKeyP;
  }
  function b64u(s){
    s=s.replace(/-/g,'+').replace(/_/g,'/');
    while(s.length%4)s+='=';
    const bin=atob(s),a=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);
    return a;
  }
  const CIPHER_RE=/^[A-Za-z0-9_-]{14,}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{14,}$/;
  async function decryptContent(c){
    try{
      if(!wsToken||!crypto.subtle)return null;
      const p=c.split('.');
      if(p.length!==3)return null;
      const iv=b64u(p[0]),ct=b64u(p[1]),tag=b64u(p[2]);
      const data=new Uint8Array(ct.length+tag.length);
      data.set(ct);data.set(tag,ct.length);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},await encKey(),data);
      return new TextDecoder().decode(plain);
    }catch{return null}
  }
  async function decryptPending(){
    let changed=false;
    for(const m of state.messages){
      if(m._dec)continue;
      m._dec=true;
      if(typeof m.content==='string'&&CIPHER_RE.test(m.content)){
        const plain=await decryptContent(m.content);
        m.content=plain!==null?plain:'[encrypted \\u2014 cannot decrypt]';
        changed=true;
      }
    }
    if(changed)renderMessages();
  }

  function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
  function dur(ms){
    const s=Math.floor(ms/1000);
    if(s<60)return s+'s';
    if(s<3600)return Math.floor(s/60)+'m';
    return Math.floor(s/3600)+'h'+Math.floor((s%3600)/60)+'m';
  }
  function gauge(frac,n){
    n=n||5;
    const k=Math.max(0,Math.min(n,Math.round(frac*n)));
    return '\\u25AE'.repeat(k)+'\\u25AF'.repeat(n-k);
  }
  function emptyHtml(title,hint){
    return '<div class="empty"><div class="empty-t">\\u2500\\u2500 '+title+' \\u2500\\u2500</div>'+
      (hint?'<div class="empty-h">'+hint+'</div>':'')+'</div>';
  }
  function setNum(id,v){
    const el=$(id),s=String(v);
    if(el.textContent!==s){el.textContent=s;el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop')}
  }
  function who(n){
    return '<span class="pn" data-n="'+esc(n)+'" style="color:'+colorFor(n)+'" title="Click to focus">'+esc(n)+'</span>';
  }

  // Peer focus: V() returns state filtered to the focused peer
  function V(){
    if(!peerFocus)return state;
    const f=peerFocus;
    return {
      workspace:state.workspace,peers:state.peers,
      tasks:state.tasks.filter(t=>t.assignee===f||t.createdBy===f),
      locks:state.locks.filter(l=>l.lockedBy===f),
      claims:state.claims.filter(c=>c.owner===f),
      findings:state.findings.filter(x=>x.reportedBy===f),
      specs:state.specs.filter(s=>s.proposedBy===f||(s.reviews||[]).some(r=>r.reviewer===f)),
      vars:state.vars.filter(x=>x.setBy===f),
      messages:state.messages.filter(m=>m.from===f||m.to===f),
      activity:state.activity.filter(a=>a.actor===f)
    };
  }
  function emptyFor(what){
    return emptyHtml('nothing for '+esc(peerFocus)+' here',what+' \\u2014 esc to clear focus');
  }
  function updateFocusBar(){
    const bar=$('focusBar');
    if(!peerFocus){bar.hidden=true;return}
    bar.hidden=false;
    bar.innerHTML='<span style="color:'+colorFor(peerFocus)+'">\\u25C9 '+esc(peerFocus)+'</span>'+
      '<span>showing only this peer\\u2019s items</span><span class="flex1"></span>'+
      '<span class="fb-hint">esc or click name again to clear</span>';
  }
  function toggleFocus(n){
    peerFocus=peerFocus===n?null:n;
    updateFocusBar();
    renderAll();
    sbar(peerFocus?'focus: '+peerFocus:'focus cleared');
  }
  document.addEventListener('click',e=>{
    const p=e.target.closest('.pn');
    if(!p)return;
    const n=p.getAttribute('data-n');
    if(n)toggleFocus(n);
  });

  // Render: Peers
  function renderPeers(){
    const list=$('peerList');
    if(!state.peers.length){
      list.innerHTML='<div class="sb-empty">waiting for connections\\u2026</div>';
    }else{
      list.innerHTML=state.peers.map(p=>{
        const c=colorFor(p.username);
        const cls='peer pn'+(peerFocus?(p.username===peerFocus?' focused':' dimmed'):'');
        let h='<div class="'+cls+'" data-n="'+esc(p.username)+'" title="Click to focus"><span class="peer-blk" style="color:'+c+'">\\u258A</span>'+
          '<span class="peer-name">'+esc(p.username)+'</span>'+
          '<span class="peer-time">'+dur(Date.now()-p.connectedAt)+'</span></div>';
        if(p.workingOn)h+='<div class="peer-sub" title="'+esc(p.workingOn)+'">\\u2514 '+esc(p.workingOn)+'</div>';
        return h;
      }).join('');
    }
    const max=state.workspace?.maxPeers||5;
    $('peerLbl').textContent=state.peers.length+'/'+max;
    $('mPeers').textContent=state.peers.length+'/'+max;
  }

  // Render: Stats
  function renderStats(){
    const v=V();
    const active=v.tasks.filter(t=>t.status!=='done').length;
    setNum('sT',active);setNum('sL',v.locks.length);setNum('sF',v.findings.length);
    setNum('sSp',v.specs.length);setNum('sV',v.vars.length);setNum('sM',v.messages.length);
    setNum('tcA',v.activity.length);setNum('tcT',v.tasks.length);setNum('tcL',v.locks.length);
    setNum('tcF',v.findings.length);setNum('tcSp',v.specs.length);setNum('tcV',v.vars.length);setNum('tcM',v.messages.length);
    $('mTasks').textContent=active;$('mLocks').textContent=v.locks.length;
    $('mFindings').textContent=v.findings.length;$('mSpecs').textContent=v.specs.length;
  }

  // Render: Activity
  function catFor(a){
    if(a.indexOf('joined')>=0)return['+','var(--green)'];
    if(a.indexOf('left')>=0)return['-','var(--red)'];
    if(a.indexOf('finding')>=0)return['!','var(--red)'];
    if(a.indexOf('spec')>=0)return['\\u2261','var(--purple)'];
    if(a.indexOf('lock')>=0)return['\\u2298','var(--blue)'];
    if(a.indexOf('task')>=0)return['\\u25B8','var(--amber)'];
    if(a.indexOf('variable')>=0||a.indexOf('var')===0)return['$','var(--teal)'];
    return['\\u00B7','var(--faint)'];
  }
  function renderActivity(highlightLast){
    const feed=$('activityFeed'),panel=$('panelActivity');
    const nearBottom=panel.scrollHeight-panel.scrollTop-panel.clientHeight<90;
    const all=V().activity;
    const rows=all.filter(e=>{
      if(!actFilter)return true;
      return (e.actor+' '+e.action+' '+(e.detail||'')).toLowerCase().indexOf(actFilter)>=0;
    });
    $('feedCt').textContent=(actFilter||peerFocus)?rows.length+'/'+state.activity.length+' events':state.activity.length+' events';
    if(!state.activity.length){
      feed.innerHTML=emptyHtml('no activity yet','peer actions \\u2014 joins, tasks, locks, specs \\u2014 stream here in real time');
    }else if(!rows.length){
      feed.innerHTML=peerFocus&&!actFilter?emptyFor('no activity from them yet')
        :emptyHtml('no matches','nothing matches \\u201C'+esc(actFilter)+'\\u201D \\u2014 esc to clear');
    }else{
      const last=state.activity[state.activity.length-1];
      feed.innerHTML=rows.map(e=>{
        const sys=e.actor==='system';
        const c=sys?'var(--purple)':colorFor(e.actor);
        const cat=catFor(e.action);
        const txt=e.action+(e.detail?' '+e.detail:'');
        const hi=esc(txt).replace(/\\[([^\\]]+)\\]/g,'<span class="hl">[$1]</span>');
        const nw=(highlightLast&&e===last)?' new':'';
        const pn=sys?'':' pn" data-n="'+esc(e.actor);
        return '<div class="feed-row'+nw+'"><span class="feed-ts">'+fmtTime(e.timestamp)+'</span>'+
          '<span class="feed-ic" style="color:'+cat[1]+'">'+cat[0]+'</span>'+
          '<span class="feed-who'+pn+'" style="color:'+c+'">'+esc(e.actor)+'</span>'+
          '<span class="feed-what">'+hi+'</span></div>';
      }).join('');
      if(nearBottom||highlightLast===undefined)panel.scrollTop=panel.scrollHeight;
    }
  }

  // Render: Tasks
  function renderTasks(){
    const bk={open:[],blocked:[],claimed:[],in_progress:[],done:[]};
    for(const t of V().tasks)(bk[t.status]||bk.open).push(t);

    function depsLine(t){
      if(!t.dependsOn||!t.dependsOn.length)return '';
      const parts=t.dependsOn.map(id=>{
        const d=state.tasks.find(x=>x.id===id);
        const cls=d&&d.status==='done'?'dep-done':'dep-open';
        return '<span class="'+cls+'">'+esc(id)+'</span>';
      }).join(' ');
      return '<div class="t-deps">\\u22B6 waits on '+parts+'</div>';
    }
    function card(t){
      const exp=expandedTasks[t.id];
      const extra=!!(t.description||(t.result&&t.result.length>100));
      let h='<div class="t-card '+t.status+(extra?' expandable':'')+(exp?' expanded':'')+'" data-tid="'+esc(t.id)+'">';
      h+='<div class="t-title">'+(extra?'<span class="spec-caret">\\u25B8</span>':'')+esc(t.title)+'</div>';
      h+=depsLine(t);
      if(exp&&t.description)h+='<div class="t-desc">'+esc(t.description)+'</div>';
      h+='<div class="t-meta"><span class="t-id">'+esc(t.id)+'</span>';
      if(t.priority)h+='<span class="t-pri '+t.priority+'">'+t.priority+'</span>';
      if(t.assignee)h+='<span>'+who(t.assignee)+'</span>';
      h+='</div>';
      if(t.result&&t.status==='done'){
        const r=exp?t.result:(t.result.length>100?t.result.slice(0,100)+'\\u2026':t.result);
        h+='<div class="t-res">'+esc(r)+'</div>';
      }
      return h+'</div>';
    }

    const empty='<span class="k-empty">\\u2205 nothing here</span>';
    function col(id,items,color,label){
      $(id).innerHTML='<div class="k-hdr"><span style="color:'+color+'">\\u258C</span>'+label+
        '<span class="k-cnt">'+items.length+'</span></div>'+(items.map(card).join('')||empty);
    }

    const openAll=[...bk.open,...bk.blocked];
    col('colOpen',openAll,'var(--dim)','open');
    col('colClaimed',bk.claimed,'var(--blue)','claimed');
    col('colProgress',bk.in_progress,'var(--amber)','in progress');
    col('colDone',bk.done,'var(--green)','done');
  }
  document.querySelector('.kanban').addEventListener('click',e=>{
    if(e.target.closest('.pn'))return;
    const c=e.target.closest('.t-card.expandable');
    if(!c)return;
    const id=c.getAttribute('data-tid');
    expandedTasks[id]=!expandedTasks[id];
    renderTasks();
  });

  // Render: Locks
  function renderLocks(){
    const v=V();
    const locks=v.locks,claims=v.claims;
    if(!locks.length&&!claims.length){
      $('locksW').innerHTML=peerFocus&&(state.locks.length||state.claims.length)?emptyFor('no locks or territory held by them')
        :emptyHtml('no locks or territory','peers take advisory locks before editing (5 minute ttl) and claim subtree ownership with <code>intandem_claim_ownership</code>');
      return;
    }
    let h='';
    if(claims.length){
      h+='<div class="sh">territory <span class="rule"></span> <span class="shv">'+claims.length+'</span></div>';
      h+='<table class="dt"><thead><tr><th>pattern</th><th>owner</th><th>note</th><th>since</th></tr></thead><tbody>';
      for(const c of claims){
        h+='<tr><td>'+esc(c.pattern)+'</td><td>'+who(c.owner)+'</td>'+
          '<td class="dim">'+(c.note?esc(c.note):'\\u2014')+'</td>'+
          '<td class="dim">'+dur(Date.now()-c.createdAt)+' ago</td></tr>';
      }
      h+='</tbody></table><div style="height:20px"></div>';
    }
    h+='<div class="sh">active locks <span class="rule"></span> <span class="shv">'+locks.length+'</span></div>';
    if(!locks.length){
      h+='<div class="k-empty">\\u2205 no active locks</div>';
    }else{
      h+='<table class="dt"><thead><tr><th>file</th><th>held by</th><th>task</th><th>ttl</th></tr></thead><tbody>';
      for(const l of locks){
        const rem=Math.max(0,l.expiresAt-Date.now());
        const total=Math.max(1,l.expiresAt-l.lockedAt);
        const low=rem<60000;
        h+='<tr><td>'+esc(l.filePath)+'</td><td>'+who(l.lockedBy)+'</td>'+
          '<td class="dim">'+(l.taskId?esc(l.taskId):'\\u2014')+'</td>'+
          '<td><span class="gauge '+(low?'exp':'ok-g')+'">'+gauge(rem/total)+'</span> <span class="lock-ttl'+(low?' exp':' dim')+'">'+dur(rem)+'</span></td></tr>';
      }
      h+='</tbody></table>';
    }
    $('locksW').innerHTML=h;
  }

  // Render: Findings
  const sevOrder={critical:0,high:1,medium:2,low:3,info:4};
  const sevGlyph={critical:'\\u25B2',high:'\\u25B2',medium:'\\u25CF',low:'\\u25CB',info:'\\u25E6'};
  function renderFindings(){
    const findings=V().findings;
    if(!findings.length){
      $('findingsW').innerHTML=peerFocus&&state.findings.length?emptyFor('no findings reported by them')
        :emptyHtml('no findings reported','findings submitted with <code>intandem_report</code> land here, ranked by severity');
      return;
    }
    const sorted=[...findings].sort((a,b)=>(sevOrder[a.severity]??5)-(sevOrder[b.severity]??5));
    const counts={};
    for(const f of findings)counts[f.severity]=(counts[f.severity]||0)+1;
    let h='<div class="sum-row">'+Object.keys(sevOrder).filter(k=>counts[k])
      .map(k=>'<span class="sev sev-'+k+'">'+sevGlyph[k]+' '+counts[k]+' '+k+'</span>').join('')+'</div>';
    h+='<table class="dt"><thead><tr><th>sev</th><th>service</th><th>summary</th><th>by</th></tr></thead><tbody>';
    for(const f of sorted){
      const extra=!!(f.recommendation||(f.patterns&&f.patterns.length)||f.count!=null||f.category||f.taskId);
      const exp=extra&&expandedFindings[f.id];
      h+='<tr class="fd-row'+(extra?' expandable':'')+(exp?' expanded':'')+'" data-fid="'+esc(f.id)+'">'+
        '<td>'+(extra?'<span class="spec-caret">\\u25B8</span>':'')+'<span class="sev sev-'+f.severity+'">'+sevGlyph[f.severity]+' '+f.severity+'</span></td>'+
        '<td class="dim">'+esc(f.service)+'</td><td>'+esc(f.summary)+'</td><td>'+who(f.reportedBy)+'</td></tr>';
      if(exp){
        let d='';
        const meta=[];
        if(f.category)meta.push('category: '+esc(f.category));
        if(f.count!=null)meta.push('count: '+f.count);
        if(f.taskId)meta.push('task: '+esc(f.taskId));
        if(meta.length)d+='<div class="fd-meta">'+meta.join(' \\u00B7 ')+'</div>';
        if(f.recommendation)d+='<div>'+esc(f.recommendation)+'</div>';
        if(f.patterns&&f.patterns.length)d+=f.patterns.map(p=>'<div class="fd-pat">\\u25AA '+esc(p.pattern)+(p.count?' \\u00D7'+p.count:'')+'</div>').join('');
        h+='<tr class="fd-detail"><td colspan="4"><div class="fd-box">'+d+'</div></td></tr>';
      }
    }
    $('findingsW').innerHTML=h+'</tbody></table>';
  }
  $('findingsW').addEventListener('click',e=>{
    if(e.target.closest('.pn'))return;
    const r=e.target.closest('.fd-row.expandable');
    if(!r)return;
    const id=r.getAttribute('data-fid');
    expandedFindings[id]=!expandedFindings[id];
    renderFindings();
  });

  // Render: Vars
  function renderVars(){
    const vars=V().vars;
    if(!vars.length){
      $('varsW').innerHTML=peerFocus&&state.vars.length?emptyFor('no vars set by them')
        :emptyHtml('no shared variables','key\\u2013value pairs set with <code>intandem_set_var</code> are shared across all peers');
      return;
    }
    let h='<table class="dt"><thead><tr><th>key</th><th>value</th><th>set by</th></tr></thead><tbody>';
    for(const v of vars){
      h+='<tr><td class="var-key">'+esc(v.key)+'</td><td><span class="var-val" title="'+esc(v.value)+'">'+esc(v.value)+'</span></td>'+
        '<td>'+who(v.setBy)+'</td></tr>';
    }
    $('varsW').innerHTML=h+'</tbody></table>';
  }

  // Render: Messages
  function renderMessages(){
    const messages=V().messages;
    if(!messages.length){
      $('msgsW').innerHTML=peerFocus&&state.messages.length?emptyFor('no messages to or from them')
        :emptyHtml('no recent messages','peer-to-peer messages \\u2014 questions, statuses, handoffs \\u2014 appear here');
      return;
    }
    let h='<table class="dt"><thead><tr><th>time</th><th>type</th><th>from</th><th>content</th></tr></thead><tbody>';
    for(const m of messages){
      const tc=['finding','task','handoff','question'].includes(m.type)?' '+m.type:'';
      const from=who(m.from)+(m.to?' <span class="dim">\\u2192</span> '+who(m.to):'');
      h+='<tr><td class="dim">'+fmtTime(m.timestamp)+'</td><td><span class="msg-t'+tc+'">'+esc(m.type)+'</span></td>'+
        '<td>'+from+'</td><td class="dim">'+esc(m.content.length>180?m.content.slice(0,180)+'\\u2026':m.content)+'</td></tr>';
    }
    $('msgsW').innerHTML=h+'</tbody></table>';
  }

  // Render: Specs
  const specGlyph={proposed:'\\u25CF',approved:'\\u2714',withdrawn:'\\u2715'};
  function renderSpecs(){
    const specs=V().specs;
    if(!specs.length){
      $('specsW').innerHTML=peerFocus&&state.specs.length?emptyFor('no specs proposed or reviewed by them')
        :emptyHtml('no specs proposed','interface contracts proposed with <code>intandem_propose_spec</code> are negotiated here \\u2014 peers vote, consensus approves \\u00B7 click a row for content');
      return;
    }
    let h='<table class="dt"><thead><tr><th>id</th><th>status</th><th>type</th><th>name</th><th>by</th><th>ver</th><th>reviews</th></tr></thead><tbody>';
    specs.forEach(s=>{
      const reviews=s.reviews&&s.reviews.length
        ?s.reviews.map(r=>'<span class="rv '+(r.vote==='approve'?'ok':'chg')+'">'+(r.vote==='approve'?'\\u2713':'\\u270E')+esc(r.reviewer)+'</span>').join('')
        :'<span class="dim">\\u2014</span>';
      let cons='';
      if(s.status==='proposed'){
        const req=state.peers.filter(p=>p.username!==s.proposedBy).length;
        const ap=(s.reviews||[]).filter(r=>r.vote==='approve').length;
        cons=req>0
          ?'<div class="cons"><span class="cf">'+gauge(ap/req,req)+'</span> '+ap+'/'+req+' approved</div>'
          :'<div class="cons">awaiting reviewers</div>';
      }
      const exp=expandedSpecs[s.id];
      h+='<tr class="spec-row'+(exp?' expanded':'')+'" data-sid="'+esc(s.id)+'">'+
        '<td><span class="spec-caret">\\u25B8</span>'+esc(s.id)+'</td>'+
        '<td><span class="spec-st spec-'+s.status+'">'+specGlyph[s.status]+' '+s.status+'</span></td>'+
        '<td><span class="spec-type">'+esc(s.specType)+'</span></td>'+
        '<td>'+esc(s.name)+'</td>'+
        '<td>'+who(s.proposedBy)+'</td>'+
        '<td class="dim">v'+s.version+'</td><td>'+reviews+cons+'</td></tr>';
      if(exp)h+='<tr class="spec-detail"><td colspan="7"><pre class="spec-pre">'+esc(s.content)+'</pre></td></tr>';
    });
    $('specsW').innerHTML=h+'</tbody></table>';
  }
  $('specsW').addEventListener('click',e=>{
    if(e.target.closest('.pn'))return;
    const r=e.target.closest('.spec-row');
    if(!r)return;
    const id=r.getAttribute('data-sid');
    expandedSpecs[id]=!expandedSpecs[id];
    renderSpecs();
  });

  function renderAll(){
    renderPeers();renderStats();renderActivity();renderTasks();
    renderLocks();renderFindings();renderSpecs();renderVars();renderMessages();
    if(state.workspace?.inviteCode){
      const el=$('joinCode');
      $('codeText').textContent=state.workspace.inviteCode;
      el.setAttribute('data-code',state.workspace.inviteCode);
      el.style.display='inline-flex';
    }
    if(state.workspace?.id)$('sbFoot').textContent='ws:'+state.workspace.id;
  }

  function sbar(t){$('sbarText').textContent=t}

  // Connection
  function setConn(mode){
    const c=$('conn'),tb=$('topbar');
    if(mode==='connected'){c.className='conn';$('connText').textContent='live';tb.className='topbar'}
    else if(mode==='reconnecting'){c.className='conn warn';$('connText').textContent='reconnecting';tb.className='topbar warn'}
    else{c.className='conn err';$('connText').textContent='disconnected';tb.className='topbar err'}
  }

  function connect(){
    const token=new URLSearchParams(location.search).get('token');
    if(!token)return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(proto+'//'+location.host);

    ws.onopen=()=>{
      reconnectDelay=1000;
      if(lostTimer){clearTimeout(lostTimer);lostTimer=null}
      setConn('connected');
      ws.send(JSON.stringify({kind:'auth',token,username:'__dashboard__',sessionId:'__dashboard__'}));
    };
    ws.onmessage=evt=>{let msg;try{msg=JSON.parse(evt.data)}catch{return}handleMessage(msg)};
    ws.onclose=()=>{
      setConn('reconnecting');
      if(!lostTimer)lostTimer=setTimeout(()=>setConn('lost'),30000);
      reconnectTimer=setTimeout(()=>{reconnectDelay=Math.min(reconnectDelay*2,30000);connect()},reconnectDelay);
    };
    ws.onerror=()=>{};
  }

  function handleMessage(msg){
    switch(msg.kind){
      case 'dashboard_sync':
        state.workspace=msg.workspace;state.peers=msg.peers;state.tasks=msg.tasks;
        state.locks=msg.locks;state.findings=msg.findings;state.vars=msg.vars;
        state.activity=msg.activity;state.messages=msg.messages;state.specs=msg.specs||[];
        state.claims=msg.claims||[];
        $('wsName').textContent=msg.workspace.name;
        renderAll();sbar('synced with hub');
        decryptPending();
        break;
      case 'peer_joined':{
        if(!state.peers.find(p=>p.username===msg.username))
          state.peers.push({username:msg.username,connectedAt:Date.now(),lastActiveAt:Date.now()});
        renderPeers();renderStats();
        toast(msg.username+' joined','ok');sbar(msg.username+' joined');
        break;
      }
      case 'peer_left':{
        state.peers=state.peers.filter(p=>p.username!==msg.username);
        renderPeers();renderStats();
        toast(msg.username+' left','info');sbar(msg.username+' left');
        break;
      }
      case 'board_update':{
        const idx=state.tasks.findIndex(t=>t.id===msg.task.id);
        if(idx>=0)state.tasks[idx]=msg.task;else state.tasks.push(msg.task);
        renderTasks();renderStats();break;
      }
      case 'board':state.tasks=msg.tasks;renderTasks();renderStats();break;
      case 'lock_update':
        if(msg.event==='acquired'){state.locks=state.locks.filter(l=>l.filePath!==msg.lock.filePath);state.locks.push(msg.lock)}
        else state.locks=state.locks.filter(l=>l.filePath!==msg.lock.filePath);
        renderLocks();renderStats();break;
      case 'own_update':
        if(msg.event==='claimed'){state.claims=state.claims.filter(c=>c.pattern!==msg.claim.pattern);state.claims.push(msg.claim)}
        else state.claims=state.claims.filter(c=>c.pattern!==msg.claim.pattern);
        renderLocks();renderStats();
        toast('territory '+msg.event+': '+msg.claim.pattern.slice(0,40));break;
      case 'finding_broadcast':
        state.findings.push(msg.finding);renderFindings();renderStats();
        toast('finding: '+msg.finding.summary.slice(0,40),'warn');break;
      case 'spec_broadcast':{
        const si=state.specs.findIndex(s=>s.id===msg.spec.id);
        if(si>=0)state.specs[si]=msg.spec;else state.specs.push(msg.spec);
        renderSpecs();renderStats();
        toast('spec '+msg.event+': '+msg.spec.name.slice(0,30));break;
      }
      case 'var_set':{
        const vi=state.vars.findIndex(v=>v.key===msg.key);
        if(vi>=0)state.vars[vi]={key:msg.key,value:msg.value,setBy:msg.setBy};
        else state.vars.push({key:msg.key,value:msg.value,setBy:msg.setBy});
        renderVars();renderStats();break;
      }
      case 'activity_entry':
        state.activity.push(msg.entry);
        if(state.activity.length>200)state.activity=state.activity.slice(-100);
        renderActivity(true);renderStats();
        sbar(msg.entry.actor+' '+msg.entry.action+(msg.entry.detail?' '+msg.entry.detail:''));
        break;
      case 'message':
        if(msg.payload){
          state.messages.push(msg.payload);
          if(state.messages.length>100)state.messages=state.messages.slice(-50);
          renderMessages();renderStats();
          decryptPending();
        }
        break;
    }
  }

  // Command palette (:)
  const cmdWrap=$('cmdWrap'),cmdIn=$('cmdIn');
  function openCmd(){cmdWrap.hidden=false;$('sbarText').style.display='none';cmdIn.value='';cmdIn.focus()}
  function closeCmd(){cmdWrap.hidden=true;$('sbarText').style.display='';cmdIn.blur()}
  function runCmd(raw){
    closeCmd();
    const s=raw.trim();
    if(!s)return;
    const parts=s.split(/\\s+/),c=parts[0].toLowerCase(),arg=parts.slice(1).join(' ');
    const n=parseInt(c,10);
    const tab=tabOrder.find(t=>t.indexOf(c)===0);
    if(!isNaN(n)&&n>=1&&n<=tabOrder.length){switchTab(tabOrder[n-1]);sbar(':'+tabOrder[n-1])}
    else if(tab){switchTab(tab);sbar(':'+tab)}
    else if(c==='light'||c==='dark'){theme=c;document.documentElement.setAttribute('data-theme',c);localStorage.setItem('intandem-theme',c);updateThemeIcon();sbar('theme: '+c)}
    else if(c==='theme'){$('themeBtn').click();sbar('theme toggled')}
    else if(c==='copy'){copyCode($('joinCode'));sbar('invite code copied')}
    else if(c==='filter'){actFilter=arg.toLowerCase();$('actFilterIn').value=arg;switchTab('activity');renderActivity();sbar(arg?'filter: '+arg:'filter cleared')}
    else if(c==='clear'){actFilter='';$('actFilterIn').value='';renderActivity();sbar('filter cleared')}
    else if(c==='focus'){
      if(arg)toggleFocus(arg);
      else if(peerFocus)toggleFocus(peerFocus);
      else sbar('usage: :focus <peer>');
    }
    else if(c==='help'){sbar(':<tab> \\u00B7 :1-7 \\u00B7 :light :dark \\u00B7 :copy \\u00B7 :filter <text> \\u00B7 :focus <peer> \\u00B7 :clear')}
    else sbar('unknown command: '+c+' \\u2014 try :help');
  }
  cmdIn.addEventListener('keydown',e=>{
    if(e.key==='Enter')runCmd(cmdIn.value);
    else if(e.key==='Escape')closeCmd();
    e.stopPropagation();
  });

  // Global search (/)
  const searchOv=$('searchOv'),searchIn=$('searchIn'),searchRes=$('searchRes');
  let sItems=[],sSel=0;
  function searchIndex(){
    const it=[];
    state.tasks.forEach(t=>it.push({g:'tasks',tab:'tasks',ic:'\\u25B8',p:t.id+' '+t.title,s:t.assignee||t.status,
      hay:(t.id+' '+t.title+' '+(t.description||'')+' '+(t.assignee||'')+' '+t.status).toLowerCase(),
      sel:'[data-tid="'+t.id+'"]',ex:()=>{expandedTasks[t.id]=true;renderTasks()}}));
    state.findings.forEach(f=>it.push({g:'findings',tab:'findings',ic:'!',p:f.summary,s:f.severity+' \\u00B7 '+f.service,
      hay:(f.summary+' '+f.service+' '+f.severity+' '+(f.recommendation||'')+' '+(f.category||'')+' '+f.reportedBy).toLowerCase(),
      sel:'[data-fid="'+f.id+'"]',ex:()=>{expandedFindings[f.id]=true;renderFindings()}}));
    state.specs.forEach(sp=>it.push({g:'specs',tab:'specs',ic:'\\u2261',p:sp.id+' '+sp.name,s:sp.status,
      hay:(sp.id+' '+sp.name+' '+sp.content+' '+sp.proposedBy+' '+sp.status+' '+sp.specType).toLowerCase(),
      sel:'[data-sid="'+sp.id+'"]',ex:()=>{expandedSpecs[sp.id]=true;renderSpecs()}}));
    state.locks.forEach(l=>it.push({g:'locks',tab:'locks',ic:'\\u2298',p:l.filePath,s:l.lockedBy,
      hay:(l.filePath+' '+l.lockedBy+' '+(l.taskId||'')).toLowerCase()}));
    state.claims.forEach(c=>it.push({g:'territory',tab:'locks',ic:'\\u258C',p:c.pattern,s:c.owner,
      hay:(c.pattern+' '+c.owner+' '+(c.note||'')).toLowerCase()}));
    state.vars.forEach(v=>it.push({g:'vars',tab:'vars',ic:'$',p:v.key,s:String(v.value).slice(0,40),
      hay:(v.key+' '+v.value+' '+v.setBy).toLowerCase()}));
    state.messages.forEach(m=>it.push({g:'messages',tab:'messages',ic:'\\u2709',p:m.content.slice(0,80),s:m.from+(m.to?' \\u2192 '+m.to:''),
      hay:(m.type+' '+m.from+' '+(m.to||'')+' '+m.content).toLowerCase()}));
    state.activity.forEach(a=>it.push({g:'activity',tab:'activity',ic:'\\u00B7',p:a.action+(a.detail?' '+a.detail:''),s:a.actor,
      hay:(a.actor+' '+a.action+' '+(a.detail||'')).toLowerCase(),act:true}));
    return it;
  }
  function renderSearch(q){
    q=q.trim().toLowerCase();
    const per={},out=[];
    for(const it of searchIndex()){
      if(q&&it.hay.indexOf(q)<0)continue;
      per[it.g]=per[it.g]||0;
      if(per[it.g]>=6)continue;
      per[it.g]++;out.push(it);
    }
    sItems=out;sSel=0;
    $('searchCt').textContent=out.length+(q?' matches':' items');
    if(!out.length){searchRes.innerHTML='<div class="sr-grp">no matches</div>';return}
    let h='',lastG='';
    out.forEach((it,i)=>{
      if(it.g!==lastG){h+='<div class="sr-grp">'+it.g+'</div>';lastG=it.g}
      h+='<div class="sr-item'+(i===sSel?' sel':'')+'" data-i="'+i+'"><span class="sr-ic">'+it.ic+'</span><span class="sr-p">'+esc(it.p)+'</span><span class="sr-s">'+esc(it.s||'')+'</span></div>';
    });
    searchRes.innerHTML=h;
  }
  function moveSel(d){
    if(!sItems.length)return;
    sSel=(sSel+d+sItems.length)%sItems.length;
    searchRes.querySelectorAll('.sr-item').forEach(el=>{
      const on=parseInt(el.getAttribute('data-i'),10)===sSel;
      el.classList.toggle('sel',on);
      if(on)el.scrollIntoView({block:'nearest'});
    });
  }
  function openSearch(){searchOv.hidden=false;searchIn.value='';renderSearch('');searchIn.focus()}
  function closeSearch(){searchOv.hidden=true;searchIn.blur()}
  function sJump(i){
    const it=sItems[i];
    if(!it)return;
    const q=searchIn.value.trim();
    closeSearch();
    switchTab(it.tab);
    if(it.act){actFilter=q.toLowerCase();$('actFilterIn').value=q;renderActivity();return}
    if(it.ex)it.ex();
    if(it.sel)requestAnimationFrame(()=>{
      const el=document.querySelector(it.sel);
      if(el){el.scrollIntoView({block:'center'});el.classList.remove('hit');void el.offsetWidth;el.classList.add('hit')}
    });
  }
  searchIn.addEventListener('input',()=>renderSearch(searchIn.value));
  searchIn.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();moveSel(1)}
    else if(e.key==='ArrowUp'){e.preventDefault();moveSel(-1)}
    else if(e.key==='Enter')sJump(sSel);
    else if(e.key==='Escape')closeSearch();
    e.stopPropagation();
  });
  searchRes.addEventListener('click',e=>{
    const r=e.target.closest('.sr-item');
    if(r)sJump(parseInt(r.getAttribute('data-i'),10));
  });
  searchOv.addEventListener('click',e=>{if(e.target===searchOv)closeSearch()});

  // Dev hook: lets tests and previews inject messages without a live hub
  window.__tandem={handleMessage,setConn,switchTab,openSearch,openCmd,toggleFocus};

  setInterval(()=>{renderPeers();renderLocks()},10000);
  connect();
})();
</script>
</body>
</html>`;
}

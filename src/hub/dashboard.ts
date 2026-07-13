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
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root {
  --bg: #0e1219;
  --surface: #151b24;
  --raised: #1b2230;
  --raised-h: #222a39;
  --border: #252d3b;
  --border-s: #1e2533;
  --ink: #d8dbe3;
  --muted: #7c8597;
  --faint: #454d5e;
  --ghost: #2e3648;
  --accent: #34d399;
  --accent-m: rgba(52,211,153,.1);
  --green: #22c55e;
  --green-m: rgba(34,197,94,.08);
  --amber: #fbbf24;
  --amber-m: rgba(251,191,36,.08);
  --red: #f87171;
  --red-m: rgba(248,113,113,.08);
  --blue: #60a5fa;
  --purple: #a78bfa;
  --teal: #2dd4bf;
  --mono: ui-monospace,'SF Mono','Cascadia Mono','Fira Mono',Menlo,Consolas,monospace;
  --sans: -apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif;
  --sidebar-w: 260px;
}

@media(prefers-color-scheme:light){:root{
  --bg:#fbfbf9;--surface:#f4f5f2;--raised:#ffffff;--raised-h:#f0f1ee;
  --border:#e5e7e1;--border-s:#eceee8;
  --ink:#182236;--muted:#59637a;--faint:#9ba2b2;--ghost:#c8ccd4;
  --accent:#15804f;--accent-m:rgba(21,128,79,.06);
  --green:#16a34a;--green-m:rgba(22,163,74,.05);
  --amber:#b26a05;--amber-m:rgba(178,106,5,.05);
  --red:#dc2626;--red-m:rgba(220,38,38,.05);
  --blue:#2563eb;--purple:#6a4bc8;--teal:#0e7d8a;
}}
:root[data-theme="light"]{
  --bg:#fbfbf9;--surface:#f4f5f2;--raised:#ffffff;--raised-h:#f0f1ee;
  --border:#e5e7e1;--border-s:#eceee8;
  --ink:#182236;--muted:#59637a;--faint:#9ba2b2;--ghost:#c8ccd4;
  --accent:#15804f;--accent-m:rgba(21,128,79,.06);
  --green:#16a34a;--green-m:rgba(22,163,74,.05);
  --amber:#b26a05;--amber-m:rgba(178,106,5,.05);
  --red:#dc2626;--red-m:rgba(220,38,38,.05);
  --blue:#2563eb;--purple:#6a4bc8;--teal:#0e7d8a;
}
:root[data-theme="dark"]{
  --bg:#0e1219;--surface:#151b24;--raised:#1b2230;--raised-h:#222a39;
  --border:#252d3b;--border-s:#1e2533;
  --ink:#d8dbe3;--muted:#7c8597;--faint:#454d5e;--ghost:#2e3648;
  --accent:#34d399;--accent-m:rgba(52,211,153,.1);
  --green:#22c55e;--green-m:rgba(34,197,94,.08);
  --amber:#fbbf24;--amber-m:rgba(251,191,36,.08);
  --red:#f87171;--red-m:rgba(248,113,113,.08);
  --blue:#60a5fa;--purple:#a78bfa;--teal:#2dd4bf;
}

html{font-size:15px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--sans);color:var(--ink);background:var(--bg);line-height:1.5;overflow:hidden;height:100vh;display:flex;flex-direction:column}

::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--faint);border-radius:3px}

/* ── Topbar ── */
.topbar{height:46px;display:flex;align-items:center;gap:12px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--border);font-family:var(--mono);font-size:.85rem;flex-shrink:0;transition:border-color .2s}
.topbar.warn{border-bottom-color:var(--amber)}
.topbar.err{border-bottom-color:var(--red)}

.brand{font-family:var(--sans);font-weight:800;font-size:1rem;letter-spacing:-.04em;color:var(--ink);flex-shrink:0}
.sep{color:var(--faint);font-size:.75rem;font-weight:300}
.ws-name{color:var(--muted);font-family:var(--sans);font-weight:400;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.code{font-size:.75rem;color:var(--faint);cursor:pointer;padding:2px 8px;border:1px solid var(--border);border-radius:3px;transition:color .15s,border-color .15s;display:none;font-family:var(--mono)}
.code:hover,.code:focus-visible{color:var(--accent);border-color:var(--accent)}
.code:focus-visible{outline:1px solid var(--accent);outline-offset:1px}
.code.copied{color:var(--green);border-color:var(--green)}
.flex1{flex:1}

.topbar-r{display:flex;align-items:center;gap:12px;font-size:.8rem;color:var(--faint);flex-shrink:0}
.uptime{font-variant-numeric:tabular-nums}
.conn{display:flex;align-items:center;gap:5px;color:var(--accent);transition:color .2s}
.conn.warn{color:var(--amber)}
.conn.err{color:var(--red)}
.conn-dot{width:5px;height:5px;border-radius:50%;background:currentColor;animation:pulse 2.5s ease infinite}
.conn.warn .conn-dot{animation-duration:.7s}
.conn.err .conn-dot{animation:none;opacity:.5}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media(prefers-reduced-motion:reduce){.conn-dot{animation:none!important}}

.theme-btn{width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--border);border-radius:3px;color:var(--faint);cursor:pointer;font-size:.75rem;line-height:1;transition:color .15s,border-color .15s}
.theme-btn:hover{color:var(--ink);border-color:var(--muted)}
.theme-btn:focus-visible{outline:1px solid var(--accent);outline-offset:1px}

/* ── Layout ── */
.layout{display:flex;flex:1;min-height:0}
.sidebar{width:var(--sidebar-w);flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto}
.main{flex:1;display:flex;flex-direction:column;min-width:0}

/* ── Sidebar ── */
.sb-sec{padding:16px 16px}
.sb-sec+.sb-sec{border-top:1px solid var(--border)}
.sb-lbl{font-family:var(--mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.sb-lbl-v{color:var(--muted);letter-spacing:normal;font-size:.72rem}

.peer-list{display:flex;flex-direction:column;gap:1px}
.peer-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:2px;transition:background .1s;cursor:default}
.peer-row:hover{background:var(--raised)}
.peer-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.peer-name{font-family:var(--mono);font-size:.88rem;color:var(--ink);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.peer-time{font-family:var(--mono);font-size:.75rem;color:var(--faint);font-variant-numeric:tabular-nums;flex-shrink:0}

.sb-empty{font-family:var(--mono);font-size:.82rem;color:var(--faint);padding:4px 6px}

.stat-list{display:flex;flex-direction:column;gap:0}
.stat-row{display:flex;align-items:center;justify-content:space-between;padding:5px 8px;font-size:.85rem;border-radius:2px;transition:background .1s}
.stat-row:hover{background:var(--raised)}
.stat-lbl{color:var(--muted)}
.stat-val{font-family:var(--mono);color:var(--ink);font-variant-numeric:tabular-nums;font-weight:500}

/* ── Tabs ── */
.tab-bar{display:flex;gap:0;border-bottom:1px solid var(--border);background:var(--surface);padding:0 4px;overflow-x:auto;flex-shrink:0}
.tab-btn{font-family:var(--mono);font-size:.78rem;padding:11px 14px;color:var(--faint);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:color .12s,border-color .12s;white-space:nowrap;display:flex;align-items:center;gap:5px}
.tab-btn:hover{color:var(--muted)}
.tab-btn.active{color:var(--ink);border-bottom-color:var(--accent)}
.tab-btn:focus-visible{outline:1px solid var(--accent);outline-offset:-2px}
.tab-ct{font-size:.65rem;min-width:18px;height:18px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;background:var(--raised);border-radius:2px;color:var(--faint);font-weight:500}
.tab-btn.active .tab-ct{background:var(--accent-m);color:var(--accent)}

.tab-panel{flex:1;overflow-y:auto;display:none}
.tab-panel.active{display:flex;flex-direction:column}

/* ── Activity ── */
.feed{flex:1;padding:4px;font-family:var(--mono);font-size:.82rem;display:flex;flex-direction:column;gap:0}
.feed-row{display:flex;gap:10px;padding:5px 14px;border-radius:0;transition:background .08s;line-height:1.65}
.feed-row:hover{background:var(--raised)}
.feed-ts{color:var(--faint);flex-shrink:0;font-variant-numeric:tabular-nums;min-width:60px}
.feed-who{color:var(--blue);flex-shrink:0;font-weight:500;min-width:56px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-who.sys{color:var(--purple)}
.feed-what{color:var(--muted);word-break:break-word}
.feed-what .hl{color:var(--ink)}

/* ── Kanban ── */
.kanban{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border-s);flex:1}
@media(max-width:960px){.kanban{grid-template-columns:repeat(2,1fr)}}
@media(max-width:500px){.kanban{grid-template-columns:1fr}}
.k-col{background:var(--bg);display:flex;flex-direction:column;padding:10px;gap:5px;min-height:100px}
.k-hdr{font-family:var(--mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);display:flex;align-items:center;gap:6px;padding-bottom:6px;border-bottom:1px solid var(--border-s);margin-bottom:2px}
.k-dot{width:6px;height:6px;border-radius:50%}
.k-cnt{margin-left:auto;color:var(--ghost);font-variant-numeric:tabular-nums}

.t-card{padding:10px 12px;background:var(--surface);border:1px solid var(--border-s);border-left:2px solid var(--faint);border-radius:0;transition:border-color .1s;cursor:default}
.t-card:hover{border-color:var(--border)}
.t-card.open{border-left-color:var(--muted)}
.t-card.claimed{border-left-color:var(--blue)}
.t-card.in_progress{border-left-color:var(--amber)}
.t-card.done{border-left-color:var(--green);opacity:.65}
.t-card.blocked{border-left-color:var(--red);border-left-style:dashed}
.t-title{font-size:.88rem;line-height:1.4;word-break:break-word}
.t-meta{display:flex;align-items:center;gap:6px;margin-top:5px;font-family:var(--mono);font-size:.72rem;color:var(--faint);flex-wrap:wrap}
.t-pri{font-weight:600;text-transform:uppercase;font-size:.62rem;letter-spacing:.05em}
.t-pri.critical{color:var(--red)}
.t-pri.high{color:var(--amber)}
.t-pri.medium{color:var(--muted)}
.t-pri.low{color:var(--faint)}
.t-who::before{content:'';display:inline-block;width:4px;height:4px;border-radius:50%;background:var(--blue);margin-right:3px;vertical-align:middle}
.t-res{font-size:.78rem;color:var(--faint);margin-top:4px;padding-top:4px;border-top:1px solid var(--border-s);word-break:break-word;font-family:var(--mono)}
.k-empty{font-family:var(--mono);font-size:.78rem;color:var(--ghost);padding:8px 0;font-style:italic}

/* ── Tables ── */
.dt{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:.82rem}
.dt th{text-align:left;padding:8px 12px 8px 0;color:var(--faint);font-weight:500;font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);white-space:nowrap;position:sticky;top:0;background:var(--bg);z-index:1}
.dt td{padding:7px 12px 7px 0;border-bottom:1px solid var(--border-s);transition:background .08s}
.dt tr:hover td{background:var(--raised)}
.dt td:first-child{white-space:nowrap}
.dt td:last-child,.dt th:last-child{word-break:break-word}

.sev{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.sev-critical{color:var(--red)}
.sev-high{color:var(--amber)}
.sev-medium{color:var(--muted)}
.sev-low,.sev-info{color:var(--faint)}

.lock-ttl{font-variant-numeric:tabular-nums}
.lock-ttl.exp{color:var(--red)}
.var-key{color:var(--teal);font-weight:500}
.var-val{color:var(--muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.msg-t{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--faint)}
.msg-t.finding{color:var(--red)}
.msg-t.task{color:var(--amber)}
.msg-t.handoff{color:var(--purple)}
.msg-t.question{color:var(--blue)}

.spec-st{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:2px 6px;border-radius:2px}
.spec-proposed{color:var(--amber);background:var(--amber-m)}
.spec-approved{color:var(--green);background:var(--green-m)}
.spec-withdrawn{color:var(--faint);opacity:.6}
.spec-type{font-size:.65rem;color:var(--muted);text-transform:lowercase}
.spec-content{font-family:var(--mono);font-size:.78rem;color:var(--muted);max-height:60px;overflow:hidden;white-space:pre-wrap;word-break:break-word;margin:0;padding:0}

.tab-empty{flex:1;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.88rem;color:var(--ghost)}
.tw{padding:12px 16px;flex:1;overflow-y:auto}

/* ── Status bar ── */
.sbar{height:26px;display:flex;align-items:center;padding:0 20px;background:var(--surface);border-top:1px solid var(--border);font-family:var(--mono);font-size:.72rem;color:var(--faint);overflow:hidden;flex-shrink:0}
.sbar-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── Toast ── */
.toast-area{position:fixed;top:48px;right:12px;z-index:100;display:flex;flex-direction:column;gap:3px;pointer-events:none}
.toast{font-family:var(--mono);font-size:.78rem;padding:7px 12px;background:var(--surface);border:1px solid var(--border);border-radius:2px;color:var(--muted);pointer-events:auto;animation:tIn .15s ease}
.toast.out{animation:tOut .15s ease forwards}
@keyframes tIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@keyframes tOut{from{opacity:1}to{opacity:0}}
@media(prefers-reduced-motion:reduce){.toast{animation:none!important}}

/* ── Mobile ── */
@media(max-width:768px){
  .sidebar{display:none}
  .mobile-bar{display:flex!important}
  .ws-name{display:none}
}
.mobile-bar{display:none;padding:8px 16px;gap:16px;background:var(--surface);border-bottom:1px solid var(--border);font-family:var(--mono);font-size:.78rem;color:var(--muted);overflow-x:auto;flex-shrink:0}
.m-stat{display:flex;align-items:center;gap:4px;white-space:nowrap}
.m-val{color:var(--ink);font-weight:600}
</style>
</head>
<body>

<div class="toast-area" id="toasts"></div>

<div class="topbar" id="topbar">
  <span class="brand">InTandem</span>
  <span class="sep">/</span>
  <span class="ws-name" id="wsName">${escaped}</span>
  <span class="code" id="joinCode" tabindex="0" role="button" title="Click to copy"></span>
  <span class="flex1"></span>
  <div class="topbar-r">
    <span class="uptime" id="uptime">00:00</span>
    <div class="conn" id="conn">
      <span class="conn-dot"></span>
      <span id="connText">connecting</span>
    </div>
    <button class="theme-btn" id="themeBtn" aria-label="Toggle theme">\\u25D1</button>
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
      <div class="sb-lbl">Connections <span class="sb-lbl-v" id="peerLbl">0 / 5</span></div>
      <div class="peer-list" id="peerList"></div>
    </div>
    <div class="sb-sec">
      <div class="sb-lbl">Overview</div>
      <div class="stat-list">
        <div class="stat-row"><span class="stat-lbl">Active tasks</span><span class="stat-val" id="sT">0</span></div>
        <div class="stat-row"><span class="stat-lbl">File locks</span><span class="stat-val" id="sL">0</span></div>
        <div class="stat-row"><span class="stat-lbl">Findings</span><span class="stat-val" id="sF">0</span></div>
        <div class="stat-row"><span class="stat-lbl">Shared vars</span><span class="stat-val" id="sV">0</span></div>
        <div class="stat-row"><span class="stat-lbl">Specs</span><span class="stat-val" id="sSp">0</span></div>
        <div class="stat-row"><span class="stat-lbl">Messages</span><span class="stat-val" id="sM">0</span></div>
      </div>
    </div>
  </aside>

  <div class="main">
    <div class="tab-bar" role="tablist">
      <button class="tab-btn active" data-tab="activity" role="tab" aria-selected="true">Activity <span class="tab-ct" id="tcA">0</span></button>
      <button class="tab-btn" data-tab="tasks" role="tab" aria-selected="false">Tasks <span class="tab-ct" id="tcT">0</span></button>
      <button class="tab-btn" data-tab="locks" role="tab" aria-selected="false">Locks <span class="tab-ct" id="tcL">0</span></button>
      <button class="tab-btn" data-tab="findings" role="tab" aria-selected="false">Findings <span class="tab-ct" id="tcF">0</span></button>
      <button class="tab-btn" data-tab="specs" role="tab" aria-selected="false">Specs <span class="tab-ct" id="tcSp">0</span></button>
      <button class="tab-btn" data-tab="vars" role="tab" aria-selected="false">Vars <span class="tab-ct" id="tcV">0</span></button>
      <button class="tab-btn" data-tab="messages" role="tab" aria-selected="false">Messages <span class="tab-ct" id="tcM">0</span></button>
    </div>

    <div class="tab-panel active" id="panelActivity" role="tabpanel">
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

<div class="sbar"><span class="sbar-text" id="sbarText">ready</span></div>

<script>
(function(){
  let state={workspace:null,peers:[],tasks:[],locks:[],findings:[],specs:[],vars:[],activity:[],messages:[]};
  let ws=null,reconnectDelay=1000,reconnectTimer=null,lostTimer=null,startedAt=Date.now();

  const $=id=>document.getElementById(id);
  const esc=s=>{const d=document.createElement('div');d.textContent=s;return d.innerHTML};

  const peerColors=['#60a5fa','#34d399','#fbbf24','#a78bfa','#f87171','#38bdf8','#fb923c','#e879f9'];
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
    navigator.clipboard.writeText(t).then(()=>{
      el.classList.add('copied');const o=el.textContent;
      el.textContent='copied';
      setTimeout(()=>{el.textContent=o;el.classList.remove('copied')},1200);
    });
  }
  $('joinCode').onclick=function(){copyCode(this)};
  $('joinCode').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();copyCode(this)}};

  // Tabs
  const tabBtns=document.querySelectorAll('.tab-btn');
  const tabPanels=document.querySelectorAll('.tab-panel');
  function switchTab(name){
    tabBtns.forEach(b=>{
      const on=b.dataset.tab===name;
      b.classList.toggle('active',on);
      b.setAttribute('aria-selected',String(on));
    });
    tabPanels.forEach(p=>p.classList.toggle('active',p.id==='panel'+name.charAt(0).toUpperCase()+name.slice(1)));
  }
  tabBtns.forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

  // Uptime
  setInterval(()=>{
    const s=Math.floor((Date.now()-startedAt)/1000);
    const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    $('uptime').textContent=(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
  },1000);

  // Toast
  function toast(text){
    const c=$('toasts'),t=document.createElement('div');
    t.className='toast';t.textContent=text;c.appendChild(t);
    setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),150)},2500);
  }

  function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
  function dur(ms){
    const s=Math.floor(ms/1000);
    if(s<60)return s+'s';
    if(s<3600)return Math.floor(s/60)+'m';
    return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
  }

  // Render: Peers
  function renderPeers(){
    const list=$('peerList');
    if(!state.peers.length){
      list.innerHTML='<div class="sb-empty">Waiting for connections</div>';
    }else{
      list.innerHTML=state.peers.map(p=>{
        const c=colorFor(p.username);
        return '<div class="peer-row"><span class="peer-dot" style="background:'+c+'"></span>'+
          '<span class="peer-name">'+esc(p.username)+'</span>'+
          '<span class="peer-time">'+dur(Date.now()-p.connectedAt)+'</span></div>';
      }).join('');
    }
    const max=state.workspace?.maxPeers||5;
    $('peerLbl').textContent=state.peers.length+' / '+max;
    $('mPeers').textContent=state.peers.length+'/'+max;
  }

  // Render: Stats
  function renderStats(){
    const active=state.tasks.filter(t=>t.status!=='done').length;
    $('sT').textContent=active;
    $('sL').textContent=state.locks.length;
    $('sF').textContent=state.findings.length;
    $('sSp').textContent=state.specs.length;
    $('sV').textContent=state.vars.length;
    $('sM').textContent=state.messages.length;
    $('tcA').textContent=state.activity.length;
    $('tcT').textContent=state.tasks.length;
    $('tcL').textContent=state.locks.length;
    $('tcF').textContent=state.findings.length;
    $('tcSp').textContent=state.specs.length;
    $('tcV').textContent=state.vars.length;
    $('tcM').textContent=state.messages.length;
    $('mTasks').textContent=active;
    $('mLocks').textContent=state.locks.length;
    $('mFindings').textContent=state.findings.length;
    $('mSpecs').textContent=state.specs.length;
  }

  // Render: Activity
  function renderActivity(){
    const feed=$('activityFeed');
    if(!state.activity.length){
      feed.innerHTML='<div class="tab-empty">No activity yet</div>';
    }else{
      feed.innerHTML=state.activity.map(e=>{
        const cls=e.actor==='system'?' sys':'';
        const txt=e.action+(e.detail?' '+e.detail:'');
        const hi=esc(txt).replace(/\\[([^\\]]+)\\]/g,'<span class="hl">[$1]</span>');
        return '<div class="feed-row"><span class="feed-ts">'+fmtTime(e.timestamp)+'</span>'+
          '<span class="feed-who'+cls+'">'+esc(e.actor)+'</span>'+
          '<span class="feed-what">'+hi+'</span></div>';
      }).join('');
      feed.scrollTop=feed.scrollHeight;
    }
  }

  // Render: Tasks
  function renderTasks(){
    const bk={open:[],blocked:[],claimed:[],in_progress:[],done:[]};
    for(const t of state.tasks)(bk[t.status]||bk.open).push(t);

    function card(t){
      let h='<div class="t-card '+t.status+(t.status==='blocked'?' blocked':'')+'">';
      h+='<div class="t-title">'+esc(t.title)+'</div><div class="t-meta">';
      if(t.priority)h+='<span class="t-pri '+t.priority+'">'+t.priority+'</span>';
      if(t.assignee)h+='<span class="t-who">'+esc(t.assignee)+'</span>';
      h+='</div>';
      if(t.result&&t.status==='done')h+='<div class="t-res">'+esc(t.result.length>100?t.result.slice(0,100)+'...':t.result)+'</div>';
      return h+'</div>';
    }

    const empty='<span class="k-empty">No tasks</span>';
    function col(id,items,dot,label){
      $(id).innerHTML='<div class="k-hdr"><span class="k-dot" style="background:'+dot+'"></span>'+label+
        '<span class="k-cnt">'+items.length+'</span></div>'+(items.map(card).join('')||empty);
    }

    const openAll=[...bk.open,...bk.blocked];
    col('colOpen',openAll,'var(--muted)','Open');
    col('colClaimed',bk.claimed,'var(--blue)','Claimed');
    col('colProgress',bk.in_progress,'var(--amber)','In Progress');
    col('colDone',bk.done,'var(--green)','Done');
  }

  // Render: Locks
  function renderLocks(){
    if(!state.locks.length){$('locksW').innerHTML='<div class="tab-empty">No active file locks</div>';return}
    let h='<table class="dt"><thead><tr><th>File</th><th>Locked By</th><th>TTL</th></tr></thead><tbody>';
    for(const l of state.locks){
      const rem=Math.max(0,l.expiresAt-Date.now());
      h+='<tr><td>'+esc(l.filePath)+'</td><td>'+esc(l.lockedBy)+'</td><td class="lock-ttl'+(rem<60000?' exp':'')+'">'+dur(rem)+'</td></tr>';
    }
    $('locksW').innerHTML=h+'</tbody></table>';
  }

  // Render: Findings
  function renderFindings(){
    if(!state.findings.length){$('findingsW').innerHTML='<div class="tab-empty">No findings reported</div>';return}
    let h='<table class="dt"><thead><tr><th>Severity</th><th>Service</th><th>Summary</th><th>By</th></tr></thead><tbody>';
    for(const f of state.findings){
      h+='<tr><td><span class="sev sev-'+f.severity+'">'+f.severity+'</span></td><td>'+esc(f.service)+'</td><td>'+esc(f.summary)+'</td><td>'+esc(f.reportedBy)+'</td></tr>';
    }
    $('findingsW').innerHTML=h+'</tbody></table>';
  }

  // Render: Vars
  function renderVars(){
    if(!state.vars.length){$('varsW').innerHTML='<div class="tab-empty">No shared variables</div>';return}
    let h='<table class="dt"><thead><tr><th>Key</th><th>Value</th><th>Set By</th></tr></thead><tbody>';
    for(const v of state.vars){
      h+='<tr><td class="var-key">'+esc(v.key)+'</td><td class="var-val" title="'+esc(v.value)+'">'+esc(v.value)+'</td><td>'+esc(v.setBy)+'</td></tr>';
    }
    $('varsW').innerHTML=h+'</tbody></table>';
  }

  // Render: Messages
  function renderMessages(){
    if(!state.messages.length){$('msgsW').innerHTML='<div class="tab-empty">No recent messages</div>';return}
    let h='<table class="dt"><thead><tr><th>Time</th><th>Type</th><th>From</th><th>Content</th></tr></thead><tbody>';
    for(const m of state.messages){
      const tc=['finding','task','handoff','question'].includes(m.type)?' '+m.type:'';
      h+='<tr><td>'+fmtTime(m.timestamp)+'</td><td><span class="msg-t'+tc+'">'+esc(m.type)+'</span></td><td>'+esc(m.from)+'</td><td>'+esc(m.content.length>180?m.content.slice(0,180)+'\\u2026':m.content)+'</td></tr>';
    }
    $('msgsW').innerHTML=h+'</tbody></table>';
  }

  // Render: Specs
  function renderSpecs(){
    if(!state.specs.length){$('specsW').innerHTML='<div class="tab-empty">No specs proposed</div>';return}
    let h='<table class="dt"><thead><tr><th>ID</th><th>Status</th><th>Type</th><th>Name</th><th>By</th><th>Ver</th><th>Reviews</th></tr></thead><tbody>';
    for(const s of state.specs){
      const reviews=s.reviews&&s.reviews.length?s.reviews.map(r=>esc(r.reviewer)+': '+r.vote).join(', '):'none';
      h+='<tr><td>'+esc(s.id)+'</td><td><span class="spec-st spec-'+s.status+'">'+s.status+'</span></td><td><span class="spec-type">'+esc(s.specType)+'</span></td><td>'+esc(s.name)+'</td><td>'+esc(s.proposedBy)+'</td><td>v'+s.version+'</td><td>'+esc(reviews)+'</td></tr>';
    }
    $('specsW').innerHTML=h+'</tbody></table>';
  }

  function renderAll(){
    renderPeers();renderStats();renderActivity();renderTasks();
    renderLocks();renderFindings();renderSpecs();renderVars();renderMessages();
    if(state.workspace?.inviteCode){
      const el=$('joinCode');
      el.textContent=state.workspace.inviteCode;
      el.setAttribute('data-code',state.workspace.inviteCode);
      el.style.display='inline';
    }
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
        $('wsName').textContent=msg.workspace.name;
        renderAll();sbar('synced with hub');
        break;
      case 'peer_joined':{
        if(!state.peers.find(p=>p.username===msg.username))
          state.peers.push({username:msg.username,connectedAt:Date.now(),lastActiveAt:Date.now()});
        renderPeers();renderStats();
        toast(msg.username+' joined');sbar(msg.username+' joined');
        break;
      }
      case 'peer_left':{
        state.peers=state.peers.filter(p=>p.username!==msg.username);
        renderPeers();renderStats();
        toast(msg.username+' left');sbar(msg.username+' left');
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
      case 'finding_broadcast':
        state.findings.push(msg.finding);renderFindings();renderStats();
        toast('finding: '+msg.finding.summary.slice(0,40));break;
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
        renderActivity();renderStats();
        sbar(msg.entry.actor+' '+msg.entry.action+(msg.entry.detail?' '+msg.entry.detail:''));
        break;
      case 'message':
        if(msg.payload){
          state.messages.push(msg.payload);
          if(state.messages.length>100)state.messages=state.messages.slice(-50);
          renderMessages();renderStats();
        }
        break;
    }
  }

  setInterval(()=>{renderPeers();renderLocks()},10000);
  connect();
})();
</script>
</body>
</html>`;
}

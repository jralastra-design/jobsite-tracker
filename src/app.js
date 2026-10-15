import { db, fs, onSync, onSnapshot, collection, doc, query, where } from './fb.js';
import { vAdmin, adminAct } from './admin.js';
let HOOKS = {}, SYNC = { pending:0, online:true };
const CATS = ['CMU','Brick','Stone','Rebar','Accessories','Other'];
const catIdx = c => { const i = CATS.indexOf(c); return i < 0 ? 99 : i; };
const WT = {'#3':.376,'#4':.668,'#5':1.043,'#6':1.502,'#7':2.044,'#8':2.670,'#9':3.400};
const REASONS = {waste:'Waste / broken / cutoffs', returned:'Returned to supplier', 'xfer-out':'Transferred to another job', 'xfer-in':'Transferred in from another job'};
const TABS = [
  ['status','Status','<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['log','Log','<path d="M3 20h18M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>'],
  ['count','Count','<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
  ['orders','Orders','<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>'],
  ['reports','Reports','<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>'],
  ['admin','Admin','<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'],
  ['setup','Setup','<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>']
];
function tabsFor(){
  const r = ME?.role;
  if(r==='admin') return ['status','log','count','orders','reports','setup','admin'];
  if(r==='pm') return ['status','log','count','orders','reports','setup'];
  if(r==='counter') return ['status','log','count','orders','reports'];
  return ['status','orders','reports'];
}
function renderSync(){
  const el = document.getElementById('syncChip'); if(!el) return;
  const off = !SYNC.online, n = SYNC.pending;
  el.className = 'sync ' + (off ? 'off' : n ? 'busy' : 'ok');
  el.textContent = off ? (n ? `Offline · ${n} to sync` : 'Offline') : (n ? `Syncing ${n}` : 'Synced');
  el.title = off ? 'No connection. Entries are saved on this phone and upload when signal returns.' : n ? 'Uploading changes' : 'All changes saved to the server';
}
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const nowHM = () => { const d=new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const stamp = date => date === today() ? `${date}T${nowHM()}` : `${date}T12:00`;
const PROD_TIME = 'T17:00';
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fDate = s => { if(!s) return '—'; const [y,m,d]=s.slice(0,10).split('-'); return `${MON[+m-1]} ${+d}`; };
const daysSince = s => { if(!s) return null; const a=new Date(s.slice(0,10)+'T00:00'); const b=new Date(today()+'T00:00'); return Math.round((b-a)/864e5); };
const ago = s => { const n=daysSince(s); return n==null?'':n===0?'today':n===1?'yesterday':`${n} days ago`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const has = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const fmt = n => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
const sgn = n => n == null || !Number.isFinite(n) ? '—' : (Math.round(n) > 0 ? '+' : '') + fmt(n);
const pct = (n, d=0) => n == null || !Number.isFinite(n) ? '—' : (n*100).toFixed(d) + '%';
const spct = n => n == null || !Number.isFinite(n) ? '—' : (n > 0 ? '+' : '') + Math.round(n*100) + '%';
const ratioTxt = r => r == null ? '—' : r >= 1 ? r.toFixed(2) : r >= .01 ? r.toFixed(4) : r.toFixed(5);
const ftin = inches => { if(!inches) return ''; const f=Math.floor(inches/12), i=Math.round(inches-f*12); return `${f}'-${i}"`; };
const parseLen = s => { s=String(s||'').trim(); if(!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:-|\s)?\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i);
  if(!m) return null; return Math.round(num(m[1])*12 + num(m[2]||0)); };
const slug = s => (String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'x') + '-' + Math.random().toString(36).slice(2,6);
const byAt = (a,b) => a.at<b.at?-1:a.at>b.at?1:0;
const inWin = (at,a,b) => (!a || at > a) && (!b || at <= b);

const COLS = ['items','counts','deliveries','orders','groups','production','usage'];
const S = { tab:'status', pid:null, projects:[], loaded:false, noDb:false, pendingRender:false, confirm:null, sheetRedraw:null,
  draft:{date:today(), by:'', note:'', qty:{}}, logMode:'prod', recWin:'all',
  prodDraft:{groupId:'', date:today(), mode:'units', qty:'', note:''} };
for(const n of COLS) S[n]=[];
S.voided={};
let unsubs=[], projUnsubs=[], ME=null, UID=null;
const can = { get admin(){ return ME?.role==='admin'; }, get manage(){ return ['admin','pm'].includes(ME?.role); }, get field(){ return ['admin','pm','counter'].includes(ME?.role); } };

function store(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function recall(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function proj(){ return S.projects.find(p=>p.id===S.pid) || null; }

/* ---------- settings ---------- */
function settings(){
  const p = proj() || {};
  const waste = p.waste || {};
  return { wasteOn: !!p.wasteOn, basis: p.basis === 'gross' ? 'gross' : 'net',
    rate: cat => p.wasteOn ? num(waste[cat] ?? waste.Other ?? 0)/100 : 0,
    rawRate: cat => num(waste[cat] ?? 0), thr: has(p.threshold) ? num(p.threshold)/100 : 0.05 };
}

/* ---------- math ---------- */
function model(){
  const ST = settings();
  const counts = [...S.counts].sort(byAt), dels = [...S.deliveries].sort(byAt);
  const usage = [...S.usage].sort(byAt), prod = [...S.production].sort(byAt);
  const groups = [...S.groups].sort((a,b)=>String(a.name).localeCompare(b.name));

  // orders and receiving
  const recByOrder = {}, rejByOrder = {};
  for(const d of dels){ if(!d.orderId) continue;
    const r = recByOrder[d.orderId] ||= {}; for(const [k,v] of Object.entries(d.lines||{})) r[k]=(r[k]||0)+num(v);
    const j = rejByOrder[d.orderId] ||= {}; for(const [k,v] of Object.entries(d.rejected||{})) j[k]=(j[k]||0)+num(v); }
  const onOrder = {};
  const orders = S.orders.map(o=>{
    const rec = recByOrder[o.id]||{}, rej = rejByOrder[o.id]||{};
    let any=false, all=true;
    const lines = (o.lines||[]).map(l=>{ const got = rec[l.itemId]||0, bad = rej[l.itemId]||0, rem = Math.max(0, num(l.qty)-got);
      if(got>0) any=true; if(rem>0) all=false;
      if(!o.closed && rem>0) onOrder[l.itemId]=(onOrder[l.itemId]||0)+rem;
      return {...l, got, bad, rem}; });
    const status = o.closed ? 'Closed' : all && lines.length ? 'Received' : any ? 'Partial' : 'Open';
    const late = !o.closed && !all && o.needBy && o.needBy < today();
    return {...o, lines, status, late};
  }).sort((a,b)=> (a.status==='Received'||a.status==='Closed') - (b.status==='Received'||b.status==='Closed') || (b.ordered||'').localeCompare(a.ordered||''));

  // takeoff quantities, waste allowance, ratios
  const base = S.items.map(it=>{
    const w = ST.rate(it.cat||'Other'); const req = has(it.required) ? num(it.required) : null;
    let net=null, gross=null;
    if(req!=null){ if(!ST.wasteOn){ net=gross=req; } else if(ST.basis==='net'){ net=req; gross=req*(1+w); } else { gross=req; net=req/(1+w); } }
    return {it, w, req, net, gross};
  });
  const gIds = new Set(groups.map(g=>g.id));
  const gTot = {};
  for(const x of base) if(gIds.has(x.it.group) && x.it.role==='primary' && x.net!=null) gTot[x.it.group]=(gTot[x.it.group]||0)+x.net;
  for(const x of base){
    x.gid = gIds.has(x.it.group) && (x.it.role==='primary'||x.it.role==='secondary') ? x.it.group : null;
    x.auto = x.gid && gTot[x.gid] && x.net!=null ? x.net/gTot[x.gid] : null;
    x.ratio = x.gid ? (has(x.it.ratio) ? num(x.it.ratio) : x.auto) : null;
  }

  const prodSum = (gid,a,b) => prod.reduce((s,e)=> e.groupId===gid && inWin(e.at,a,b) ? s+num(e.qty) : s, 0);
  const flows = (id,a,b) => { let recv=0, waste=0, out=0, inn=0;
    for(const d of dels) if(d.lines && has(d.lines[id]) && inWin(d.at,a,b)) recv+=num(d.lines[id]);
    for(const u of usage) if(u.itemId===id && inWin(u.at,a,b)){ const q=num(u.qty);
      if(u.reason==='waste') waste+=q; else if(u.reason==='xfer-in') inn+=q; else out+=q; }
    return {recv, waste, out, inn, net: recv+inn-out}; };
  const recon = (x, A, B) => { // A,B: {at, q}
    const f = flows(x.it.id, A.at, B.at);
    const consumed = A.q + f.net - B.q, installed = consumed - f.waste;
    const expected = x.ratio!=null ? prodSum(x.gid, A.at, B.at)*x.ratio : null;
    const variance = expected!=null ? installed-expected : null;
    return {from:A.at, to:B.at, open:A.q, close:B.q, ...f, consumed, installed, expected, variance,
      varPct: expected>0 ? variance/expected : null, wastePct: installed>0 ? f.waste/installed : null};
  };

  const items = base.sort((a,b)=> catIdx(a.it.cat)-catIdx(b.it.cat) || num(a.it.sort)-num(b.it.sort) || String(a.it.name).localeCompare(b.it.name))
  .map(x=>{
    const it=x.it, r = {...x, onOrder:onOrder[it.id]||0, pre: has(it.preInstalled)?num(it.preInstalled):null};
    r.lfPer = it.lengthIn ? it.lengthIn/12 : null; r.wtPer = r.lfPer && WT[it.bar] ? r.lfPer*WT[it.bar] : null;
    r.history = counts.filter(c=>c.qty && has(c.qty[it.id])).map(c=>({at:c.at, q:num(c.qty[it.id]), by:c.by, id:c.id}));
    r.dels = dels.filter(d=>d.lines && has(d.lines[it.id])).map(d=>({...d, q:num(d.lines[it.id]), bad:num((d.rejected||{})[it.id])}));
    r.uses = usage.filter(u=>u.itemId===it.id);
    r.counted = r.history.length>0;
    if(!r.counted) return r;
    const O=r.history[0], L=r.history[r.history.length-1];
    r.openAt=O.at; r.openQty=O.q; r.lastAt=L.at; r.lastQty=L.q;
    r.all = recon(r, O, L);
    r.last = r.history.length>1 ? recon(r, r.history[r.history.length-2], L) : null;
    const after = flows(it.id, L.at, null), since = flows(it.id, O.at, null);
    r.expAfter = r.ratio!=null ? prodSum(r.gid, L.at, null)*r.ratio : 0;
    r.onHandCount = L.q + after.net - after.waste;
    r.onHand = r.onHandCount - r.expAfter;
    r.recvAfter = after.net; r.wasteAfter = after.waste;
    const pre = r.pre ?? 0;
    r.delivered = pre + O.q + since.net;
    r.installed = pre + r.all.installed;
    r.installedProd = r.ratio!=null ? pre + prodSum(r.gid, O.at, null)*r.ratio : null;
    r.wasteTotal = since.waste;
    if(r.net!=null){
      r.balDeliver = r.gross - r.delivered;
      r.balInstall = r.net - r.installed;
      r.balInstallProd = r.installedProd!=null ? r.net - r.installedProd : null;
      r.pct = r.net>0 ? r.installed/r.net : 0;
      r.toOrder = r.balDeliver - r.onOrder;
    }
    r.flag = r.all.varPct!=null && Math.abs(r.all.varPct) > ST.thr && r.all.expected >= 20;
    return r;
  });

  // production summary per group
  const firstCount = counts[0]?.at || null;
  const gsum = groups.map(g=>{
    const ents = prod.filter(e=>e.groupId===g.id);
    const base = ents.filter(e=>inWin(e.at, firstCount, null));
    const days = new Set(base.map(e=>e.at.slice(0,10)));
    const total = base.reduce((s,e)=>s+num(e.qty),0);
    const prim = items.filter(r=>r.gid===g.id && r.it.role==='primary');
    const netTot = prim.reduce((s,r)=>s+(r.net||0),0), preTot = prim.reduce((s,r)=>s+(r.pre||0),0);
    const remaining = netTot ? netTot - preTot - total : null;
    const byDay = {}; for(const e of base){ const d=e.at.slice(0,10); byDay[d]=(byDay[d]||0)+num(e.qty); }
    const dayList = Object.entries(byDay).sort((a,b)=>a[0]<b[0]?-1:1);
    const recent = dayList.slice(-5); const avg5 = recent.length ? recent.reduce((s,d)=>s+d[1],0)/recent.length : null;
    return {g, ents, total, days:days.size, avg: days.size ? total/days.size : null, avg5, remaining,
      daysLeft: remaining!=null && avg5 ? remaining/avg5 : null, dayList, last: ents[ents.length-1], prim, netTot,
      secondary: items.filter(r=>r.gid===g.id && r.it.role==='secondary')};
  });
  return {items, orders, counts, dels, usage, prod, groups, gsum, ST, firstCount};
}

function orderChip(r){
  if(r.net==null) return ['neutral','Set qty'];
  if(!r.counted) return ['neutral','Not counted'];
  if(r.balDeliver < -0.5) return ['bad',`Over ${fmt(-r.balDeliver)}`];
  if(Math.round(r.balDeliver) <= 0) return ['ok','All delivered'];
  if(r.toOrder >= 0.5) return ['warn',`Order ${fmt(r.toOrder)}`];
  return ['acc',`${fmt(r.onOrder)} on order`];
}

/* ---------- views ---------- */
function vStatus(M){
  const p = proj();
  if(!M.items.length) return emptyItems();
  const lastCount = M.counts[M.counts.length-1];
  const needOrder = M.items.filter(r=>r.toOrder>=0.5).length;
  const openOrders = M.orders.filter(o=>o.status==='Open'||o.status==='Partial');
  const late = openOrders.filter(o=>o.late).length;
  const flags = M.items.filter(r=>r.flag).length;
  const lc = lastCount ? daysSince(lastCount.at) : null;
  let h = sampleBanner(p);
  h += `<div class="summary">
    <div><div class="v ${lc==null?'':lc>7?'bad':lc>3?'warn':''}">${lastCount?fDate(lastCount.at):'—'}</div><div class="k">Last count${lastCount?' · '+ago(lastCount.at):''}</div></div>
    <div><div class="v ${needOrder?'warn':''}">${needOrder}</div><div class="k">Items to order</div></div>
    <div><div class="v ${late?'bad':''}">${openOrders.length}</div><div class="k">Open orders${late?` · ${late} late`:''}</div></div>
  </div>`;
  for(const G of M.gsum) h += prodCard(G);
  if(flags) h += `<div class="banner"><b>${flags} material${flags>1?'s':''} off the takeoff mix.</b> Actual use since the opening count differs from production × takeoff ratio by more than ${pct(M.ST.thr)}. Check Reports › Reconciliation.</div>`;
  h += `<div class="legend"><span><i style="background:var(--installed)"></i>Installed</span><span><i style="background:var(--onhand)"></i>On hand</span><span><i style="background:var(--track)"></i>Still to deliver</span>${M.ST.wasteOn?'<span>Bars measured against required incl. waste</span>':''}</div>`;
  for(const cat of catsOf(M.items)){
    h += `<section class="group"><h2>${esc(cat)}</h2><div class="list">`;
    for(const r of M.items.filter(x=>(x.it.cat||'Other')===cat)) h += itemRow(r);
    h += `</div></section>`;
  }
  return h;
}
function prodCard(G){
  const u = esc(G.g.unit||'units');
  const pts = G.dayList.slice(-14);
  let spark = '';
  if(pts.length>1){
    const max = Math.max(...pts.map(p=>p[1]))*1.1 || 1, W=300, H=46;
    const xs = i => 4 + i*(W-8)/(pts.length-1), ys = v => H-4 - (v/max)*(H-10);
    const line = pts.map((p,i)=>`${i?'L':'M'}${xs(i).toFixed(1)},${ys(p[1]).toFixed(1)}`).join('');
    const area = line + `L${xs(pts.length-1).toFixed(1)},${H-2}L${xs(0).toFixed(1)},${H-2}Z`;
    const lp = pts[pts.length-1];
    spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily ${u} laid, last ${pts.length} work days">
      <path d="${area}" fill="var(--accent-soft)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <circle cx="${xs(pts.length-1)}" cy="${ys(lp[1])}" r="3.5" fill="var(--accent)"/></svg>`;
  }
  return `<section class="panel pad stack">
    <div class="spread"><div><div class="eyebrow">Production</div><h2 style="font-size:22px">${esc(G.g.name)}</h2></div>
    ${can.field&&!proj()?.closed?'<button class="btn sm primary" data-act="tab" data-tab="log">Log today</button>':''}</div>
    <div class="prod">
      <div><div class="v">${fmt(G.avg5)}</div><div class="k">${u}/day, last ${Math.min(5,G.dayList.length)} days</div></div>
      <div><div class="v">${fmt(G.total)}</div><div class="k">${u} since first count · ${G.days} days</div></div>
      <div><div class="v">${fmt(G.remaining)}</div><div class="k">${u} left${G.daysLeft!=null?` · ~${Math.ceil(G.daysLeft)} work days`:''}</div></div>
    </div>${spark}
    <div class="small muted">${G.last?`Last entry ${fDate(G.last.at)} · ${fmt(num(G.last.qty))} ${u}`:'No production logged yet.'} Drives ${G.prim.length} primary and ${G.secondary.length} secondary materials by takeoff ratio.</div>
  </section>`;
}
function catsOf(items){ const seen=[]; for(const r of items){ const c=r.it.cat||'Other'; if(!seen.includes(c)) seen.push(c);} return seen; }
function itemMeta(it){ const bits=[it.unit||'EA']; if(it.lengthIn) bits.push(`${ftin(it.lengthIn)} pcs`); return bits.join(' · '); }
function itemRow(r){
  const [cls,label]=orderChip(r);
  const tot = r.gross||0;
  const insW = tot && r.counted ? Math.max(0,Math.min(100, r.installed/tot*100)) : 0;
  const ohW = tot && r.counted ? Math.max(0,Math.min(100-insW, r.onHand/tot*100)) : 0;
  const mix = r.flag ? `<span class="chip warn" title="Actual vs production-based use">Mix ${spct(r.all.varPct)}</span>` : '';
  return `<button class="item" data-act="item" data-id="${esc(r.it.id)}">
    <div class="spread"><div style="min-width:0"><div class="name">${esc(r.it.name)}</div><div class="meta">${esc(itemMeta(r.it))}${r.lastAt?` · counted ${fDate(r.lastAt)}`:''}${r.it.role==='primary'?' · primary':r.it.role==='secondary'?' · by ratio':''}</div></div><span class="chips">${mix}<span class="chip ${cls}">${label}</span></span></div>
    <div class="bar" role="img" aria-label="${fmt(r.installed)} installed, ${fmt(r.onHand)} on hand of ${fmt(r.gross)} required"><i class="ins" style="width:${insW}%"></i><i class="oh" style="left:${insW}%;width:${ohW}%"></i></div>
    <div class="nums">
      <div><div class="k">On hand${r.expAfter>=1?' (est.)':''}</div><div class="v">${fmt(r.onHand)}</div></div>
      <div><div class="k">To deliver</div><div class="v">${fmt(r.balDeliver)}</div></div>
      <div><div class="k">To install</div><div class="v">${fmt(r.balInstall)}</div></div>
    </div></button>`;
}
function sampleBanner(p){
  return p && p.sample ? `<div class="banner"><b>Sample numbers.</b> Required quantities, counts, production and orders here are made-up examples so you can see the math. Replace them in Setup, or clear them there and enter your takeoff and today's count.</div>` : '';
}
function emptyItems(){
  return `<div class="panel empty"><h2>No materials yet</h2><p>Add the materials you track for this job in Setup, then take your first count.</p><button class="btn primary" data-act="tab" data-tab="setup">Go to Setup</button></div>`;
}

/* Log: production + waste */
function vLog(M){
  if(!M.items.length) return emptyItems();
  let h = `<div class="seg" role="group" aria-label="Log type"><button data-act="logMode" data-mode="prod" aria-pressed="${S.logMode==='prod'}">Production</button><button data-act="logMode" data-mode="use" aria-pressed="${S.logMode==='use'}">Waste &amp; returns</button></div>`;
  if(S.logMode==='prod'){
    if(!M.groups.length) return h + `<div class="panel empty"><h2>No production group yet</h2><p>Set up a group like "Block laid" in Setup and choose which materials it drives.</p><button class="btn primary" data-act="tab" data-tab="setup">Go to Setup</button></div>`;
    const d=S.prodDraft; if(!M.groups.some(g=>g.id===d.groupId)) d.groupId=M.groups[0].id;
    const g=M.groups.find(x=>x.id===d.groupId); const sf = !!g.sfEntry && num(g.perSF)>0; if(!sf) d.mode='units';
    const units = d.mode==='sf' ? Math.round(num(d.qty)*num(g.perSF)) : num(d.qty);
    h += `<section class="panel pad stack">
      <div class="eyebrow">Daily production</div>
      <div class="grid2">${M.groups.length>1?`<label class="f">Production group<select id="pGroup">${M.groups.map(x=>`<option value="${esc(x.id)}" ${x.id===d.groupId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`:''}
      <label class="f">Work date<input type="date" id="pDate" value="${esc(d.date)}"></label></div>
      ${sf?`<div class="seg" role="group" aria-label="Enter by"><button data-act="prodMode" data-mode="units" aria-pressed="${d.mode==='units'}">${esc(cap(g.unit||'Units'))} laid</button><button data-act="prodMode" data-mode="sf" aria-pressed="${d.mode==='sf'}">Wall SF</button></div>`:''}
      <label class="f">${d.mode==='sf'?`Wall area built (SF) · ${num(g.perSF)} ${esc(g.unit||'units')}/SF`:`Total ${esc(g.unit||'units')} laid`}<input class="bigin" type="number" inputmode="decimal" min="0" id="pQty" value="${esc(d.qty)}" placeholder="0"></label>
      <label class="f">Area / location<input id="pNote" value="${esc(d.note)}" placeholder="e.g. Grid C-F, Level 3"></label>
      <div class="formula" id="implied">${impliedHtml(M, g, units)}</div>
      <button class="btn primary" data-act="saveProd">Save production</button>
      <div class="small muted">Production is booked at end of shift. Take counts before work starts or after it ends so each day lands on the right side of the count.</div>
    </section>`;
  } else {
    h += `<section class="panel pad stack">
      <div class="eyebrow">Waste, returns and transfers</div>
      <div class="grid2"><label class="f">Date<input type="date" id="uDate" value="${today()}"></label>
      <label class="f">Reason<select id="uReason">${Object.entries(REASONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <label class="f">Material<select id="uItem">${M.items.map(r=>`<option value="${esc(r.it.id)}">${esc(r.it.name)}</option>`).join('')}</select></label>
      <label class="f">Quantity<input class="bigin" type="number" inputmode="numeric" min="0" id="uQty" placeholder="0"></label>
      <label class="f">Note<input id="uNote" placeholder="e.g. broken in handling, cutoffs from L3 lintels"></label>
      <button class="btn primary" data-act="saveUse">Save entry</button>
      <div class="small muted">Damage found on the truck goes in the Rejected column when you receive the delivery, not here.</div>
    </section>`;
  }
  const nameOf = id => (S.items.find(i=>i.id===id)||{}).name || 'Removed item';
  const ents = [...M.prod.map(e=>({...e,k:'p'})), ...M.usage.map(e=>({...e,k:'u'}))].sort(byAt).reverse().slice(0,40);
  h += `<section class="group"><h2>Recent entries</h2><div class="list">`;
  if(!ents.length) h += `<div class="empty">Nothing logged yet.</div>`;
  for(const e of ents){
    if(e.k==='p'){ const g=M.groups.find(x=>x.id===e.groupId);
      h += `<div class="logrow"><div><div style="font-weight:600">${fDate(e.at)} · ${fmt(num(e.qty))} ${esc(g?.unit||'units')} laid</div><div class="small muted">${esc(g?.name||'Removed group')}${has(e.sf)?` · ${fmt(num(e.sf))} SF`:''}${e.note?' · '+esc(e.note):''}</div></div>${voidBtn('production', e)}</div>`;
    } else {
      h += `<div class="logrow"><div><div style="font-weight:600">${fDate(e.at)} · ${e.reason==='xfer-in'?'+':'−'}${fmt(num(e.qty))} ${esc(nameOf(e.itemId))}</div><div class="small muted">${esc(REASONS[e.reason]||e.reason)}${e.note?' · '+esc(e.note):''}</div></div>${voidBtn('usage', e)}</div>`;
    }
  }
  return h + `</div></section>`;
}
function cap(s){ s=String(s||''); return s.charAt(0).toUpperCase()+s.slice(1); }
function impliedHtml(M, g, units){
  const rows = M.items.filter(r=>r.gid===g.id && r.ratio!=null);
  if(!rows.length) return 'No materials are assigned to this group yet. Assign them in Setup › Production groups.';
  if(!units) return `Enter today's total and the app splits it across ${rows.length} materials by takeoff ratio.`;
  return `<div style="font-weight:600;margin-bottom:4px;color:var(--ink)">Implied use for ${fmt(units)} ${esc(g.unit||'units')}</div><div class="implied">${rows.map(r=>`<span>${esc(r.it.name)}</span><span>${fmt(units*r.ratio)}</span>`).join('')}</div>`;
}

function vCount(M){
  if(!M.items.length) return emptyItems();
  const d=S.draft, n=Object.values(d.qty).filter(has).length;
  let h = `<div class="panel pad stack">
    <div class="eyebrow">New inventory count</div>
    <div class="grid2">
      <label class="f">Count date<input type="date" id="cDate" value="${esc(d.date)}"></label>
      <label class="f">Counted by<input id="cBy" value="${esc(d.by)}" placeholder="Name" autocomplete="name"></label>
    </div>
    <label class="f">Note<input id="cNote" value="${esc(d.note)}" placeholder="e.g. Level 3 stockpile + laydown yard"></label>
    <div class="small muted">Count everything physically on site. Leave a material blank to skip it; it keeps its last count. The estimate shown is last count + deliveries − waste − production use since.</div>
  </div>`;
  for(const cat of catsOf(M.items)){
    h += `<section class="group"><h2>${esc(cat)}</h2><div class="list">`;
    for(const r of M.items.filter(x=>(x.it.cat||'Other')===cat)){
      const v = d.qty[r.it.id] ?? '';
      h += `<div class="countrow"><div style="min-width:0"><div style="font-weight:600">${esc(r.it.name)}</div>
        <div class="small muted">${r.counted?`Last ${fmt(r.lastQty)} · ${fDate(r.lastAt)} · est. now ${fmt(r.onHand)}`:'First count'}</div>
        <div class="conv" data-conv="${esc(r.it.id)}">${conv(r, v)}</div></div>
        <input type="number" inputmode="numeric" min="0" step="1" id="q-${esc(r.it.id)}" data-qty="${esc(r.it.id)}" value="${esc(v)}" placeholder="${esc(r.it.unit||'EA')}" aria-label="${esc(r.it.name)} count"></div>`;
    }
    h += `</div></section>`;
  }
  h += `<div class="savebar"><button class="btn primary block" data-act="saveCount" ${n?'':'disabled'}>Save count${n?` · ${n} item${n>1?'s':''}`:''}</button></div>`;
  return h;
}
function conv(r, v){ if(!has(v) || !r.lfPer) return ''; const lf=num(v)*r.lfPer; return `= ${fmt(lf)} LF${r.wtPer?` · ${fmt(num(v)*r.wtPer)} lb`:''}`; }

function vOrders(M){
  const nameOf = id => (S.items.find(i=>i.id===id)||{}).name || 'Removed item';
  const closed = !!proj()?.closed;
  let h = closed || !can.field ? '' : `<div class="row">${can.manage?'<button class="btn primary" data-act="newOrder">New order</button>':''}<button class="btn" data-act="receive" data-id="">Log delivery</button></div>`;
  h += `<section class="group"><h2>Purchase orders</h2>`;
  if(!M.orders.length) h += `<div class="panel empty">No orders yet. Enter POs as you place them so you can see what's still coming.</div>`;
  for(const o of M.orders){
    const chip = o.status==='Received'?'ok':o.status==='Closed'?'neutral':o.late?'bad':o.status==='Partial'?'warn':'acc';
    h += `<article class="panel pad order" style="margin-bottom:10px">
      <div class="spread"><div style="min-width:0"><h3>${esc(o.po||'No PO #')}</h3><div class="small muted">${esc(o.supplier||'Supplier not set')}</div></div>
      <span class="chip ${chip}">${o.late?'Late · ':''}${o.status}</span></div>
      <div class="small muted" style="margin-top:4px">Ordered ${fDate(o.ordered)}${o.needBy?` · need by ${fDate(o.needBy)}`:''}${o.note?` · ${esc(o.note)}`:''}</div>
      <div class="lines">${o.lines.map(l=>`<div class="ln"><span>${esc(nameOf(l.itemId))}${l.bad?` <span class="chip bad">${fmt(l.bad)} rejected</span>`:''}</span><span><b>${fmt(l.got)}</b> / ${fmt(l.qty)}</span><div class="mini"><i style="width:${Math.min(100,num(l.qty)?l.got/num(l.qty)*100:0)}%"></i></div></div>`).join('')}</div>
      <div class="row" style="margin-top:12px">
        ${!closed&&can.field&&(o.status==='Open'||o.status==='Partial')?`<button class="btn sm primary" data-act="receive" data-id="${esc(o.id)}">Receive</button>`:''}
        ${can.manage&&!closed?`<button class="btn sm" data-act="editOrder" data-id="${esc(o.id)}">Edit</button>`:''}
        ${can.manage&&!closed&&o.status==='Partial'?`<button class="btn sm" data-act="closeOrder" data-id="${esc(o.id)}">Close short</button>`:''}
        ${can.manage&&!closed&&o.closed?`<button class="btn sm" data-act="reopenOrder" data-id="${esc(o.id)}">Reopen</button>`:''}
        ${voidBtn('orders', o)}
      </div></article>`;
  }
  h += `</section><section class="group"><h2>Delivery log</h2><div class="list">`;
  const ds=[...M.dels].reverse();
  if(!ds.length) h += `<div class="empty">No deliveries logged yet.</div>`;
  for(const d of ds){
    const po = d.orderId ? (S.orders.find(o=>o.id===d.orderId)||{}).po : null;
    const rej = Object.entries(d.rejected||{}).filter(([k,v])=>num(v)>0);
    h += `<div class="logrow"><div><div style="font-weight:600">${fDate(d.at)}${d.ticket?` · Ticket ${esc(d.ticket)}`:''}</div>
      <div class="small muted">${po?`PO ${esc(po)} · `:'No PO · '}${Object.entries(d.lines||{}).map(([k,v])=>`${esc(nameOf(k))} ${fmt(num(v))}`).join(', ')}${rej.length?` · <span style="color:var(--bad)">Rejected: ${rej.map(([k,v])=>`${esc(nameOf(k))} ${fmt(num(v))}`).join(', ')}</span>`:''}</div></div>
      ${voidBtn('deliveries', d)}</div>`;
  }
  return h + `</div></section>`;
}
const FIELD_COLS=['counts','production','usage','deliveries'];
function voidBtn(coll, rec){
  if(proj()?.closed) return '';
  const ok = can.manage || (can.field && FIELD_COLS.includes(coll) && rec.createdBy===UID);
  return ok ? confirmBtn('void', coll+'|'+rec.id, 'Void') : (rec.pending?'<span class="chip neutral">Waiting to sync</span>':'');
}
function confirmBtn(act, id, label){
  const c=S.confirm;
  if(c && c.act===act && c.id===id) return `<span class="row"><button class="btn sm danger solid" data-act="${act}" data-id="${esc(id)}">Confirm ${label.toLowerCase()}</button><button class="btn sm" data-act="cancelConfirm">Keep</button></span>`;
  return `<button class="btn sm danger" data-act="askConfirm" data-confirm="${act}" data-id="${esc(id)}">${label}</button>`;
}

function vReports(M){
  const ST=M.ST;
  let h = `<div class="panel pad"><div class="eyebrow">Material status as of ${fDate(today())}</div>
    <p class="small muted" style="margin:6px 0 0">${ST.wasteOn?`Waste allowance on (takeoff entered as ${ST.basis==='net'?'net, waste added':'gross, waste included'}). Required net is what goes in the wall; required incl. waste is what has to be delivered.`:'Waste allowance off. Required quantities are used as entered.'}</p></div>`;
  h += `<div class="tablewrap"><table><thead><tr><th>Material</th><th>Req net</th>${ST.wasteOn?'<th>Req + waste</th>':''}<th>Deliv'd</th><th>Inst'd (count)</th><th>Inst'd (prod)</th><th>On hand</th><th>To deliv</th><th>To inst</th><th>% inst</th><th>On order</th></tr></thead><tbody>`;
  for(const r of M.items){
    h += `<tr><td>${esc(r.it.name)}</td><td>${fmt(r.net)}</td>${ST.wasteOn?`<td>${fmt(r.gross)}</td>`:''}<td>${fmt(r.delivered)}</td><td>${fmt(r.installed)}</td><td>${fmt(r.installedProd)}</td><td>${fmt(r.onHand)}</td>
      <td class="${r.balDeliver<0?'neg':''}">${fmt(r.balDeliver)}</td><td class="${r.balInstall<0?'neg':''}">${fmt(r.balInstall)}</td>
      <td>${r.pct!=null&&r.counted?Math.round(r.pct*100)+'%':'—'}</td><td>${fmt(r.onOrder||0)}</td></tr>`;
  }
  h += `</tbody></table></div>`;

  // reconciliation
  const win = S.recWin;
  h += `<section class="group"><h2>Reconciliation</h2><div class="panel pad stack">
    <div class="seg" role="group" aria-label="Period"><button data-act="recWin" data-win="all" aria-pressed="${win==='all'}">Since opening count</button><button data-act="recWin" data-win="last" aria-pressed="${win==='last'}">Last count period</button></div>
    <div class="small muted">Consumed = start count + received + transfers in − returns/transfers out − end count. Installed = consumed − logged waste. Expected = production × takeoff ratio. Variance over ${pct(ST.thr)} is flagged.</div></div>`;
  h += `<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Material</th><th>Period</th><th>Start</th><th>+ Rec'd net</th><th>− End</th><th>Consumed</th><th>− Waste</th><th>Installed</th><th>Expected</th><th>Variance</th><th>Var %</th><th>Waste %</th></tr></thead><tbody>`;
  for(const r of M.items){
    const R = win==='all' ? r.all : r.last;
    if(!R){ h += `<tr><td>${esc(r.it.name)}</td><td colspan="11" style="text-align:left" class="muted">${r.counted?'Needs two counts':'Not counted'}</td></tr>`; continue; }
    const flag = R.varPct!=null && Math.abs(R.varPct)>ST.thr && R.expected>=20;
    h += `<tr><td>${esc(r.it.name)}</td><td>${fDate(R.from)}–${fDate(R.to)}</td><td>${fmt(R.open)}</td><td>${fmt(R.net)}</td><td>${fmt(R.close)}</td><td>${fmt(R.consumed)}</td><td>${fmt(R.waste)}</td><td>${fmt(R.installed)}</td>
      <td>${fmt(R.expected)}</td><td class="${flag?'flag':''}">${sgn(R.variance)}</td><td class="${flag?'flag':''}">${spct(R.varPct)}</td><td>${pct(R.wastePct,1)}${ST.wasteOn?` <span class="muted">/ ${pct(r.w,0)}</span>`:''}</td></tr>`;
  }
  h += `</tbody></table></div></section>`;
  h += `<div class="row" id="exportRow">${true?['summary:Status','recon:Reconciliation','production:Production','counts:Count history','orders:Orders'].map(s=>{const [k,l]=s.split(':'); return `<button class="btn" data-act="csv" data-kind="${k}">${l} CSV</button>`;}).join(''):''}</div>`;

  const cs=[...M.counts].reverse();
  h += `<section class="group"><h2>Count history</h2>`;
  if(cs.length){
    h += `<div class="tablewrap"><table><thead><tr><th>Material</th>${cs.map(c=>`<th>${fDate(c.at)}</th>`).join('')}</tr></thead><tbody>`;
    for(const r of M.items) h += `<tr><td>${esc(r.it.name)}</td>${cs.map(c=>`<td>${c.qty&&has(c.qty[r.it.id])?fmt(num(c.qty[r.it.id])):'·'}</td>`).join('')}</tr>`;
    h += `</tbody></table></div><div class="list" style="margin-top:10px">`;
    for(const c of cs){
      const i=M.counts.indexOf(c); const gap = i<=0 ? 'Opening count' : `${daysSince(M.counts[i-1].at)-daysSince(c.at)} days after previous`;
      h += `<div class="logrow"><div><div style="font-weight:600">${fDate(c.at)} · ${Object.keys(c.qty||{}).length} items</div><div class="small muted">${c.by?esc(c.by)+' · ':''}${gap}${c.note?' · '+esc(c.note):''}</div></div>${voidBtn('counts', c)}</div>`;
    }
    h += `</div>`;
  } else h += `<div class="panel empty">No counts yet.</div>`;
  return h + `</section>`;
}

function vSetup(M){
  const p=proj(), ST=M.ST, w=p?.waste||{};
  let h = sampleBanner(p);
  h += `<section class="panel pad stack">
    <div class="eyebrow">Project</div>
    <div class="grid2"><label class="f">Project number<input id="pNum" value="${esc(p?.number)}"></label>
    <label class="f">Phase when tracking started<select id="pPhase">${['Start','Middle','End'].map(x=>`<option ${p?.phase===x?'selected':''}>${x}</option>`).join('')}</select></label></div>
    <label class="f">Project name<input id="pName" value="${esc(p?.name)}"></label>
    <div class="eyebrow" style="margin-top:6px">Waste allowance</div>
    <label class="check"><input type="checkbox" id="pWaste" ${ST.wasteOn?'checked':''}> Include waste allowance in required quantities</label>
    <label class="f">Takeoff quantities on this job are<select id="pBasis"><option value="net" ${ST.basis==='net'?'selected':''}>Net (no waste) — add waste on top</option><option value="gross" ${ST.basis==='gross'?'selected':''}>Gross (waste included) — back waste out</option></select></label>
    <div class="grid4">${CATS.map(c=>`<label class="f">${c} %<input type="number" inputmode="decimal" min="0" step="0.5" data-wpct="${c}" value="${esc(w[c]??'')}" placeholder="0"></label>`).join('')}
    <label class="f">Flag mix variance over %<input type="number" inputmode="decimal" min="0" step="1" id="pThr" value="${esc(p?.threshold??5)}"></label></div>
    <div class="row"><button class="btn primary" data-act="saveProject">Save project</button><button class="btn" data-act="newProject">New project</button></div>
  </section>`;

  h += `<section class="group"><div class="spread"><h2 style="font-size:18px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Production groups</h2><button class="btn sm primary" data-act="editGroup" data-id="">Add group</button></div>
    <p class="small muted" style="margin:4px 2px 8px">A group is what the crew logs each day, like total block laid. Primary materials add up to that number. Secondary materials (rebar, accessories) follow by ratio. Ratios come from the takeoff unless you override them.</p><div class="list">`;
  if(!M.gsum.length) h += `<div class="empty">No production groups yet.</div>`;
  for(const G of M.gsum) h += `<button class="item" data-act="editGroup" data-id="${esc(G.g.id)}"><div class="spread"><div style="min-width:0"><div class="name">${esc(G.g.name)}</div><div class="meta">Logged in ${esc(G.g.unit||'units')}${G.g.sfEntry?` or wall SF at ${num(G.g.perSF)}/SF`:''}</div></div>
    <div class="small" style="text-align:right">${G.prim.length} primary<br><span class="muted">${G.secondary.length} secondary</span></div></div></button>`;
  h += `</div></section>`;

  h += `<section class="group"><div class="spread"><h2 style="font-size:18px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Materials</h2><button class="btn sm primary" data-act="editItem" data-id="">Add material</button></div>
    <p class="small muted" style="margin:4px 2px 8px">For a job already underway, enter the takeoff quantity and an estimate of what was installed before your first count. Those two numbers plus the opening count set the baseline.</p><div class="list">`;
  if(!M.items.length) h += `<div class="empty">No materials yet.</div>`;
  for(const r of M.items) h += `<button class="item" data-act="editItem" data-id="${esc(r.it.id)}"><div class="spread"><div style="min-width:0"><div class="name">${esc(r.it.name)}</div><div class="meta">${esc(r.it.cat||'Other')} · ${esc(itemMeta(r.it))}${r.gid?` · ${r.it.role} · ratio ${ratioTxt(r.ratio)}`:''}</div></div>
    <div class="small" style="text-align:right">Takeoff <b>${fmt(r.req)}</b><br><span class="muted">Pre-installed ${fmt(r.pre)}</span></div></div></button>`;
  h += `</div></section>`;
  if(p){
    const openOrd = M.orders.filter(o=>o.status==='Open'||o.status==='Partial').length;
    h += p.closed
      ? `<section class="panel pad stack"><div class="eyebrow">Job status</div><p class="small" style="margin:0">Closed out ${p.closedOn?fDate(p.closedOn):''}. Reopen it to log counts, production or deliveries again, for punch list or added work.</p><div><button class="btn" data-act="reopenProject">Reopen project</button></div></section>`
      : `<section class="panel pad stack"><div class="eyebrow">Close out</div><p class="small" style="margin:0">Moves this job to Closed jobs in the project picker and turns off logging. All counts, orders and reports stay readable, and you can reopen it later.${openOrd?` <b style="color:var(--warn)">${openOrd} order${openOrd>1?'s are':' is'} still open.</b> Close them short or receive them first if nothing more is coming.`:''} Export your final Reconciliation CSV from Reports before or after.</p><div>${confirmBtn('closeProject', p.id, 'Close out job')}</div></section>`;
  }
  if(p && p.sample && can.admin) h += `<section class="panel pad stack"><div class="eyebrow">Sample data</div>
    <p class="small" style="margin:0">Clearing removes every sample count, production entry, waste entry, order and delivery, and blanks the takeoff and pre-installed quantities. Your material list and production groups stay.</p>
    <div>${confirmBtn('clearSample', 'x', 'Clear sample data')}</div></section>`;
  return h;
}

/* ---------- render ---------- */
function render(){
  const p=proj();
  document.getElementById('hJob').textContent = p?.number || '—';
  document.getElementById('hName').textContent = p?.name || (S.loaded ? 'Jobsite Tracker' : 'Loading…');
  renderSync();
  const sel=document.getElementById('projSel');
  sel.hidden = S.projects.length < 2;
  const opt = x=>`<option value="${esc(x.id)}" ${x.id===S.pid?'selected':''}>${esc(x.number)} ${esc(x.name)}</option>`;
  const openP = S.projects.filter(x=>!x.closed), closedP = S.projects.filter(x=>x.closed);
  sel.innerHTML = openP.map(opt).join('') + (closedP.length ? `<optgroup label="Closed jobs">${closedP.map(opt).join('')}</optgroup>` : '');
  const allowed = tabsFor();
  const tabsEl = document.getElementById('tabs'); tabsEl.style.setProperty('--ntabs', allowed.length); tabsEl.parentElement.classList.toggle('many', allowed.length>6);
  tabsEl.innerHTML = TABS.filter(t=>allowed.includes(t[0])).map(([k,l,ic])=>`<button data-act="tab" data-tab="${k}" ${S.tab===k?'aria-current="page"':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg>${l}</button>`).join('');
  const main=document.getElementById('main');
  if(main.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')){ S.pendingRender=true; return; }
  S.pendingRender=false;
  if(S.tab==='admin' && can.admin){ main.innerHTML = vAdmin(appState); return; }
  if(!S.loaded){ main.innerHTML = `<div class="panel pad"><div class="eyebrow">Connecting</div><p class="muted">Loading project materials…</p></div>`; return; }
  if(!S.pid){ main.innerHTML = can.manage
      ? `<div class="panel empty"><h2>No projects yet</h2><p>Create your first job to start tracking material${can.admin?', or import the SkyBridge data from the Admin tab':''}.</p><button class="btn primary" data-act="newProject">New project</button></div>`
      : `<div class="panel empty"><h2>No jobs assigned</h2><p>You're signed in, but no jobs are assigned to you yet. Ask your admin to add you to a job.</p></div>`; return; }
  const M=model();
  if(p && p.closed){
    const note = `<div class="banner info"><b>Closed ${p.closedOn?fDate(p.closedOn)+' ':''}·</b> This job is closed out. Its numbers and reports stay here for reference. Reopen it in Setup to log more.</div>`;
    if(S.tab==='log'||S.tab==='count'){ main.innerHTML = note + `<div class="panel empty"><h2>Logging is off for closed jobs</h2><p>Switch to an open job in the header, or reopen this one.</p><button class="btn" data-act="tab" data-tab="setup">Go to Setup</button></div>`; return; }
    main.innerHTML = note + ({status:vStatus,orders:vOrders,reports:vReports,setup:vSetup})[S.tab](M); return;
  }
  main.innerHTML = ({status:vStatus,log:vLog,count:vCount,orders:vOrders,reports:vReports,setup:vSetup})[S.tab](M);
}
document.addEventListener('focusout', ()=>{ setTimeout(()=>{ if(S.pendingRender) render(); }, 0); });

let toastT;
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true, 2600); }
function fail(e){ console.error(e); toast(e && e.code==='permission-denied' ? "You don't have permission for that." : 'Could not save that change. Try again.'); }

/* ---------- sheets ---------- */
function openSheet(html, redraw){ S.sheetRedraw = redraw || null; const root=document.getElementById('sheetRoot'); root.innerHTML=`<div class="sheetwrap" data-act="closeSheetBg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; const f=root.querySelector('input,select,button'); f && f.focus({preventScroll:true}); }
function closeSheet(){ document.getElementById('sheetRoot').innerHTML=''; S.sheetRedraw=null; S.confirm=null; }

function sheetItem(id){
  const M=model(); const r=M.items.find(x=>x.it.id===id); if(!r) return;
  const it=r.it, ST=M.ST, R=r.all;
  const lf = v => r.lfPer && v!=null ? ` <span class="muted small">(${fmt(v*r.lfPer)} LF)</span>` : '';
  openSheet(`<div class="spread"><div><div class="eyebrow">${esc(it.cat||'Other')}${r.gid?` · ${esc(it.role)} in ${esc((M.groups.find(g=>g.id===r.gid)||{}).name)}`:''}</div><h2>${esc(it.name)}</h2></div><button class="btn sm" data-act="closeSheet">Close</button></div>
  ${r.counted?'':`<div class="banner info"><b>Not counted yet.</b> Take a count to set the opening on-hand for this material.</div>`}
  <dl class="kv">
    <dt>Required, net (in the wall)</dt><dd>${fmt(r.net)}${lf(r.net)}</dd>
    ${ST.wasteOn?`<dt>Waste allowance ${pct(r.w,1)}</dt><dd>${fmt(r.gross!=null?r.gross-r.net:null)}</dd><dt>Required incl. waste</dt><dd>${fmt(r.gross)}</dd>`:''}
    <div class="hr"></div>
    <dt>Delivered to date</dt><dd>${fmt(r.delivered)}</dd>
    <dt>Installed (counts)</dt><dd>${fmt(r.installed)}</dd>
    ${r.installedProd!=null?`<dt>Installed (production × ${ratioTxt(r.ratio)})</dt><dd>${fmt(r.installedProd)}</dd>`:''}
    <dt>Logged waste since opening</dt><dd>${fmt(r.wasteTotal)}</dd>
    <dt>On hand at last count</dt><dd>${fmt(r.lastQty)}</dd>
    <dt>On hand now (est.)</dt><dd>${fmt(r.onHand)}</dd>
    <div class="hr"></div>
    <dt><b>Balance to deliver</b></dt><dd>${fmt(r.balDeliver)}${lf(r.balDeliver)}</dd>
    <dt><b>Balance to install</b> (counts)</dt><dd>${fmt(r.balInstall)}</dd>
    ${r.balInstallProd!=null?`<dt>Balance to install (production)</dt><dd>${fmt(r.balInstallProd)}</dd>`:''}
    <dt>On open orders</dt><dd>${fmt(r.onOrder)}</dd>
    <dt>Still to order</dt><dd>${r.toOrder!=null?fmt(Math.max(0,r.toOrder)):'—'}</dd>
  </dl>
  ${R?`<div class="eyebrow">Reconciliation ${fDate(R.from)} – ${fDate(R.to)}</div>
  <dl class="kv">
    <dt>Opening count</dt><dd>${fmt(R.open)}</dd>
    <dt class="sub">+ received</dt><dd>${fmt(R.recv)}</dd>
    ${R.inn?`<dt class="sub">+ transferred in</dt><dd>${fmt(R.inn)}</dd>`:''}
    ${R.out?`<dt class="sub">− returned / transferred out</dt><dd>${fmt(R.out)}</dd>`:''}
    <dt class="sub">− closing count</dt><dd>${fmt(R.close)}</dd>
    <dt>= Consumed</dt><dd>${fmt(R.consumed)}</dd>
    <dt class="sub">− logged waste</dt><dd>${fmt(R.waste)}</dd>
    <dt>= Installed</dt><dd>${fmt(R.installed)}</dd>
    ${R.expected!=null?`<dt>Expected from production</dt><dd>${fmt(R.expected)}</dd><dt><b>Variance</b></dt><dd style="color:${r.flag?'var(--warn)':'inherit'}">${sgn(R.variance)} (${spct(R.varPct)})</dd>`:''}
    <dt>Actual waste rate</dt><dd>${pct(R.wastePct,1)}${ST.wasteOn?` vs ${pct(r.w,1)} allowed`:''}</dd>
  </dl>
  ${R.expected!=null?`<div class="formula">${r.flag?(R.variance>0?'Using more than the takeoff mix predicts. Either this stretch of wall needed more of this unit, or material is leaving the pile without being logged.':'Using less than the takeoff mix predicts. Check whether these units are being substituted or whether the remaining wall will need more of them.'):'Actual use is tracking the takeoff mix.'} Baseline: ${fmt(r.pre??0)} installed before tracking.</div>`:''}`:''}
  <div class="eyebrow">Counts</div>
  <div class="list">${r.history.length?[...r.history].reverse().map(c=>`<div class="logrow"><span>${fDate(c.at)}${c.by?` · <span class="muted">${esc(c.by)}</span>`:''}</span><b>${fmt(c.q)}</b></div>`).join(''):'<div class="empty">None yet</div>'}</div>
  <div class="eyebrow">Deliveries, waste and returns</div>
  <div class="list">${[...r.dels.map(d=>({at:d.at, t:`Delivered${d.ticket?' · ticket '+esc(d.ticket):''}${d.bad?` · ${fmt(d.bad)} rejected`:''}`, q:'+'+fmt(d.q)})), ...r.uses.map(u=>({at:u.at, t:esc(REASONS[u.reason]||u.reason), q:(u.reason==='xfer-in'?'+':'−')+fmt(num(u.qty))}))].sort(byAt).reverse().map(e=>`<div class="logrow"><span>${fDate(e.at)} · <span class="muted">${e.t}</span></span><b>${e.q}</b></div>`).join('')||'<div class="empty">None yet</div>'}</div>
  ${can.manage&&!proj()?.closed?`<button class="btn" data-act="editItem" data-id="${esc(it.id)}">Edit material</button>`:''}`);
}

function sheetEditItem(id){
  const it = S.items.find(i=>i.id===id) || {cat:'CMU', unit:'EA'};
  const g = S.groups.find(x=>x.id===it.group);
  openSheet(`<div class="spread"><h2>${id?'Edit material':'Add material'}</h2><button class="btn sm" data-act="closeSheet">Close</button></div>
  <div class="grid2"><label class="f">Category<select id="iCat">${CATS.map(c=>`<option ${it.cat===c?'selected':''}>${c}</option>`).join('')}</select></label>
  <label class="f">Unit<select id="iUnit">${['EA','LF','SF','BAG','PAL','CY','TON'].map(u=>`<option ${it.unit===u?'selected':''}>${u}</option>`).join('')}</select></label></div>
  <label class="f">Name<input id="iName" value="${esc(it.name)}" placeholder='e.g. 12" Knock-out CMU'></label>
  <div class="grid2"><label class="f">Bar size (rebar)<select id="iBar"><option value="">—</option>${Object.keys(WT).map(b=>`<option ${it.bar===b?'selected':''}>${b}</option>`).join('')}</select></label>
  <label class="f">Piece length<input id="iLen" value="${esc(ftin(it.lengthIn))}" placeholder="6'-8&quot;"></label></div>
  <div class="grid2"><label class="f">Takeoff quantity<input id="iReq" type="number" inputmode="numeric" min="0" value="${esc(it.required??'')}"></label>
  <label class="f">Installed before tracking<input id="iPre" type="number" inputmode="numeric" min="0" value="${esc(it.preInstalled??'')}" placeholder="0 if new job"></label></div>
  <div class="small muted">${g?`In production group “${esc(g.name)}” as ${esc(it.role)}. Change that in Setup › Production groups.`:'Not in a production group. Assign it in Setup › Production groups.'}</div>
  <div class="row"><button class="btn primary" data-act="saveItem" data-id="${esc(id||'')}">Save material</button>${id?confirmBtn('delItem', id, 'Remove material'):''}</div>`, ()=>sheetEditItem(id));
}

let groupDraft=null;
function sheetGroup(id){
  const g = id ? S.groups.find(x=>x.id===id) : null;
  groupDraft = { id:id||null, name:g?.name||'Block laid', unit:g?.unit||'block', sfEntry:g?g.sfEntry!==false:true, perSF:g?.perSF??1.125,
    roles: Object.fromEntries(S.items.map(it=>[it.id, it.group===id && id ? (it.role||'') : ''])),
    ratios: Object.fromEntries(S.items.map(it=>[it.id, it.group===id && id && has(it.ratio) ? String(it.ratio) : ''])) };
  drawGroup();
}
function drawGroup(){
  const d=groupDraft, M=model();
  const tot = M.items.reduce((s,r)=> d.roles[r.it.id]==='primary' && r.net!=null ? s+r.net : s, 0);
  const others = id => { const it=S.items.find(i=>i.id===id); return it && it.group && it.group!==d.id && S.groups.some(g=>g.id===it.group) ? (S.groups.find(g=>g.id===it.group)||{}).name : null; };
  openSheet(`<div class="spread"><h2>${d.id?'Edit production group':'Add production group'}</h2><button class="btn sm" data-act="closeSheet">Close</button></div>
  <div class="grid2"><label class="f">Group name<input id="gName" value="${esc(d.name)}" placeholder="Block laid"></label>
  <label class="f">Unit word<input id="gUnit" value="${esc(d.unit)}" placeholder="block, brick, stone"></label></div>
  <label class="check"><input type="checkbox" id="gSF" ${d.sfEntry?'checked':''}> Allow entry by wall square footage</label>
  <label class="f">Units per SF (CMU 1.125 · modular brick 6.75)<input id="gPer" type="number" inputmode="decimal" min="0" step="0.005" value="${esc(d.perSF)}"></label>
  <div class="eyebrow">Materials in this group</div>
  <div class="small muted">Primary = counted in the daily total. Secondary = estimated from it. Auto ratio is the material's net takeoff ÷ total primary takeoff (${fmt(tot)}). Type a ratio to override it.</div>
  <div class="colhead"><span style="text-align:left">Material</span><span>Role</span><span>Ratio</span></div>
  <div class="list">${M.items.map(r=>{ const role=d.roles[r.it.id]||''; const auto = role && tot && r.net!=null ? r.net/tot : null; const o=others(r.it.id);
    return `<div class="countrow two"><div style="min-width:0"><div style="font-weight:600">${esc(r.it.name)}</div><div class="small muted">${o?`Now in “${esc(o)}” · `:''}Takeoff ${fmt(r.net)}${role?` · auto ${ratioTxt(auto)}`:''}</div></div>
    <select data-grole="${esc(r.it.id)}" aria-label="${esc(r.it.name)} role"><option value="" ${!role?'selected':''}>—</option><option value="primary" ${role==='primary'?'selected':''}>Primary</option><option value="secondary" ${role==='secondary'?'selected':''}>Secondary</option></select>
    <input type="number" inputmode="decimal" min="0" step="any" data-gratio="${esc(r.it.id)}" value="${esc(d.ratios[r.it.id])}" placeholder="${role?ratioTxt(auto):''}" ${role?'':'disabled'} aria-label="${esc(r.it.name)} ratio override" style="font-size:15px"></div>`; }).join('')}</div>
  <div class="row"><button class="btn primary" data-act="saveGroup">Save group</button>${d.id?confirmBtn('delGroup', d.id, 'Remove group'):''}</div>`, drawGroup);
}
function syncGroupDraft(){
  const d=groupDraft; if(!d) return; const g=x=>document.getElementById(x);
  if(g('gName')){ d.name=g('gName').value.trim(); d.unit=g('gUnit').value.trim(); d.sfEntry=g('gSF').checked; d.perSF=g('gPer').value; }
  document.querySelectorAll('[data-grole]').forEach(el=>{ d.roles[el.dataset.grole]=el.value; });
  document.querySelectorAll('[data-gratio]').forEach(el=>{ d.ratios[el.dataset.gratio]=el.value; });
}

let orderDraft=null;
function sheetOrder(id){
  const o = id ? S.orders.find(x=>x.id===id) : null;
  orderDraft = { id:id||null, po:o?.po||'', supplier:o?.supplier||'', ordered:o?.ordered||today(), needBy:o?.needBy||'', note:o?.note||'', lines:(o?.lines||[{itemId:'',qty:''}]).map(l=>({...l})) };
  drawOrder();
}
function drawOrder(){
  const d=orderDraft, its=model().items;
  openSheet(`<div class="spread"><h2>${d.id?'Edit order':'New order'}</h2><button class="btn sm" data-act="closeSheet">Close</button></div>
  <div class="grid2"><label class="f">PO number<input id="oPo" value="${esc(d.po)}" placeholder="126-001-16"></label>
  <label class="f">Supplier<input id="oSup" value="${esc(d.supplier)}"></label></div>
  <div class="grid2"><label class="f">Ordered<input type="date" id="oOrd" value="${esc(d.ordered)}"></label>
  <label class="f">Need by<input type="date" id="oNeed" value="${esc(d.needBy)}"></label></div>
  <label class="f">Note<input id="oNote" value="${esc(d.note)}"></label>
  <div class="eyebrow">Lines</div>
  ${d.lines.map((l,i)=>`<div class="grid2" style="grid-template-columns:1fr 100px auto;align-items:end">
    <label class="f">Material<select data-oline="${i}" data-k="itemId"><option value="">Choose…</option>${its.map(r=>`<option value="${esc(r.it.id)}" ${l.itemId===r.it.id?'selected':''}>${esc(r.it.name)}${r.toOrder>=0.5?` (need ${fmt(r.toOrder)})`:''}</option>`).join('')}</select></label>
    <label class="f">Qty<input type="number" inputmode="numeric" min="0" data-oline="${i}" data-k="qty" value="${esc(l.qty)}"></label>
    <button class="btn sm" data-act="rmLine" data-i="${i}" aria-label="Remove line">✕</button></div>`).join('')}
  <button class="linkbtn" data-act="addLine">+ Add line</button>
  <button class="btn primary" data-act="saveOrder">Save order</button>`, drawOrder);
}
function syncOrderDraft(){
  const d=orderDraft; if(!d) return; const g=id=>document.getElementById(id);
  if(g('oPo')){ d.po=g('oPo').value.trim(); d.supplier=g('oSup').value.trim(); d.ordered=g('oOrd').value; d.needBy=g('oNeed').value; d.note=g('oNote').value.trim(); }
  document.querySelectorAll('[data-oline]').forEach(el=>{ d.lines[+el.dataset.oline][el.dataset.k]=el.value; });
}

let recvOrder=null;
function sheetReceive(orderId){
  const M=model(); const o = orderId ? M.orders.find(x=>x.id===orderId) : null;
  recvOrder = orderId||null;
  const pre = {}; if(o) for(const l of o.lines) if(l.rem>0) pre[l.itemId]=String(l.rem);
  const rows = o ? M.items.filter(r=>o.lines.some(l=>l.itemId===r.it.id)) : M.items;
  openSheet(`<div class="spread"><h2>${o?`Receive ${esc(o.po||'order')}`:'Log delivery'}</h2><button class="btn sm" data-act="closeSheet">Close</button></div>
  ${o?`<div class="small muted">${esc(o.supplier||'')} · Accepted is filled with what's still open. Change it to match the ticket. Damaged or refused units go in Rejected; they stay open on the PO.</div>`:`<div class="small muted">For material that arrived without a PO entered here.</div>`}
  <div class="grid2"><label class="f">Delivered<input type="date" id="rDate" value="${today()}"></label>
  <label class="f">Ticket #<input id="rTicket" placeholder="Delivery ticket"></label></div>
  <div class="colhead"><span></span><span>Accepted</span><span>Rejected</span></div>
  <div class="list">${rows.map(r=>`<div class="countrow two"><div style="min-width:0"><div style="font-weight:600">${esc(r.it.name)}</div><div class="small muted">${o?`Open ${fmt((o.lines.find(l=>l.itemId===r.it.id)||{}).rem)}`:esc(r.it.unit||'EA')}</div></div>
    <input type="number" inputmode="numeric" min="0" data-recv="${esc(r.it.id)}" value="${esc(pre[r.it.id]??'')}" placeholder="0" aria-label="${esc(r.it.name)} accepted">
    <input type="number" inputmode="numeric" min="0" data-rej="${esc(r.it.id)}" placeholder="0" aria-label="${esc(r.it.name)} rejected"></div>`).join('')}</div>
  <button class="btn primary" data-act="saveReceive">Save delivery</button>`);
}

function sheetNewProject(){
  openSheet(`<div class="spread"><h2>New project</h2><button class="btn sm" data-act="closeSheet">Close</button></div>
  <div class="grid2"><label class="f">Project number<input id="npNum" placeholder="126-002"></label>
  <label class="f">Phase<select id="npPhase"><option>Start</option><option>Middle</option><option>End</option></select></label></div>
  <label class="f">Project name<input id="npName"></label>
  <label class="check"><input type="checkbox" id="npCopy" ${S.items.length?'checked':''}> Copy materials, production groups and waste settings from the current project (quantities blank)</label>
  <button class="btn primary" data-act="createProject">Create project</button>`);
}

/* ---------- actions ---------- */
const col = name => db.collection(`projects/${S.pid}/${name}`);

async function act(a, el){
  const id = el.dataset.id;
  switch(a){
    case 'account': HOOKS.account && HOOKS.account(); break;
    case 'tab': S.tab=el.dataset.tab; S.confirm=null; render(); window.scrollTo(0,0); break;
    case 'logMode': S.logMode=el.dataset.mode; render(); break;
    case 'prodMode': syncProdDraft(); S.prodDraft.mode=el.dataset.mode; S.prodDraft.qty=''; render(); break;
    case 'recWin': S.recWin=el.dataset.win; render(); break;
    case 'item': sheetItem(id); break;
    case 'editItem': sheetEditItem(id); break;
    case 'editGroup': sheetGroup(id); break;
    case 'closeSheet': closeSheet(); break;
    case 'askConfirm': if(groupDraft && S.sheetRedraw===drawGroup) syncGroupDraft(); if(orderDraft && S.sheetRedraw===drawOrder) syncOrderDraft(); S.confirm={act:el.dataset.confirm, id}; redraw(); break;
    case 'cancelConfirm': S.confirm=null; redraw(); break;
    case 'saveCount': {
      const d=S.draft; const qty={}; for(const [k,v] of Object.entries(d.qty)) if(has(v)) qty[k]=num(v);
      if(!Object.keys(qty).length) return;
      el.disabled=true;
      try{ await col('counts').add({at:stamp(d.date||today()), by:d.by, note:d.note, qty}); store('by',d.by);
        S.draft={date:today(), by:d.by, note:'', qty:{}}; S.tab='status'; toast(`Count saved · ${Object.keys(qty).length} items`); render(); }
      catch(e){ el.disabled=false; fail(e); } break; }
    case 'saveProd': {
      syncProdDraft(); const d=S.prodDraft, g=S.groups.find(x=>x.id===d.groupId);
      if(!g || !(num(d.qty)>0)){ document.getElementById('pQty')?.focus(); toast('Enter the amount laid.'); return; }
      const qty = d.mode==='sf' ? Math.round(num(d.qty)*num(g.perSF)) : Math.round(num(d.qty));
      el.disabled=true;
      try{ await col('production').add({at:(d.date||today())+PROD_TIME, groupId:g.id, qty, sf: d.mode==='sf'?num(d.qty):null, note:d.note});
        S.prodDraft={...d, qty:'', note:''}; toast(`Logged ${fmt(qty)} ${g.unit||'units'}`); render(); }
      catch(e){ el.disabled=false; fail(e); } break; }
    case 'saveUse': {
      const g=x=>document.getElementById(x); const q=num(g('uQty').value);
      if(!(q>0)){ g('uQty').focus(); toast('Enter a quantity.'); return; }
      el.disabled=true;
      try{ await col('usage').add({at:stamp(g('uDate').value||today()), itemId:g('uItem').value, reason:g('uReason').value, qty:q, note:g('uNote').value.trim()});
        toast('Entry saved'); render(); }catch(e){ el.disabled=false; fail(e); } break; }
    case 'saveItem': {
      const g=x=>document.getElementById(x); const name=g('iName').value.trim();
      if(!name){ g('iName').focus(); toast('Give the material a name.'); return; }
      const lenRaw=g('iLen').value.trim(); const lengthIn=parseLen(lenRaw);
      if(lenRaw && lengthIn==null){ g('iLen').focus(); toast(`Enter length like 6'-8" or 20'.`); return; }
      const body={cat:g('iCat').value, unit:g('iUnit').value, name, bar:g('iBar').value, lengthIn:lengthIn||null,
        required: g('iReq').value===''?null:num(g('iReq').value), preInstalled: g('iPre').value===''?null:num(g('iPre').value)};
      try{ if(id){ await col('items').doc(id).update(body); }
        else { body.sort = S.items.reduce((m,i)=>Math.max(m,num(i.sort)),0)+1; await col('items').doc(slug(name)).set(body,{create:true}); }
        closeSheet(); toast('Material saved'); }catch(e){ fail(e); } break; }
    case 'delItem': try{ await col('items').doc(id).update({void:voidStamp()}); closeSheet(); toast('Material removed'); }catch(e){ fail(e); } break;
    case 'saveGroup': {
      syncGroupDraft(); const d=groupDraft;
      if(!d.name){ document.getElementById('gName').focus(); toast('Name the group, e.g. Block laid.'); return; }
      if(!Object.values(d.roles).includes('primary')){ toast('Mark at least one material as Primary.'); return; }
      el.disabled=true;
      try{ const gid = d.id || slug(d.name);
        if(d.id) await col('groups').doc(gid).update({name:d.name, unit:d.unit||'units', sfEntry:d.sfEntry, perSF: num(d.perSF)||null}); else await col('groups').doc(gid).set({name:d.name, unit:d.unit||'units', sfEntry:d.sfEntry, perSF: num(d.perSF)||null},{create:true});
        for(const it of S.items){ const role=d.roles[it.id]||'', ratio=has(d.ratios[it.id])?num(d.ratios[it.id]):null;
          const want = role ? {group:gid, role, ratio} : (it.group===gid ? {group:null, role:null, ratio:null} : null);
          if(want && (it.group!==want.group || (it.role||null)!==want.role || (has(it.ratio)?num(it.ratio):null)!==want.ratio)) await col('items').doc(it.id).update(want); }
        closeSheet(); toast('Production group saved'); }catch(e){ el.disabled=false; fail(e); } break; }
    case 'delGroup': try{ for(const it of S.items) if(it.group===id) await col('items').doc(it.id).update({group:null, role:null, ratio:null});
        await col('groups').doc(id).update({void:voidStamp()}); closeSheet(); toast('Group removed'); }catch(e){ fail(e); } break;
    case 'newOrder': sheetOrder(null); break;
    case 'editOrder': sheetOrder(id); break;
    case 'addLine': syncOrderDraft(); orderDraft.lines.push({itemId:'',qty:''}); drawOrder(); break;
    case 'rmLine': syncOrderDraft(); orderDraft.lines.splice(+el.dataset.i,1); if(!orderDraft.lines.length) orderDraft.lines.push({itemId:'',qty:''}); drawOrder(); break;
    case 'saveOrder': {
      syncOrderDraft(); const d=orderDraft;
      const lines=d.lines.filter(l=>l.itemId && num(l.qty)>0).map(l=>({itemId:l.itemId, qty:num(l.qty)}));
      if(!lines.length){ toast('Add at least one material and quantity.'); return; }
      const body={po:d.po, supplier:d.supplier, ordered:d.ordered, needBy:d.needBy, note:d.note, lines};
      try{ if(d.id) await col('orders').doc(d.id).update(body); else await col('orders').add({...body, closed:false});
        closeSheet(); toast('Order saved'); }catch(e){ fail(e); } break; }
    case 'closeOrder': try{ await col('orders').doc(id).update({closed:true}); toast('Order closed short'); }catch(e){ fail(e); } break;
    case 'reopenOrder': try{ await col('orders').doc(id).update({closed:false}); toast('Order reopened'); }catch(e){ fail(e); } break;
    case 'receive': sheetReceive(id||null); break;
    case 'saveReceive': {
      const lines={}, rejected={};
      document.querySelectorAll('[data-recv]').forEach(i=>{ if(num(i.value)>0) lines[i.dataset.recv]=num(i.value); });
      document.querySelectorAll('[data-rej]').forEach(i=>{ if(num(i.value)>0) rejected[i.dataset.rej]=num(i.value); });
      if(!Object.keys(lines).length && !Object.keys(rejected).length){ toast('Enter at least one quantity.'); return; }
      const date=document.getElementById('rDate').value||today();
      try{ await col('deliveries').add({at:stamp(date), ticket:document.getElementById('rTicket').value.trim(), orderId:recvOrder, lines, rejected});
        closeSheet(); toast('Delivery logged'); }catch(e){ fail(e); } break; }
    case 'void': { const [c,docId]=id.split('|'); col(c).doc(docId).update({void:voidStamp()}); S.confirm=null; toast('Voided. An admin can restore or purge it.'); render(); break; }
    case 'saveProject': {
      const g=x=>document.getElementById(x); const waste={};
      document.querySelectorAll('[data-wpct]').forEach(i=>{ if(i.value!=='') waste[i.dataset.wpct]=num(i.value); });
      try{ await db.doc('projects/'+S.pid).update({number:g('pNum').value.trim(), name:g('pName').value.trim(), phase:g('pPhase').value,
          wasteOn:g('pWaste').checked, basis:g('pBasis').value, waste, threshold:has(g('pThr').value)?num(g('pThr').value):5}); toast('Project saved'); }catch(e){ fail(e); } break; }
    case 'closeProject': try{ await db.doc('projects/'+S.pid).update({closed:true, closedOn:today()}); S.confirm=null; toast('Job closed out'); }catch(e){ fail(e); } break;
    case 'reopenProject': try{ await db.doc('projects/'+S.pid).update({closed:false, closedOn:null}); toast('Job reopened'); }catch(e){ fail(e); } break;
    case 'newProject': sheetNewProject(); break;
    case 'createProject': {
      const g=x=>document.getElementById(x); const number=g('npNum').value.trim(), name=g('npName').value.trim();
      if(!number){ g('npNum').focus(); toast('Enter a project number.'); return; }
      const pid = number.replace(/[^A-Za-z0-9_.~:@+-]/g,'-');
      if(S.projects.some(p=>p.id===pid)){ toast('That project number already exists.'); return; }
      const cur = proj()||{}, copy = g('npCopy').checked;
      try{ await db.doc('projects/'+pid).set({number, name, phase:g('npPhase').value, sample:false, created:today(),
          wasteOn: copy ? !!cur.wasteOn : true, basis: copy ? (cur.basis||'net') : 'net', waste: copy ? (cur.waste||{}) : {CMU:3, Rebar:2}, threshold: copy ? (cur.threshold??5) : 5},{create:true});
        if(copy){ for(const gr of S.groups){ const {id:gid, ...rest}=gr; await db.doc(`projects/${pid}/groups/${gid}`).set(clean(rest),{create:true}); }
          for(const it of S.items){ const {id:_x, ...rest}=it; await db.doc(`projects/${pid}/items/${it.id}`).set({...clean(rest), required:null, preInstalled:null, ratio:null},{create:true}); } }
        closeSheet(); switchProject(pid); S.tab='setup'; render(); toast('Project created'); }catch(e){ fail(e); } break; }
    case 'clearSample': {
      el.disabled=true;
      try{ for(const n of ['counts','deliveries','orders','production','usage']) for(const d of [...S[n]]) await col(n).doc(d.id).delete();
        for(const it of [...S.items]) await col('items').doc(it.id).update({required:null, preInstalled:null, ratio:null});
        await db.doc('projects/'+S.pid).update({sample:false}); S.confirm=null; toast('Sample data cleared'); }catch(e){ el.disabled=false; fail(e); } break; }
    case 'csv': exportCsv(el.dataset.kind); break;
    default: if(a.startsWith('adm')) adminAct(a, el, appState);
  }
}
function redraw(){ if(S.sheetRedraw && document.getElementById('sheetRoot').firstChild) S.sheetRedraw(); else render(); }
function syncProdDraft(){ const g=x=>document.getElementById(x), d=S.prodDraft;
  if(g('pGroup')) d.groupId=g('pGroup').value; if(g('pDate')) d.date=g('pDate').value; if(g('pQty')) d.qty=g('pQty').value; if(g('pNote')) d.note=g('pNote').value; }

document.addEventListener('click', e=>{
  if(e.target.matches && e.target.matches('.sheetwrap')){ closeSheet(); return; }
  const el=e.target.closest('[data-act]'); if(!el || el.dataset.act==='closeSheetBg') return;
  act(el.dataset.act, el);
});
document.addEventListener('input', e=>{
  const t=e.target;
  if(t.dataset.qty){ S.draft.qty[t.dataset.qty]=t.value; const r=model().items.find(x=>x.it.id===t.dataset.qty); const c=document.querySelector(`[data-conv="${CSS.escape(t.dataset.qty)}"]`); if(c&&r) c.textContent=conv(r,t.value);
    const n=Object.values(S.draft.qty).filter(has).length; const b=document.querySelector('[data-act="saveCount"]'); if(b){ b.disabled=!n; b.textContent=`Save count${n?` · ${n} item${n>1?'s':''}`:''}`; } }
  if(t.id==='cDate') S.draft.date=t.value; if(t.id==='cBy') S.draft.by=t.value; if(t.id==='cNote') S.draft.note=t.value;
  if(['pQty','pDate','pNote'].includes(t.id)){ syncProdDraft(); if(t.id==='pQty'){ const M=model(), g=M.groups.find(x=>x.id===S.prodDraft.groupId); const box=document.getElementById('implied');
    if(g && box){ const u = S.prodDraft.mode==='sf' ? Math.round(num(t.value)*num(g.perSF)) : num(t.value); box.innerHTML=impliedHtml(M,g,u); } } }
});
document.addEventListener('change', e=>{
  const t=e.target;
  if(t.id==='pGroup'){ syncProdDraft(); S.prodDraft.qty=''; t.blur(); render(); }
  if(t.dataset.grole!==undefined && t.dataset.grole){ syncGroupDraft(); drawGroup(); }
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && document.getElementById('sheetRoot').firstChild) closeSheet(); });
document.getElementById('projSel').addEventListener('change', e=>{ switchProject(e.target.value); });

/* ---------- export ---------- */
function csvOf(rows){ return rows.map(r=>r.map(v=>{ const s=v==null?'':typeof v==='number'?String(Math.round(v*100)/100):String(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }).join(',')).join('\r\n'); }
async function exportCsv(kind){
  const M=model(), p=proj(), nameOf = id => (S.items.find(i=>i.id===id)||{}).name; let rows;
  if(kind==='summary'){ rows=[['Project',p.number,p.name,'As of',today(),'Waste allowance',M.ST.wasteOn?`on (${M.ST.basis})`:'off'],[],['Category','Material','Unit','Piece length','Takeoff','Waste %','Required net','Required incl waste','Delivered','Installed (counts)','Installed (production)','On hand est','Balance to deliver','Balance to install','Balance to install (production)','% installed','On order','Still to order','Last count']];
    for(const r of M.items) rows.push([r.it.cat,r.it.name,r.it.unit,ftin(r.it.lengthIn),r.req,M.ST.wasteOn?r.w*100:0,r.net,r.gross,r.delivered,r.installed,r.installedProd,r.onHand,r.balDeliver,r.balInstall,r.balInstallProd,r.pct!=null&&r.counted?Math.round(r.pct*100):'',r.onOrder,r.toOrder!=null?Math.max(0,r.toOrder):'',r.lastAt?r.lastAt.slice(0,10):'']); }
  else if(kind==='recon'){ rows=[['Project',p.number,p.name,'Period',S.recWin==='all'?'Since opening count':'Last count period'],[],['Material','From','To','Start count','Received','Transferred in','Returned/out','End count','Consumed','Logged waste','Installed','Ratio','Expected from production','Variance','Variance %','Waste %','Waste allowance %']];
    for(const r of M.items){ const R=S.recWin==='all'?r.all:r.last; if(!R){ rows.push([r.it.name]); continue; }
      rows.push([r.it.name,R.from.slice(0,10),R.to.slice(0,10),R.open,R.recv,R.inn,R.out,R.close,R.consumed,R.waste,R.installed,r.ratio,R.expected,R.variance,R.varPct!=null?Math.round(R.varPct*1000)/10:'',R.wastePct!=null?Math.round(R.wastePct*1000)/10:'',r.w*100]); } }
  else if(kind==='production'){ rows=[['Date','Group','Units laid','Unit','Wall SF','Location / note']];
    for(const e of M.prod){ const g=M.groups.find(x=>x.id===e.groupId)||{}; rows.push([e.at.slice(0,10),g.name,num(e.qty),g.unit,e.sf,e.note]); }
    rows.push([],['Waste, returns and transfers'],['Date','Material','Reason','Qty','Note']);
    for(const u of M.usage) rows.push([u.at.slice(0,10),nameOf(u.itemId),REASONS[u.reason]||u.reason,num(u.qty),u.note]); }
  else if(kind==='counts'){ rows=[['Material',...M.counts.map(c=>c.at.slice(0,10))],['Counted by',...M.counts.map(c=>c.by||'')]];
    for(const r of M.items) rows.push([r.it.name,...M.counts.map(c=>c.qty&&has(c.qty[r.it.id])?num(c.qty[r.it.id]):'')]); }
  else { rows=[['PO','Supplier','Ordered','Need by','Status','Material','Ordered qty','Received','Rejected','Open']];
    for(const o of M.orders) for(const l of o.lines) rows.push([o.po,o.supplier,o.ordered,o.needBy,o.status,nameOf(l.itemId),l.qty,l.got,l.bad,o.closed?0:l.rem]);
    rows.push([],['Deliveries'],['Date','Ticket','PO','Material','Accepted','Rejected']);
    for(const d of M.dels){ const ids=new Set([...Object.keys(d.lines||{}),...Object.keys(d.rejected||{})]);
      for(const k of ids) rows.push([d.at.slice(0,10),d.ticket,d.orderId?(S.orders.find(o=>o.id===d.orderId)||{}).po:'',nameOf(k),num((d.lines||{})[k]),num((d.rejected||{})[k])]); } }
  saveFile(`${p.number}_${kind}_${today()}.csv`, csvOf(rows), 'text/csv'); toast('CSV saved');
}

/* ---------- data ---------- */
function switchProject(pid){
  if(pid===S.pid) return;
  unsubs.forEach(u=>u()); unsubs=[]; S.pid=pid; store('pid',pid);
  for(const n of COLS) S[n]=[];
  S.draft={date:today(), by:recall('by')||'', note:'', qty:{}};
  S.prodDraft={groupId:'', date:today(), mode:'units', qty:'', note:''};
  for(const n of COLS){
    unsubs.push(col(n).onSnapshot(snap=>{ const all=snap.docs.map(d=>({id:d.id, ...d.data(), pending:d.pending})); S[n]=all.filter(d=>!d.void); S.voided[n]=all.filter(d=>d.void); render(); },
      err=>{ console.error(err); toast('Lost connection to project data. Reload to reconnect.'); }));
  }
  render();
}
function setProjects(list){
  S.projects = list.filter(p=>!p.archived).sort((a,b)=>String(a.number).localeCompare(String(b.number)));
  S.allProjects = list;
  S.loaded = true;
  if(!S.pid || !S.projects.some(p=>p.id===S.pid)){
    const want = recall('pid'); const pick = S.projects.find(p=>p.id===want) || S.projects.find(p=>!p.closed) || S.projects[0];
    if(pick){ S.pid=null; switchProject(pick.id); return; }
    unsubs.forEach(u=>u()); unsubs=[]; S.pid=null;
  }
  render();
}
function listenProjects(){
  projUnsubs.forEach(u=>u()); projUnsubs=[];
  const err = e=>{ console.error(e); };
  if(can.admin){
    projUnsubs.push(onSnapshot(collection(fs,'projects'), snap=>setProjects(snap.docs.map(d=>({id:d.id, ...d.data()}))), err));
    return;
  }
  const found = new Map(); const push = ()=>setProjects([...found.values()]);
  for(const pid of (ME.projects||[])) projUnsubs.push(onSnapshot(doc(fs,'projects/'+pid), d=>{ if(d.exists()) found.set(pid,{id:pid, ...d.data()}); else found.delete(pid); push(); }, e=>{ found.delete(pid); push(); }));
  if(can.manage) projUnsubs.push(onSnapshot(query(collection(fs,'projects'), where('createdBy','==',UID)), snap=>{ for(const d of snap.docs) found.set(d.id,{id:d.id, ...d.data()}); push(); }, err));
  if(!(ME.projects||[]).length && !can.manage) setProjects([]);
}
function voidStamp(){ return {by:UID, name:ME?.name||ME?.email||'', at:new Date().toISOString(), reason:'Voided in app'}; }
function clean(o){ const r={...o}; for(const k of ['pending','createdAt','createdBy','void']) delete r[k]; return r; }
function saveFile(name, text, type){
  const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/* ---------- start / stop (called by main.js) ---------- */
let syncOff=null, lastErrShown=null;
export function startApp(me, uid, hooks){
  const first = !ME;
  const prevRole = ME?.role, prevProj = JSON.stringify(ME?.projects||[]);
  ME = me; UID = uid; HOOKS = hooks || HOOKS;
  if(first){
    S.draft.by = recall('by') || me.name || '';
    syncOff = onSync(st=>{
      SYNC = st; renderSync();
      if(st.lastError && st.lastError!==lastErrShown){ lastErrShown=st.lastError;
        toast(st.lastError.code==='permission-denied' ? 'The server refused a change (no permission, or the job is closed).' : 'A change could not be saved: '+st.lastError.message); }
    });
  }
  if(first || prevRole!==me.role || prevProj!==JSON.stringify(me.projects||[])) listenProjects();
  if(!tabsFor().includes(S.tab)) S.tab='status';
  render();
}
export function stopApp(){
  projUnsubs.forEach(u=>u()); projUnsubs=[]; unsubs.forEach(u=>u()); unsubs=[]; syncOff&&syncOff(); syncOff=null;
  ME=null; UID=null; S.pid=null; S.projects=[]; S.loaded=false;
}
export const appState = { get S(){ return S; }, get ME(){ return ME; }, get UID(){ return UID; }, model, render, toast, switchProject, saveFile, fmt, fDate, esc, today };

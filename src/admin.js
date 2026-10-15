// Admin tab: people, invitations, jobs, data cleanup, audit log and import.
// Only rendered for admins; firestore.rules enforces the same limits on the server.
import { fs, collection, doc, onSnapshot, getDocs, query, orderBy, limit, where, writeBatch, serverTimestamp, setDoc, updateDoc, deleteDoc, deleteField } from './fb.js';


const ROLES = { admin: 'Admin', pm: 'Foreman / PM', counter: 'Field counter', viewer: 'Viewer' };
const ROLE_HELP = {
  admin: 'Everything, including this Admin tab.',
  pm: 'Set up jobs, takeoffs and POs, close jobs, all reports. Sees assigned jobs and jobs they create.',
  counter: 'Counts, production, waste and deliveries on assigned jobs. Can void only their own entries.',
  viewer: 'Read-only status and reports on assigned jobs.'
};
const COLS = ['items', 'counts', 'deliveries', 'orders', 'groups', 'production', 'usage'];
const COL_NAMES = { items: 'Materials', counts: 'Counts', deliveries: 'Deliveries', orders: 'Orders', groups: 'Production groups', production: 'Production entries', usage: 'Waste / returns' };

const A = { sec: 'users', users: [], invites: [], audit: null, started: false, edit: null, confirm: null, busy: false, importText: null, cleanPid: null };
let APP = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const rerender = () => APP && APP.render();

function start(app) {
  if (A.started) return;
  A.started = true;
  onSnapshot(collection(fs, 'users'), s => { A.users = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name || a.email).localeCompare(b.name || b.email)); rerender(); }, e => console.error(e));
  onSnapshot(collection(fs, 'invites'), s => { A.invites = s.docs.map(d => ({ id: d.id, ...d.data() })); rerender(); }, e => console.error(e));
}
async function loadAudit() {
  try {
    const s = await getDocs(query(collection(fs, 'audit'), orderBy('at', 'desc'), limit(150)));
    A.audit = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); A.audit = []; APP.toast('Could not load the audit log. Check your connection.'); }
  rerender();
}

function confirmBtn(act, id, label, cls = 'danger') {
  if (A.confirm && A.confirm.act === act && A.confirm.id === id)
    return `<span class="row"><button class="btn sm ${cls} solid" data-act="${act}" data-id="${esc(id)}">Confirm ${esc(label.toLowerCase())}</button><button class="btn sm" data-act="admCancel">Keep</button></span>`;
  return `<button class="btn sm ${cls}" data-act="admAsk" data-confirm="${act}" data-id="${esc(id)}">${esc(label)}</button>`;
}
const projName = (app, pid) => { const p = (app.S.allProjects || []).find(x => x.id === pid); return p ? `${p.number} ${p.name || ''}`.trim() : pid; };
const jobChecks = (app, sel, prefix) => (app.S.allProjects || []).length
  ? `<div class="list">${(app.S.allProjects || []).map(p => `<label class="check" style="padding:4px 14px;border-top:1px solid var(--line)"><input type="checkbox" data-${prefix}job="${esc(p.id)}" ${sel.includes(p.id) ? 'checked' : ''}> ${esc(p.number)} ${esc(p.name || '')}${p.closed ? ' <span class="chip neutral">Closed</span>' : ''}${p.archived ? ' <span class="chip neutral">Archived</span>' : ''}</label>`).join('')}</div>`
  : '<div class="small muted">No jobs yet.</div>';

export function vAdmin(app) {
  APP = app; start(app);
  const S = app.S;
  const secs = [['users', 'People'], ['invites', 'Invites'], ['jobs', 'Jobs'], ['cleanup', 'Cleanup'], ['audit', 'Audit'], ['import', 'Import']];
  let h = `<div class="seg wrap3" role="group" aria-label="Admin section">${secs.map(([k, l]) => `<button data-act="admSec" data-sec="${k}" aria-pressed="${A.sec === k}">${l}</button>`).join('')}</div>`;
  h += ({ users: secUsers, invites: secInvites, jobs: secJobs, cleanup: secCleanup, audit: secAudit, import: secImport })[A.sec](app);
  return h;
}

/* ---------- people ---------- */
function secUsers(app) {
  if (A.edit && A.edit.type === 'user') return editUser(app);
  let h = `<p class="small muted" style="margin:0 2px">${Object.entries(ROLES).map(([k, v]) => `<b>${v}:</b> ${ROLE_HELP[k]}`).join('<br>')}</p>`;
  h += `<div class="list">`;
  if (!A.users.length) h += `<div class="empty">Loading people…</div>`;
  for (const u of A.users) {
    h += `<button class="item" data-act="admEditUser" data-id="${esc(u.id)}"><div class="spread"><div style="min-width:0"><div class="name">${esc(u.name || u.email)}${u.id === app.UID ? ' <span class="chip acc">You</span>' : ''}</div><div class="meta">${esc(u.email)} · ${(u.projects || []).length} job${(u.projects || []).length === 1 ? '' : 's'}</div></div>
      <span class="chips">${u.active ? '' : '<span class="chip bad">Disabled</span>'}<span class="chip neutral">${esc(ROLES[u.role] || u.role)}</span></span></div></button>`;
  }
  return h + `</div><div class="small muted">To remove someone completely, disable them here. Deleting the login itself is done in the Firebase console under Authentication.</div>`;
}
function editUser(app) {
  const u = A.users.find(x => x.id === A.edit.id); if (!u) { A.edit = null; return secUsers(app); }
  const self = u.id === app.UID;
  return `<section class="panel pad stack">
    <div class="spread"><div><div class="eyebrow">Person</div><h2 style="font-size:22px">${esc(u.name || u.email)}</h2><div class="small muted">${esc(u.email)}</div></div><button class="btn sm" data-act="admBack">Back</button></div>
    <label class="f">Role<select id="auRole" ${self ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    ${self ? '<div class="small muted">You can\'t change your own role or disable yourself. Another admin can.</div>' : ''}
    <label class="check"><input type="checkbox" id="auActive" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> Account active (can sign in and see data)</label>
    <div class="eyebrow">Jobs this person can see</div>
    ${u.role === 'admin' ? '<div class="small muted">Admins see every job.</div>' : jobChecks(app, u.projects || [], 'u')}
    <button class="btn primary" data-act="admSaveUser" data-id="${esc(u.id)}">Save changes</button>
  </section>`;
}

/* ---------- invites ---------- */
function secInvites(app) {
  const url = location.origin + location.pathname;
  const emails = new Set(A.users.map(u => String(u.email).toLowerCase()));
  let h = `<section class="panel pad stack">
    <div class="eyebrow">Invite someone</div>
    <div class="grid2"><label class="f">Email<input id="aiEmail" type="email" autocomplete="off" placeholder="name@company.com"></label>
    <label class="f">Name<input id="aiName" placeholder="First Last"></label></div>
    <label class="f">Role<select id="aiRole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'counter' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="eyebrow">Jobs</div>${jobChecks(app, [], 'i')}
    <button class="btn primary" data-act="admInvite">Create invitation</button>
    <div class="formula">Then send them this link and tell them to tap <b>Create account</b> using the same email: <br><b style="user-select:all;word-break:break-all">${esc(url)}</b><br>They confirm their email, and their role and jobs are applied when they first sign in.</div>
  </section>`;
  h += `<section class="group"><h2>Invitations</h2><div class="list">`;
  if (!A.invites.length) h += `<div class="empty">No invitations.</div>`;
  for (const i of A.invites) {
    const used = emails.has(i.id);
    h += `<div class="logrow"><div><div style="font-weight:600">${esc(i.name || i.id)} <span class="chip ${used ? 'ok' : 'warn'}">${used ? 'Joined' : 'Waiting'}</span></div><div class="small muted">${esc(i.id)} · ${esc(ROLES[i.role] || i.role)} · ${(i.projects || []).map(p => esc(projName(app, p))).join(', ') || 'no jobs'}</div></div>${confirmBtn('admDelInvite', i.id, used ? 'Remove' : 'Cancel invite')}</div>`;
  }
  return h + `</div></section>`;
}

/* ---------- jobs ---------- */
function secJobs(app) {
  const list = [...(app.S.allProjects || [])].sort((a, b) => String(a.number).localeCompare(b.number));
  let h = `<p class="small muted" style="margin:0 2px">Archive hides a finished job from everyone's job picker but keeps its data. Delete permanently removes the job and every count, order and entry in it.</p><div class="list">`;
  if (!list.length) h += `<div class="empty">No jobs yet.</div>`;
  for (const p of list) {
    const people = A.users.filter(u => u.role !== 'admin' && (u.projects || []).includes(p.id));
    h += `<div class="logrow" style="flex-wrap:wrap"><div style="min-width:0;flex:1"><div style="font-weight:600">${esc(p.number)} ${esc(p.name || '')} ${p.archived ? '<span class="chip neutral">Archived</span>' : p.closed ? '<span class="chip neutral">Closed</span>' : '<span class="chip ok">Open</span>'}</div>
      <div class="small muted">${people.length ? people.map(u => esc(u.name || u.email)).join(', ') : 'No one assigned besides admins'}</div></div>
      <span class="row">${p.archived ? `<button class="btn sm" data-act="admArchive" data-id="${esc(p.id)}" data-val="0">Unarchive</button>` : `<button class="btn sm" data-act="admArchive" data-id="${esc(p.id)}" data-val="1">Archive</button>`}
      ${A.confirm && A.confirm.act === 'admDelJob' && A.confirm.id === p.id
        ? `<span class="row"><input id="ajConfirm" placeholder="Type ${esc(p.number)}" style="border:1px solid var(--line);border-radius:8px;padding:8px;width:130px;background:var(--sunk)"><button class="btn sm danger solid" data-act="admDelJob" data-id="${esc(p.id)}" ${A.busy ? 'disabled' : ''}>Delete forever</button><button class="btn sm" data-act="admCancel">Keep</button></span>`
        : `<button class="btn sm danger" data-act="admAsk" data-confirm="admDelJob" data-id="${esc(p.id)}">Delete</button>`}</span></div>`;
  }
  return h + `</div>`;
}

/* ---------- cleanup ---------- */
const norm = s => String(s || '').toLowerCase().replace(/inch(es)?|in\b/g, '"').replace(/[^a-z0-9#"']/g, '');
function secCleanup(app) {
  const S = app.S;
  if (!S.pid) return `<div class="panel empty">Pick a job in the header to clean up its data.</div>`;
  const p = S.projects.find(x => x.id === S.pid) || {};
  const voided = COLS.flatMap(c => (S.voided[c] || []).map(d => ({ ...d, coll: c })));
  let h = `<div class="banner info"><b>Job: ${esc(p.number)} ${esc(p.name || '')}.</b> Cleanup works on the job selected in the header. Purges are permanent and need a connection.</div>`;

  // voided
  h += `<section class="group"><div class="spread"><h2 style="font-size:18px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Voided entries · ${voided.length}</h2>${voided.length ? confirmBtn('admPurgeVoided', 'all', 'Purge all voided') : ''}</div><div class="list">`;
  if (!voided.length) h += `<div class="empty">Nothing voided on this job.</div>`;
  for (const d of voided.slice(0, 60)) {
    const what = d.coll === 'items' ? d.name : d.coll === 'groups' ? d.name : d.coll === 'orders' ? 'PO ' + (d.po || '') : (d.at ? APP.fDate(d.at) : '');
    h += `<div class="logrow"><div><div style="font-weight:600">${esc(COL_NAMES[d.coll])} · ${esc(what)}</div><div class="small muted">Voided by ${esc(d.void.name || d.void.by)} ${d.void.at ? APP.fDate(d.void.at) : ''}</div></div>
      <span class="row"><button class="btn sm" data-act="admRestore" data-id="${esc(d.coll + '|' + d.id)}">Restore</button>${confirmBtn('admPurgeOne', d.coll + '|' + d.id, 'Purge')}</span></div>`;
  }
  h += `</div></section>`;

  // duplicates
  const groups = {}; for (const it of S.items) { const k = norm(it.name); (groups[k] ||= []).push(it); }
  const dups = Object.values(groups).filter(g => g.length > 1);
  h += `<section class="group"><h2>Duplicate materials · ${dups.length}</h2><div class="list">`;
  if (!dups.length) h += `<div class="empty">No materials with matching names.</div>`;
  for (const g of dups) {
    const keep = g[0];
    h += `<div class="logrow" style="flex-wrap:wrap"><div style="min-width:0;flex:1"><div style="font-weight:600">${g.map(x => esc(x.name)).join(' · ')}</div><div class="small muted">Merging keeps “${esc(keep.name)}” and moves every count, delivery, order line and waste entry from the others onto it.</div></div>${confirmBtn('admMerge', g.map(x => x.id).join(','), 'Merge', 'primary')}</div>`;
  }
  h += `</div></section>`;

  // unused
  const M = app.model();
  const used = new Set();
  for (const c of S.counts) Object.keys(c.qty || {}).forEach(k => used.add(k));
  for (const d of S.deliveries) [...Object.keys(d.lines || {}), ...Object.keys(d.rejected || {})].forEach(k => used.add(k));
  for (const o of S.orders) (o.lines || []).forEach(l => used.add(l.itemId));
  for (const u of S.usage) used.add(u.itemId);
  const unused = M.items.filter(r => !used.has(r.it.id) && r.req == null);
  h += `<section class="group"><h2>Unused materials · ${unused.length}</h2><div class="list">`;
  if (!unused.length) h += `<div class="empty">Every material has a quantity or activity.</div>`;
  for (const r of unused) h += `<div class="logrow"><div><div style="font-weight:600">${esc(r.it.name)}</div><div class="small muted">No takeoff quantity, counts, orders or waste</div></div>${confirmBtn('admPurgeOne', 'items|' + r.it.id, 'Delete')}</div>`;
  h += `</div></section>`;

  // audit purge
  h += `<section class="panel pad stack"><div class="eyebrow">Audit log size</div><p class="small" style="margin:0">Audit entries older than the cutoff are deleted for all jobs. The newest entries are always kept.</p>
    <div class="row"><select id="acDays" style="border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--sunk);min-height:44px">${[90, 180, 365].map(d => `<option value="${d}" ${d === 180 ? 'selected' : ''}>Older than ${d} days</option>`).join('')}</select>${confirmBtn('admPurgeAudit', 'x', 'Purge old audit entries')}</div></section>`;
  return h;
}

/* ---------- audit ---------- */
function secAudit(app) {
  if (A.audit === null) { loadAudit(); return `<div class="panel empty">Loading the audit log…</div>`; }
  let h = `<div class="spread"><span class="small muted">Latest ${A.audit.length} changes, all jobs</span><button class="btn sm" data-act="admAuditRefresh">Refresh</button></div><div class="list">`;
  if (!A.audit.length) h += `<div class="empty">No changes recorded yet.</div>`;
  for (const a of A.audit) {
    const t = a.at && a.at.toDate ? a.at.toDate() : null;
    const parts = String(a.path || '').split('/');
    const where = parts[0] === 'projects' ? `${projName(app, parts[1])}${parts[2] ? ' · ' + (COL_NAMES[parts[2]] || parts[2]) : ''}` : parts[0];
    const action = a.detail && String(a.detail).includes('"void"') ? 'void' : a.action;
    h += `<div class="logrow"><div style="min-width:0"><div style="font-weight:600">${esc(action)} · ${esc(where)}</div><div class="small muted">${esc(a.email || a.uid)} · ${t ? t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'waiting to sync'}</div>${a.detail ? `<div class="small muted" style="word-break:break-all">${esc(String(a.detail).slice(0, 160))}</div>` : ''}</div></div>`;
  }
  return h + `</div>`;
}

/* ---------- import ---------- */
function secImport(app) {
  return `<section class="panel pad stack"><div class="eyebrow">Import a job</div>
    <p class="small" style="margin:0">Loads a job exported from the Claude tracker (a .json file). Jobs that already exist here are skipped, so importing twice does no harm.</p>
    <label class="f">Export file<input type="file" id="aImpFile" accept=".json,application/json"></label>
    <div id="aImpInfo" class="small muted">${A.importInfo || ''}</div>
    <button class="btn primary" data-act="admImport" ${A.importText && !A.busy ? '' : 'disabled'}>${A.busy ? 'Importing…' : 'Import'}</button></section>
    <section class="panel pad stack"><div class="eyebrow">Back up</div><p class="small" style="margin:0">Downloads every job you can see, with all entries, in the same format. Keep a copy before big cleanups.</p><button class="btn" data-act="admExportAll">Download backup (.json)</button></section>`;
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'aImpFile') return;
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    const text = await f.text(); const j = JSON.parse(text);
    if (j.format !== 'jobsite-tracker-export' || !Array.isArray(j.projects)) throw new Error('not an export');
    A.importText = j;
    A.importInfo = j.projects.map(p => `${esc(p.data.number)} ${esc(p.data.name || '')}: ${Object.entries(p.collections || {}).map(([k, v]) => `${v.length} ${k}`).join(', ')}`).join('<br>');
  } catch (err) { A.importText = null; A.importInfo = 'That file isn\'t a tracker export. Choose the .json file Claude gave you.'; }
  rerender();
});

/* ---------- batch helpers ---------- */
async function commitAll(ops) { // ops: [{type:'set'|'update'|'delete', ref, data}]
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(fs);
    for (const o of ops.slice(i, i + 400)) { if (o.type === 'delete') b.delete(o.ref); else if (o.type === 'update') b.update(o.ref, o.data); else b.set(o.ref, o.data); }
    await b.commit();
  }
}
function needOnline() { if (!navigator.onLine) { APP.toast('Connect to the internet first. Cleanup changes are permanent and run on the server.'); return false; } return true; }
function audit(action, path, detail) { const r = doc(collection(fs, 'audit')); return { type: 'set', ref: r, data: { at: serverTimestamp(), uid: APP.UID, email: APP.ME.email, action, path, pid: path.split('/')[1] || null, detail } }; }

/* ---------- actions ---------- */
export async function adminAct(a, el, app) {
  APP = app; const S = app.S; const id = el.dataset.id;
  const g = x => document.getElementById(x);
  switch (a) {
    case 'admSec': A.sec = el.dataset.sec; A.edit = null; A.confirm = null; if (A.sec === 'audit') A.audit = null; rerender(); break;
    case 'admAsk': A.confirm = { act: el.dataset.confirm, id }; rerender(); break;
    case 'admCancel': A.confirm = null; rerender(); break;
    case 'admBack': A.edit = null; rerender(); break;
    case 'admEditUser': A.edit = { type: 'user', id }; rerender(); break;
    case 'admSaveUser': {
      const u = A.users.find(x => x.id === id); if (!u) return;
      const checks = [...document.querySelectorAll('[data-ujob]')];
      const body = { projects: checks.length ? checks.filter(i => i.checked).map(i => i.dataset.ujob) : (u.projects || []) };
      if (id !== app.UID) { body.role = g('auRole').value; body.active = g('auActive').checked; }
      updateDoc(doc(fs, 'users/' + id), body).catch(e => { console.error(e); app.toast('Could not save. Check your connection.'); });
      setDoc(doc(collection(fs, 'audit')), { at: serverTimestamp(), uid: app.UID, email: app.ME.email, action: 'user update', path: 'users/' + id, pid: null, detail: JSON.stringify(body) }).catch(() => {});
      A.edit = null; app.toast('Saved'); rerender(); break;
    }
    case 'admInvite': {
      const email = g('aiEmail').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { g('aiEmail').focus(); app.toast('Enter a valid email address.'); return; }
      if (A.users.some(u => String(u.email).toLowerCase() === email)) { app.toast('That person already has an account. Edit them under People.'); return; }
      const projects = [...document.querySelectorAll('[data-ijob]')].filter(i => i.checked).map(i => i.dataset.ijob);
      const data = { role: g('aiRole').value, name: g('aiName').value.trim(), projects, invitedBy: app.UID, createdAt: serverTimestamp() };
      setDoc(doc(fs, 'invites/' + email), data).catch(e => { console.error(e); app.toast('Could not save the invitation.'); });
      setDoc(doc(collection(fs, 'audit')), { at: serverTimestamp(), uid: app.UID, email: app.ME.email, action: 'invite', path: 'invites/' + email, pid: null, detail: JSON.stringify({ role: data.role, projects }) }).catch(() => {});
      app.toast('Invitation created'); rerender(); break;
    }
    case 'admDelInvite': deleteDoc(doc(fs, 'invites/' + id)).catch(e => console.error(e)); A.confirm = null; app.toast('Invitation removed'); rerender(); break;
    case 'admArchive': updateDoc(doc(fs, 'projects/' + id), { archived: el.dataset.val === '1' }).catch(e => console.error(e)); app.toast(el.dataset.val === '1' ? 'Job archived' : 'Job restored'); break;
    case 'admDelJob': {
      const p = (S.allProjects || []).find(x => x.id === id); if (!p) return;
      if ((g('ajConfirm')?.value || '').trim() !== String(p.number)) { app.toast(`Type ${p.number} to confirm.`); return; }
      if (!needOnline()) return;
      A.busy = true; rerender();
      try {
        const ops = [];
        for (const c of COLS) { const s = await getDocs(collection(fs, `projects/${id}/${c}`)); s.docs.forEach(d => ops.push({ type: 'delete', ref: d.ref })); }
        ops.push({ type: 'delete', ref: doc(fs, 'projects/' + id) });
        ops.push(audit('delete job', 'projects/' + id, `${p.number} ${p.name || ''}, ${ops.length - 1} entries`));
        await commitAll(ops);
        for (const u of A.users) if ((u.projects || []).includes(id)) updateDoc(doc(fs, 'users/' + u.id), { projects: u.projects.filter(x => x !== id) }).catch(() => {});
        app.toast('Job deleted');
      } catch (e) { console.error(e); app.toast('Delete stopped partway. Check your connection and run it again.'); }
      A.busy = false; A.confirm = null; rerender(); break;
    }
    case 'admRestore': { const [c, d] = id.split('|'); updateDoc(doc(fs, `projects/${S.pid}/${c}/${d}`), { void: deleteField() }).catch(e => console.error(e)); app.toast('Restored'); break; }
    case 'admPurgeOne': {
      if (!needOnline()) return; const [c, d] = id.split('|');
      try { await commitAll([{ type: 'delete', ref: doc(fs, `projects/${S.pid}/${c}/${d}`) }, audit('purge', `projects/${S.pid}/${c}/${d}`, null)]); app.toast('Purged'); } catch (e) { console.error(e); app.toast('Could not purge. Try again.'); }
      A.confirm = null; rerender(); break;
    }
    case 'admPurgeVoided': {
      if (!needOnline()) return;
      const ops = COLS.flatMap(c => (S.voided[c] || []).map(d => ({ type: 'delete', ref: doc(fs, `projects/${S.pid}/${c}/${d.id}`) })));
      ops.push(audit('purge voided', `projects/${S.pid}`, `${ops.length} entries`));
      try { await commitAll(ops); app.toast(`Purged ${ops.length - 1} voided entries`); } catch (e) { console.error(e); app.toast('Purge stopped partway. Try again.'); }
      A.confirm = null; rerender(); break;
    }
    case 'admMerge': {
      if (!needOnline()) return;
      const [keep, ...drop] = id.split(','); const dropSet = new Set(drop); const base = `projects/${S.pid}`;
      const mapQty = obj => { if (!obj) return null; let ch = false; const o = { ...obj }; for (const k of Object.keys(o)) if (dropSet.has(k)) { o[keep] = (Number(o[keep]) || 0) + (Number(o[k]) || 0); delete o[k]; ch = true; } return ch ? o : null; };
      const ops = [];
      for (const c of [...S.counts, ...(S.voided.counts || [])]) { const q = mapQty(c.qty); if (q) ops.push({ type: 'update', ref: doc(fs, `${base}/counts/${c.id}`), data: { qty: q } }); }
      for (const d of [...S.deliveries, ...(S.voided.deliveries || [])]) { const l = mapQty(d.lines), r = mapQty(d.rejected); if (l || r) ops.push({ type: 'update', ref: doc(fs, `${base}/deliveries/${d.id}`), data: { ...(l ? { lines: l } : {}), ...(r ? { rejected: r } : {}) } }); }
      for (const o of [...S.orders, ...(S.voided.orders || [])]) {
        if (!(o.lines || []).some(l => dropSet.has(l.itemId))) continue;
        const merged = []; for (const l of o.lines) { const it = dropSet.has(l.itemId) ? keep : l.itemId; const ex = merged.find(m => m.itemId === it); if (ex) ex.qty += Number(l.qty) || 0; else merged.push({ itemId: it, qty: Number(l.qty) || 0 }); }
        ops.push({ type: 'update', ref: doc(fs, `${base}/orders/${o.id}`), data: { lines: merged } });
      }
      for (const u of [...S.usage, ...(S.voided.usage || [])]) if (dropSet.has(u.itemId)) ops.push({ type: 'update', ref: doc(fs, `${base}/usage/${u.id}`), data: { itemId: keep } });
      for (const d of drop) ops.push({ type: 'delete', ref: doc(fs, `${base}/items/${d}`) });
      ops.push(audit('merge materials', `${base}/items/${keep}`, `merged ${drop.join(', ')}`));
      try { await commitAll(ops); app.toast('Materials merged'); } catch (e) { console.error(e); app.toast('Merge stopped partway. Run it again to finish.'); }
      A.confirm = null; rerender(); break;
    }
    case 'admPurgeAudit': {
      if (!needOnline()) return;
      const days = Number(g('acDays')?.value || 180); const cutoff = new Date(Date.now() - days * 864e5);
      try {
        let total = 0;
        for (;;) { const s = await getDocs(query(collection(fs, 'audit'), where('at', '<', cutoff), limit(400))); if (s.empty) break; await commitAll(s.docs.map(d => ({ type: 'delete', ref: d.ref }))); total += s.size; if (s.size < 400) break; }
        app.toast(`Deleted ${total} old audit entries`);
      } catch (e) { console.error(e); app.toast('Could not purge the audit log. Try again.'); }
      A.confirm = null; A.audit = null; rerender(); break;
    }
    case 'admAuditRefresh': A.audit = null; rerender(); break;
    case 'admImport': {
      const j = A.importText; if (!j || !needOnline()) return;
      A.busy = true; rerender();
      const existing = new Set((S.allProjects || []).map(p => p.id));
      let done = 0, skipped = 0;
      try {
        for (const p of j.projects) {
          if (existing.has(p.id)) { skipped++; continue; }
          const ops = [{ type: 'set', ref: doc(fs, 'projects/' + p.id), data: { ...p.data, sample: false, createdBy: app.UID, createdAt: serverTimestamp(), importedFrom: j.source || 'export' } }];
          for (const [c, docs] of Object.entries(p.collections || {})) { if (!COLS.includes(c)) continue; for (const d of docs) ops.push({ type: 'set', ref: doc(fs, `projects/${p.id}/${c}/${d.id}`), data: { ...d.data, createdBy: d.data.createdBy || app.UID, createdAt: serverTimestamp() } }); }
          ops.push(audit('import job', 'projects/' + p.id, `${ops.length - 1} entries`));
          await commitAll(ops); done++;
        }
        app.toast(`Imported ${done} job${done === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} already here` : ''}`);
        A.importText = null; A.importInfo = '';
      } catch (e) { console.error(e); app.toast('Import stopped partway: ' + (e.code || e.message)); }
      A.busy = false; rerender(); break;
    }
    case 'admExportAll': {
      if (!needOnline()) return;
      try {
        const out = { format: 'jobsite-tracker-export', version: 1, source: 'backup', exportedAt: new Date().toISOString(), projects: [] };
        for (const p of S.allProjects || []) {
          const { id: pid, ...data } = p; const collections = {};
          for (const c of COLS) { const s = await getDocs(collection(fs, `projects/${pid}/${c}`)); collections[c] = s.docs.map(d => { const v = { ...d.data() }; delete v.createdAt; return { id: d.id, data: v }; }); }
          delete data.createdAt; out.projects.push({ id: pid, data, collections });
        }
        app.saveFile(`jobsite-tracker-backup_${app.today()}.json`, JSON.stringify(out, null, 1), 'application/json');
        app.toast('Backup saved');
      } catch (e) { console.error(e); app.toast('Backup failed. Check your connection.'); }
      break;
    }
  }
}

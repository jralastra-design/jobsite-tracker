// Inventory-check schedule and block totals. Pure functions shared by the app and the reminder sender
// (scripts/send-reminders.mjs), so both always agree on when a count is due.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_SCHEDULE = { enabled: false, days: [1], time: '06:30', everyBlock: null, escalate: true, escalateTime: '15:00',
  notifyCounters: true, notifyPMs: true, tz: 'America/New_York' };

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const live = a => (a || []).filter(d => !d.void);
function addDays(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

// Local date and time in a time zone: {date:'2026-10-24', hm:'09:59', dow:6}
export function localNow(tz, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, dow: WEEKDAYS.indexOf(p.weekday) };
}

// Total of all primary units in a production group (e.g. every block type together).
// Each type's own number changes only at inventory counts; the total also subtracts what was laid since the last count.
export function groupStock(gid, { items, counts, deliveries, usage, production }) {
  const prim = live(items).filter(i => i.group === gid && i.role === 'primary');
  const cs = live(counts).slice().sort(byAt);
  let counted = 0, sinceTotal = 0, lastAt = null;
  for (const it of prim) {
    const hist = cs.filter(c => c.qty && c.qty[it.id] != null && c.qty[it.id] !== '');
    if (!hist.length) continue;
    const L = hist[hist.length - 1];
    let q = num(L.qty[it.id]);
    for (const d of live(deliveries)) if (d.at > L.at && d.lines && d.lines[it.id] != null) q += num(d.lines[it.id]);
    for (const u of live(usage)) if (u.itemId === it.id && u.at > L.at) q += u.reason === 'xfer-in' ? num(u.qty) : -num(u.qty);
    counted++; sinceTotal += q; if (!lastAt || L.at > lastAt) lastAt = L.at;
  }
  const laidSince = live(production).filter(e => e.groupId === gid && (!lastAt || e.at > lastAt)).reduce((s, e) => s + num(e.qty), 0);
  return { primaries: prim.length, counted, countedOnHand: sinceTotal, laidSince, est: counted ? sinceTotal - laidSince : null, lastAt };
}

// Is an inventory count due? Weekly days at a set time, and/or after N units laid since the last count.
export function countStatus(project, { counts, production }, now = new Date()) {
  const s = { ...DEFAULT_SCHEDULE, ...(project.countSchedule || {}) };
  const t = localNow(s.tz, now);
  const cs = live(counts).slice().sort(byAt);
  const last = cs[cs.length - 1] || null;
  const countedToday = cs.some(c => String(c.at).slice(0, 10) === t.date);
  const laidSince = live(production).filter(e => !last || e.at > last.at).reduce((s2, e) => s2 + num(e.qty), 0);
  const reasons = [];
  if (!s.enabled || project.closed || project.archived) return { enabled: false, due: false, reasons, countedToday, laidSince, last, today: t, s };
  // Most recent scheduled count date that has arrived; due until a count is saved on or after it.
  let sched = null;
  for (let k = 0; k < 7 && (s.days || []).length; k++) {
    const dow = (t.dow - k + 7) % 7;
    if (s.days.includes(dow) && (k > 0 || t.hm >= (s.time || '00:00'))) { sched = { date: addDays(t.date, -k), dow, k }; break; }
  }
  if (sched && (!last || String(last.at).slice(0, 10) < sched.date))
    reasons.push({ kind: 'weekly', date: sched.date, text: sched.k === 0 ? `${WEEKDAYS[sched.dow]} count is scheduled for today` : `${WEEKDAYS[sched.dow]}'s scheduled count hasn't been done` });
  const every = num(s.everyBlock);
  if (every > 0 && laidSince >= every) reasons.push({ kind: 'block', text: `${Math.round(laidSince).toLocaleString('en-US')} laid since the last count` });
  const due = reasons.length > 0;
  const escalate = due && s.escalate && t.hm >= (s.escalateTime || '23:59');
  // next scheduled weekly day, for display
  let next = null;
  if ((s.days || []).length) for (let k = 0; k < 8; k++) { const d = (t.dow + k) % 7; if (s.days.includes(d) && !(k === 0 && (countedToday || t.hm >= s.time))) { next = { inDays: k, dow: d, time: s.time }; break; } }
  return { enabled: true, due, reasons, escalate, countedToday, laidSince, last, today: t, next, s };
}

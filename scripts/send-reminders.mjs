// Scheduled reminder sender. Runs on GitHub Actions every 15 minutes (see .github/workflows/reminders.yml).
// Reads each open job's count schedule, works out who needs a reminder, and sends phone notifications
// through Firebase Cloud Messaging. Each reminder is logged in notifyLog so it is sent once.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { countStatus, groupStock, localNow } from '../src/schedule.js';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT secret is not set; nothing to do.'); process.exit(0); }
const APP_URL = process.env.APP_URL || 'https://jralastra-design.github.io/jobsite-tracker/';
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore(), fcm = getMessaging();
const DRY = process.env.DRY_RUN === '1';

const all = async path => (await db.collection(path).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const users = (await all('users')).filter(u => u.active);
const tokens = await all('pushTokens');
const tokensFor = uids => tokens.filter(t => uids.includes(t.uid));
let sent = 0;

async function once(key, fn) {
  const ref = db.doc('notifyLog/' + key);
  if ((await ref.get()).exists) return;
  const n = await fn();
  await ref.set({ at: FieldValue.serverTimestamp(), sent: n });
}
async function send(uids, title, body, link, tag) {
  const list = tokensFor([...new Set(uids)]);
  if (!list.length) return 0;
  if (DRY) { console.log('[dry]', title, '→', list.length, 'phones'); return list.length; }
  const res = await fcm.sendEachForMulticast({
    tokens: list.map(t => t.token),
    webpush: { notification: { title, body, icon: APP_URL + 'icon-192.png', tag }, fcmOptions: { link }, data: { link, tag: tag || '' } }
  });
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') db.doc('pushTokens/' + list[i].id).delete().catch(() => {});
    else if (r.error) console.warn('send failed', code);
  });
  sent += res.successCount; return res.successCount;
}

for (const p of await all('projects')) {
  if (p.closed || p.archived) continue;
  const base = `projects/${p.id}`;
  const label = `${p.number} ${p.name || ''}`.trim();
  const assigned = role => users.filter(u => u.role === role && (u.projects || []).includes(p.id)).map(u => u.id);
  const admins = users.filter(u => u.role === 'admin').map(u => u.id);
  const link = APP_URL + '#count';

  // test notification requested from Setup
  if (p.pushTestFor) {
    await send([p.pushTestFor], 'Test notification', `Reminders for ${label} will arrive like this.`, APP_URL + '#status', 'test');
    if (!DRY) await db.doc(base).update({ pushTestFor: FieldValue.delete(), pushTestAt: FieldValue.delete() });
  }

  const sched = p.countSchedule || {};
  const [counts, production, items, deliveries, usage, groups] = await Promise.all(['counts', 'production', 'items', 'deliveries', 'usage', 'groups'].map(c => all(`${base}/${c}`)));
  const st = countStatus(p, { counts, production });
  const today = localNow(sched.tz).date;

  if (st.enabled && st.due) {
    const who = [...(sched.notifyCounters !== false ? assigned('counter') : []), ...(sched.notifyPMs !== false ? assigned('pm') : [])];
    for (const r of st.reasons) {
      const key = r.kind === 'weekly' ? `${p.id}_count_${r.date}` : `${p.id}_block_${(st.last && st.last.id) || 'none'}`;
      await once(key, () => send(who, `Inventory count due · ${p.number}`, `${r.text}. Tap to open the Count tab.`, link, 'count-' + p.id));
    }
    if (st.escalate) await once(`${p.id}_escalate_${today}`, () => send([...assigned('pm'), ...admins], `Count not done · ${p.number}`, `Today's inventory count for ${label} hasn't been saved yet.`, link, 'escalate-' + p.id));
  }

  for (const g of groups.filter(g => !g.void && g.lowStock != null && g.lowStock !== '')) {
    const gs = groupStock(g.id, { items, counts, deliveries, usage, production });
    if (gs.est != null && gs.est < Number(g.lowStock))
      await once(`${p.id}_low_${g.id}_${today}`, () => send([...assigned('pm'), ...admins], `Low ${g.unit || 'stock'} · ${p.number}`,
        `About ${Math.round(gs.est).toLocaleString('en-US')} ${g.unit || 'units'} on hand (all types), below your ${Number(g.lowStock).toLocaleString('en-US')} warning level.`, APP_URL + '#orders', 'low-' + p.id));
  }
}
console.log(`Done. ${sent} notifications delivered.`);

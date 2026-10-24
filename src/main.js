import './styles.css';
import { auth, authApi, fs, doc, getDoc, setDoc, onSnapshot, serverTimestamp, setAuditUser, sync } from './fb.js';
import { OWNER_EMAIL, COMPANY } from './config.js';
import { startApp, stopApp, appState } from './app.js';
import { pushState, enablePush, disablePush } from './push.js';

const main = () => document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let meUnsub = null, mode = 'signin', note = '', busy = false, currentUser = null;

function shell(on) {
  document.body.classList.toggle('signed-out', !on);
  if (!on) { document.getElementById('hJob').textContent = 'L&H'; document.getElementById('hName').textContent = 'Jobsite Tracker'; document.getElementById('tabs').innerHTML = ''; document.getElementById('projSel').hidden = true; }
}
function screen(html) { shell(false); main().innerHTML = `<div class="authbox">${html}</div>`; }

function showSignIn() {
  const signup = mode === 'signup';
  screen(`<section class="panel pad stack">
    <div class="eyebrow">${esc(COMPANY)}</div>
    <h2 style="font-size:28px">${signup ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Sign in'}</h2>
    ${signup ? '<p class="small muted" style="margin:0">Use the email address your admin invited. You\'ll get an email to confirm it.</p>' : ''}
    <form id="authForm" class="stack" novalidate>
      ${signup ? '<label class="f">Your name<input id="aName" autocomplete="name" required></label>' : ''}
      <label class="f">Email<input id="aEmail" type="email" autocomplete="email" inputmode="email" required></label>
      ${mode !== 'reset' ? `<label class="f">Password${signup ? ' (8+ characters)' : ''}<input id="aPass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 8 : 1}"></label>` : ''}
      ${note ? `<div class="banner ${/sent|Check/.test(note) ? 'info' : ''}">${note}</div>` : ''}
      <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : signup ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}</button>
    </form>
    <div class="row" style="justify-content:space-between">
      ${mode !== 'signin' ? '<button class="linkbtn" data-auth="signin">Back to sign in</button>' : '<button class="linkbtn" data-auth="signup">Create account</button><button class="linkbtn" data-auth="reset">Forgot password?</button>'}
    </div></section>`);
}
const AUTH_ERR = {
  'auth/invalid-credential': 'Email or password is wrong.', 'auth/wrong-password': 'Email or password is wrong.', 'auth/user-not-found': 'Email or password is wrong.',
  'auth/email-already-in-use': 'An account with that email already exists. Sign in instead.', 'auth/weak-password': 'Use at least 8 characters.',
  'auth/invalid-email': 'That email address doesn\'t look right.', 'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection. Signing in needs signal the first time; after that the app works offline.'
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-auth]'); if (!b) return;
  const a = b.dataset.auth;
  if (['signin', 'signup', 'reset'].includes(a)) { mode = a; note = ''; showSignIn(); }
  if (a === 'signout') { disablePush().finally(() => authApi.signOut()); }
  if (a === 'resend' && currentUser) { authApi.sendEmailVerification(currentUser).then(() => { note = 'Sent. Check your inbox and spam folder.'; showVerify(currentUser); }, err => { note = AUTH_ERR[err.code] || err.message; showVerify(currentUser); }); }
  if (a === 'verified' && currentUser) { currentUser.reload().then(() => currentUser.getIdToken(true)).then(() => route(auth.currentUser)); }
  if (a === 'retry' && currentUser) route(currentUser);
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'authForm') return;
  e.preventDefault();
  const email = document.getElementById('aEmail').value.trim(), pass = document.getElementById('aPass')?.value || '';
  if (!email) { note = 'Enter your email.'; showSignIn(); return; }
  busy = true; note = ''; showSignIn();
  try {
    if (mode === 'reset') { await authApi.sendPasswordResetEmail(email); note = 'Reset email sent. Check your inbox.'; mode = 'signin'; }
    else if (mode === 'signup') {
      const name = document.getElementById('aName').value.trim();
      const cred = await authApi.createUserWithEmailAndPassword(email, pass);
      if (name) await authApi.updateProfile(cred.user, { displayName: name });
      await authApi.sendEmailVerification(cred.user);
    } else await authApi.signInWithEmailAndPassword(email, pass);
  } catch (err) { note = AUTH_ERR[err.code] || err.message; }
  busy = false; if (!auth.currentUser || mode === 'signin' && note) showSignIn();
});

function showVerify(user) {
  screen(`<section class="panel pad stack"><div class="eyebrow">One more step</div><h2 style="font-size:26px">Confirm your email</h2>
    <p style="margin:0">We sent a link to <b>${esc(user.email)}</b>. Open it, then come back and tap the button below.</p>
    ${note ? `<div class="banner info">${esc(note)}</div>` : ''}
    <button class="btn primary" data-auth="verified">I've confirmed my email</button>
    <div class="row"><button class="linkbtn" data-auth="resend">Send the email again</button><button class="linkbtn" data-auth="signout">Use a different account</button></div></section>`);
}
function showMessage(title, body, actions = '') {
  screen(`<section class="panel pad stack"><h2 style="font-size:26px">${esc(title)}</h2><p style="margin:0">${body}</p><div class="row">${actions}<button class="btn" data-auth="signout">Sign out</button></div></section>`);
}

async function createProfile(user) {
  const email = user.email.toLowerCase();
  const name = user.displayName || '';
  if (email === OWNER_EMAIL.toLowerCase()) {
    await setDoc(doc(fs, 'users/' + user.uid), { email, name, role: 'admin', active: true, projects: [], createdAt: serverTimestamp() });
    return true;
  }
  const inv = await getDoc(doc(fs, 'invites/' + email));
  if (!inv.exists()) return false;
  const i = inv.data();
  await setDoc(doc(fs, 'users/' + user.uid), { email, name: name || i.name || '', role: i.role, active: true, projects: i.projects || [], createdAt: serverTimestamp() });
  return true;
}

function route(user) {
  currentUser = user;
  if (meUnsub) { meUnsub(); meUnsub = null; }
  if (!user) { stopApp(); setAuditUser(null); mode = mode === 'reset' ? 'reset' : 'signin'; showSignIn(); return; }
  if (!user.emailVerified) { stopApp(); showVerify(user); return; }
  note = '';
  let tried = false;
  main().innerHTML = '<div class="panel pad"><div class="eyebrow">Signing in</div><p class="muted">Loading your jobs…</p></div>';
  meUnsub = onSnapshot(doc(fs, 'users/' + user.uid), async snap => {
    if (snap.exists()) {
      const me = snap.data();
      if (!me.active) { stopApp(); showMessage('Account disabled', 'Your account has been turned off. Ask your admin to turn it back on.'); return; }
      setAuditUser({ uid: user.uid, email: me.email });
      shell(true);
      startApp(me, user.uid, { account: showAccount });
      return;
    }
    if (snap.metadata.fromCache) { if (!navigator.onLine) showMessage('Connect to finish setup', 'The first sign-in on a phone needs signal. After that the app works without it.', '<button class="btn primary" data-auth="retry">Try again</button>'); return; }
    if (tried) return; tried = true;
    try {
      const ok = await createProfile(user);
      if (!ok) showMessage('No invitation found', `There's no invitation for <b>${esc(user.email)}</b>. Ask your admin to invite this email, then tap Try again.`, '<button class="btn primary" data-auth="retry">Try again</button>');
    } catch (err) { console.error(err); showMessage('Could not finish setup', esc(err.message), '<button class="btn primary" data-auth="retry">Try again</button>'); }
  }, err => { console.error(err); showMessage('Could not load your account', esc(err.message), '<button class="btn primary" data-auth="retry">Try again</button>'); });
}

const ROLE_LABEL = { admin: 'Admin', pm: 'Foreman / PM', counter: 'Field counter', viewer: 'Viewer' };
function showAccount() {
  const me = appState.ME || {}, u = auth.currentUser;
  const root = document.getElementById('sheetRoot');
  const errs = sync.errors.slice(-5).reverse();
  root.innerHTML = `<div class="sheetwrap" data-close="1"><div class="sheet" role="dialog" aria-modal="true">
    <div class="spread"><h2>Account</h2><button class="btn sm" data-close="1">Close</button></div>
    <dl class="kv"><dt>Name</dt><dd>${esc(me.name || '—')}</dd><dt>Email</dt><dd>${esc(u?.email)}</dd><dt>Role</dt><dd>${esc(ROLE_LABEL[me.role] || me.role)}</dd>
    <dt>Connection</dt><dd>${navigator.onLine ? 'Online' : 'Offline'}</dd><dt>Changes waiting to upload</dt><dd>${sync.pending}</dd></dl>
    ${errs.length ? `<div class="eyebrow">Recent problems</div><div class="list">${errs.map(e => `<div class="logrow"><div class="small">${esc(e.at.toLocaleTimeString())} · ${esc(e.code || '')} ${esc(e.message).slice(0, 140)}</div></div>`).join('')}</div>` : ''}
    <div class="formula" id="acctPush">Checking notifications…</div>
    <div class="small muted">To install on your phone: iPhone Safari, Share → Add to Home Screen. Android Chrome, ⋮ → Add to Home screen (or Install app).</div>
    <div class="row"><button class="btn" id="acctReset">Email me a password reset</button><button class="btn danger" data-auth="signout">Sign out</button></div>
  </div></div>`;
  fillAcctPush();
}
async function fillAcctPush() {
  const box = document.getElementById('acctPush'); if (!box) return;
  const st = await pushState();
  box.innerHTML = `<b>Notifications:</b> ${esc(st.text)} ${st.state === 'off' ? '<button class="btn sm primary" id="acctPushOn" style="margin-top:6px">Turn on notifications</button>' : ''}`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'acctPushOn' && auth.currentUser) {
    e.target.disabled = true;
    try { await enablePush(auth.currentUser.uid, n => appState.toast(n.title || 'Reminder')); appState.toast('Notifications are on for this phone'); }
    catch (err) { appState.toast(err.message || 'Could not turn on notifications.'); }
    fillAcctPush(); return;
  }
  if (e.target.dataset && e.target.dataset.close) { document.getElementById('sheetRoot').innerHTML = ''; return; }
  if (e.target.id === 'acctReset' && auth.currentUser) authApi.sendPasswordResetEmail(auth.currentUser.email).then(() => appState.toast('Reset email sent'), () => appState.toast('Could not send. Check your connection.'));
  if (e.target.closest('#acctBtn')) showAccount();
});

authApi.onAuthStateChanged(route);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW', e)));
}

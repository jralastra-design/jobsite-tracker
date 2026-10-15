// Firebase setup plus a small data layer the app uses everywhere.
// Writes never wait for the server: with no signal they are saved on the phone and
// Firestore uploads them when the connection comes back.
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, query, where,
  orderBy, limit, serverTimestamp, writeBatch, onSnapshotsInSync, deleteField
} from 'firebase/firestore';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const fs = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const authApi = { onAuthStateChanged: cb => onAuthStateChanged(auth, cb), signInWithEmailAndPassword: (e, p) => signInWithEmailAndPassword(auth, e, p),
  createUserWithEmailAndPassword: (e, p) => createUserWithEmailAndPassword(auth, e, p), sendEmailVerification, sendPasswordResetEmail: e => sendPasswordResetEmail(auth, e),
  signOut: () => signOut(auth), updateProfile };
export { doc, collection, getDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, setDoc, updateDoc, deleteDoc, deleteField };

/* ---------- write tracking ---------- */
const listeners = new Set();
export const sync = { pending: 0, errors: [], online: navigator.onLine };
const emit = () => listeners.forEach(f => { try { f(sync); } catch (e) { console.error(e); } });
export function onSync(f) { listeners.add(f); f(sync); return () => listeners.delete(f); }
window.addEventListener('online', () => { sync.online = true; emit(); });
window.addEventListener('offline', () => { sync.online = false; emit(); });
onSnapshotsInSync(fs, () => emit());

function track(p, label) {
  sync.pending++; emit();
  p.then(() => {}, e => {
    console.error(label, e);
    sync.errors.push({ at: new Date(), label, code: e && e.code, message: (e && e.message) || String(e) });
    if (sync.errors.length > 20) sync.errors.shift();
    sync.lastError = sync.errors[sync.errors.length - 1];
  }).finally(() => { sync.pending--; emit(); });
  return p;
}

/* ---------- audit ---------- */
let audit = null; // {uid, email}
export function setAuditUser(u) { audit = u; }
function log(action, path, detail) {
  if (!audit) return;
  const ref = doc(collection(fs, 'audit'));
  const pid = path.startsWith('projects/') ? path.split('/')[1] : null;
  track(setDoc(ref, { at: serverTimestamp(), uid: audit.uid, email: audit.email, action, path, pid, detail: detail || null }), 'audit');
}
const summarize = d => { try { const s = JSON.stringify(d); return s.length > 400 ? s.slice(0, 400) + '…' : s; } catch { return null; } };
const isEntry = path => path.split('/').length >= 4; // projects/{pid}/{coll}/{doc}

/* ---------- adapter used by the app ---------- */
function stampCreate(path, data) {
  if (!audit) return data;
  const d = { ...data };
  if (isEntry(path) || path.startsWith('projects/')) { if (d.createdBy == null) d.createdBy = audit.uid; d.createdAt = serverTimestamp(); }
  return d;
}
function docApi(path) {
  const ref = doc(fs, path);
  return {
    id: ref.id, path,
    get: () => getDoc(ref),
    // set() is used both to create and to replace. Pass {create:true} to stamp creator fields.
    set: (data, opts = {}) => { const body = opts.create ? stampCreate(path, data) : data; log(opts.create ? 'create' : 'replace', path, summarize(data)); track(setDoc(ref, body), 'set ' + path); return Promise.resolve(); },
    update: data => { log('update', path, summarize(data)); track(updateDoc(ref, data), 'update ' + path); return Promise.resolve(); },
    delete: () => { log('delete', path, null); track(deleteDoc(ref), 'delete ' + path); return Promise.resolve(); },
    onSnapshot: (next, err) => onSnapshot(ref, { includeMetadataChanges: true }, next, err),
    collection: sub => collApi(path + '/' + sub)
  };
}
function collApi(path) {
  const ref = collection(fs, path);
  return {
    path,
    doc: id => docApi(id ? path + '/' + id : doc(ref).path),
    add: data => { const d = docApi(doc(ref).path); d.set(data, { create: true }); return Promise.resolve(d); },
    onSnapshot: (next, err) => onSnapshot(ref, { includeMetadataChanges: true }, snap => next({
      docs: snap.docs.map(d => ({ id: d.id, data: () => d.data(), pending: d.metadata.hasPendingWrites })),
      fromCache: snap.metadata.fromCache
    }), err),
    get: () => getDocs(ref)
  };
}
export const db = { doc: docApi, collection: collApi };

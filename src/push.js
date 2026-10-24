// Phone notifications through Firebase Cloud Messaging. The app only registers this phone;
// the reminders themselves are sent by scripts/send-reminders.mjs on a schedule.
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { app, fs, doc, setDoc, deleteDoc, serverTimestamp } from './fb.js';
import { VAPID_KEY } from './config.js';

const KEY = 'pushToken';
const recall = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const store = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} };
const tokenId = t => t.replace(/[^A-Za-z0-9_-]/g, '').slice(-140);

export async function pushState() {
  if (!VAPID_KEY) return { state: 'not-configured', text: 'Phone notifications are not set up for this app yet.' };
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported().catch(() => false))) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return { state: 'unsupported', text: ios && !standalone ? 'On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), open it from there, then turn notifications on.' : 'This browser can\'t receive notifications.' };
  }
  if (Notification.permission === 'denied') return { state: 'blocked', text: 'Notifications are blocked for this app. Allow them in your phone\'s settings for this app or site, then try again.' };
  if (Notification.permission === 'granted' && recall()) return { state: 'on', text: 'Notifications are on for this phone.' };
  return { state: 'off', text: 'Notifications are off for this phone.' };
}

let listening = false;
export async function enablePush(uid, onForeground) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission was not given.');
  const reg = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not get a notification token.');
  const old = recall(); if (old && old !== token) deleteDoc(doc(fs, 'pushTokens/' + tokenId(old))).catch(() => {});
  await setDoc(doc(fs, 'pushTokens/' + tokenId(token)), { uid, token, ua: navigator.userAgent.slice(0, 160), updatedAt: serverTimestamp() });
  store(token);
  if (!listening && onForeground) { listening = true; onMessage(messaging, m => onForeground(m.notification || m.data || {})); }
  return token;
}

export async function disablePush() {
  const t = recall(); if (!t) return;
  await deleteDoc(doc(fs, 'pushTokens/' + tokenId(t))).catch(() => {});
  store(null);
}

export async function resumePush(uid, onForeground) {
  if (!VAPID_KEY || !recall() || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { await enablePush(uid, onForeground); } catch (e) { console.warn('push refresh', e); }
}

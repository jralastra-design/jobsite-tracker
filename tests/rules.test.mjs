import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

const OWNER = 'owner@example.com';
let env;
const rules = readFileSync('firestore.rules', 'utf8').replace('jralastra@gmail.com', OWNER);
const tok = (email, verified = true) => ({ email, email_verified: verified });
const as = (uid, email, verified = true) => env.authenticatedContext(uid, tok(email, verified)).firestore();

before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-tracker', firestore: { rules, host: '127.0.0.1', port: 8080 } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users/admin'), { email: OWNER, role: 'admin', active: true, projects: [] });
    await setDoc(doc(db, 'users/pm'), { email: 'pm@x.com', role: 'pm', active: true, projects: ['P1'] });
    await setDoc(doc(db, 'users/ctr'), { email: 'ctr@x.com', role: 'counter', active: true, projects: ['P1'] });
    await setDoc(doc(db, 'users/ctr2'), { email: 'ctr2@x.com', role: 'counter', active: true, projects: ['P2'] });
    await setDoc(doc(db, 'users/view'), { email: 'view@x.com', role: 'viewer', active: true, projects: ['P1'] });
    await setDoc(doc(db, 'users/off'), { email: 'off@x.com', role: 'counter', active: false, projects: ['P1'] });
    await setDoc(doc(db, 'projects/P1'), { number: 'P1', createdBy: 'admin' });
    await setDoc(doc(db, 'projects/P2'), { number: 'P2', createdBy: 'admin' });
    await setDoc(doc(db, 'projects/CL'), { number: 'CL', createdBy: 'admin', closed: true });
    await setDoc(doc(db, 'projects/P1/counts/c1'), { qty: { a: 1 }, createdBy: 'ctr' });
    await setDoc(doc(db, 'projects/P1/counts/c2'), { qty: { a: 1 }, createdBy: 'pm' });
    await setDoc(doc(db, 'invites/new@x.com'), { role: 'counter', projects: ['P1'] });
  });
});

test('owner can bootstrap as admin; others cannot self-admin', async () => {
  await assertSucceeds(setDoc(doc(as('o2', OWNER), 'users/o2'), { email: OWNER, role: 'admin', active: true, projects: [] }));
  await assertFails(setDoc(doc(as('z', 'z@x.com'), 'users/z'), { email: 'z@x.com', role: 'admin', active: true, projects: [] }));
});

test('invited user must be verified and match invite role and projects', async () => {
  await assertFails(setDoc(doc(as('n', 'new@x.com', false), 'users/n'), { email: 'new@x.com', role: 'counter', active: true, projects: ['P1'] }));
  await assertFails(setDoc(doc(as('n', 'new@x.com'), 'users/n'), { email: 'new@x.com', role: 'admin', active: true, projects: ['P1'] }));
  await assertFails(setDoc(doc(as('n', 'new@x.com'), 'users/n'), { email: 'new@x.com', role: 'counter', active: true, projects: ['P1', 'P2'] }));
  await assertSucceeds(setDoc(doc(as('n', 'new@x.com'), 'users/n'), { email: 'new@x.com', role: 'counter', active: true, projects: ['P1'] }));
});

test('users cannot change their own role or projects', async () => {
  await assertFails(updateDoc(doc(as('ctr', 'ctr@x.com'), 'users/ctr'), { role: 'admin' }));
  await assertFails(updateDoc(doc(as('ctr', 'ctr@x.com'), 'users/ctr'), { projects: ['P1', 'P2'] }));
  await assertSucceeds(updateDoc(doc(as('ctr', 'ctr@x.com'), 'users/ctr'), { name: 'Joe' }));
  await assertSucceeds(updateDoc(doc(as('admin', OWNER), 'users/ctr'), { role: 'pm' }));
});

test('project visibility follows assignment', async () => {
  await assertSucceeds(getDoc(doc(as('ctr', 'ctr@x.com'), 'projects/P1')));
  await assertFails(getDoc(doc(as('ctr', 'ctr@x.com'), 'projects/P2')));
  await assertFails(getDocs(collection(as('ctr2', 'ctr2@x.com'), 'projects/P1/counts')));
  await assertFails(getDocs(collection(as('ctr', 'ctr@x.com'), 'projects')));
  await assertSucceeds(getDocs(collection(as('admin', OWNER), 'projects')));
  await assertFails(getDoc(doc(as('off', 'off@x.com'), 'projects/P1')));
});

test('pm sees projects they created via query', async () => {
  const db = as('pm', 'pm@x.com');
  await assertSucceeds(setDoc(doc(db, 'projects/P9'), { number: 'P9', createdBy: 'pm' }));
  await assertSucceeds(getDocs(query(collection(db, 'projects'), where('createdBy', '==', 'pm'))));
  await assertSucceeds(setDoc(doc(db, 'projects/P9/items/i1'), { name: 'x', createdBy: 'pm' }));
});

test('field roles log, counters cannot manage, viewers cannot write', async () => {
  const c = as('ctr', 'ctr@x.com');
  await assertSucceeds(setDoc(doc(c, 'projects/P1/counts/n1'), { qty: { a: 2 }, createdBy: 'ctr' }));
  await assertFails(setDoc(doc(c, 'projects/P1/counts/n2'), { qty: { a: 2 }, createdBy: 'pm' }));
  await assertFails(setDoc(doc(c, 'projects/P1/items/i1'), { name: 'x', createdBy: 'ctr' }));
  await assertFails(setDoc(doc(c, 'projects/P1/orders/o1'), { po: 'x', createdBy: 'ctr' }));
  await assertSucceeds(setDoc(doc(c, 'projects/P1/deliveries/d1'), { lines: {}, createdBy: 'ctr' }));
  await assertFails(setDoc(doc(as('view', 'view@x.com'), 'projects/P1/counts/v1'), { qty: {}, createdBy: 'view' }));
  await assertFails(updateDoc(doc(c, 'projects/P1'), { name: 'hack' }));
});

test('counters void only their own entries and change nothing else', async () => {
  const c = as('ctr', 'ctr@x.com');
  await assertSucceeds(updateDoc(doc(c, 'projects/P1/counts/c1'), { void: { by: 'ctr', reason: 'typo' } }));
  await assertFails(updateDoc(doc(c, 'projects/P1/counts/c1'), { qty: { a: 9 } }));
  await assertFails(updateDoc(doc(c, 'projects/P1/counts/c2'), { void: { by: 'ctr', reason: 'x' } }));
  await assertSucceeds(updateDoc(doc(as('pm', 'pm@x.com'), 'projects/P1/counts/c1'), { qty: { a: 9 } }));
});

test('only admins hard-delete', async () => {
  await assertFails(deleteDoc(doc(as('pm', 'pm@x.com'), 'projects/P1/counts/c1')));
  await assertSucceeds(deleteDoc(doc(as('admin', OWNER), 'projects/P1/counts/c1')));
});

test('closed jobs reject new entries but can be reopened by managers', async () => {
  const a = as('admin', OWNER);
  await assertFails(setDoc(doc(a, 'projects/CL/counts/x'), { qty: {}, createdBy: 'admin' }));
  await assertSucceeds(updateDoc(doc(a, 'projects/CL'), { closed: false }));
});

test('invites and audit are admin-only to read', async () => {
  await assertFails(getDocs(collection(as('pm', 'pm@x.com'), 'invites')));
  await assertSucceeds(getDoc(doc(as('n', 'new@x.com'), 'invites/new@x.com')));
  await assertFails(getDoc(doc(as('n', 'new@x.com'), 'invites/pm@x.com')));
  await assertSucceeds(setDoc(doc(as('ctr', 'ctr@x.com'), 'audit/a1'), { uid: 'ctr', action: 'x' }));
  await assertFails(getDocs(collection(as('ctr', 'ctr@x.com'), 'audit')));
  await assertFails(setDoc(doc(as('ctr', 'ctr@x.com'), 'audit/a2'), { uid: 'pm', action: 'x' }));
});

test('admin import: project first, then its entries', async () => {
  const a = as('admin', OWNER);
  await assertSucceeds(setDoc(doc(a, 'projects/IMP'), { number: 'IMP', createdBy: 'admin', closed: false }));
  await assertSucceeds(setDoc(doc(a, 'projects/IMP/items/i1'), { name: 'x', createdBy: 'admin' }));
  await assertSucceeds(setDoc(doc(a, 'projects/IMP/counts/c1'), { qty: { i1: 3 }, createdBy: 'admin' }));
});

test('phones register only their own notification token', async () => {
  const c = as('ctr', 'ctr@x.com');
  await assertSucceeds(setDoc(doc(c, 'pushTokens/t1'), { uid: 'ctr', token: 'abc' }));
  await assertFails(setDoc(doc(c, 'pushTokens/t2'), { uid: 'pm', token: 'abc' }));
  await assertFails(getDocs(collection(c, 'pushTokens')));
  await assertFails(deleteDoc(doc(as('pm', 'pm@x.com'), 'pushTokens/t1')));
  await assertSucceeds(deleteDoc(doc(c, 'pushTokens/t1')));
  await assertFails(setDoc(doc(as('off', 'off@x.com'), 'pushTokens/t3'), { uid: 'off', token: 'x' }));
});

test('only managers change the count schedule', async () => {
  await assertFails(updateDoc(doc(as('ctr', 'ctr@x.com'), 'projects/P1'), { countSchedule: { enabled: true } }));
  await assertSucceeds(updateDoc(doc(as('pm', 'pm@x.com'), 'projects/P1'), { countSchedule: { enabled: true } }));
});

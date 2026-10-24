// Firebase web config for this app. These values identify the Firebase project; they are not secrets.
// Access to data is controlled by firestore.rules, not by hiding these.
export const firebaseConfig = {
  apiKey: 'AIzaSyD_AOd6DgbrepekeoyglQO_fOyEnJr2U2I',
  authDomain: 'jobsite-material-tracker.firebaseapp.com',
  projectId: 'jobsite-material-tracker',
  storageBucket: 'jobsite-material-tracker.firebasestorage.app',
  messagingSenderId: '3616158063',
  appId: '1:3616158063:web:6fc2558dc02c681ad9f89a',
  measurementId: 'G-NN59L32DBM'
};

// The owner account. Must match ownerEmail() in firestore.rules (lowercase).
export const OWNER_EMAIL = 'jralastra@gmail.com';

export const COMPANY = 'Leidal & Hart';

// Web push public key (Firebase console › Project settings › Cloud Messaging › Web Push certificates). Public by design.
export const VAPID_KEY = '';

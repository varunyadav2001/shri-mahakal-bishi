import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "narayanbishi-cdb62.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "narayanbishi-cdb62",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "859533495525",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:859533495525:web:1239ec259005699930d80c",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-E4RG6WPKJV"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// Initialize Firestore with persistent IndexedDB multi-tab cache to eliminate repeated cloud reads
let firestoreDb: any;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch {
  firestoreDb = getFirestore(app);
}

export const db = firestoreDb;
export const storage = getStorage(app);

// Attempt anonymous sign-in if available so Firestore security rules succeed
if (typeof window !== 'undefined') {
  try {
    onAuthStateChanged(auth, (user: any) => {
      if (!user) {
        signInAnonymously(auth).catch((err: any) => {
          console.info('Firebase auth note:', err?.message || err);
        });
      }
    });
  } catch (e) {
    // Ignore if offline
  }
}

export let analytics: any = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported: boolean) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {});
}

export default app;

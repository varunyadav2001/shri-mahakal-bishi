import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
  apiKey: "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: "narayanbishi-cdb62.firebaseapp.com",
  projectId: "narayanbishi-cdb62",
  storageBucket: "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: "859533495525",
  appId: "1:859533495525:web:1239ec259005699930d80c",
  measurementId: "G-E4RG6WPKJV"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const requestFCMToken = async (): Promise<string | undefined> => {
  try {
    const supported = await isSupported();
    if (!supported) return undefined;
    const messaging = getMessaging(app);
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const currentToken = await getToken(messaging, {
        vapidKey: undefined,
      });
      return currentToken;
    }
  } catch (err) {
    console.warn('[FCM] Notification registration note:', err);
  }
  return undefined;
};

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: "narayanbishi-cdb62.firebaseapp.com",
  projectId: "narayanbishi-cdb62",
  storageBucket: "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: "859533495525",
  appId: "1:859533495525:web:1239ec259005699930d80c",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);
  const notificationTitle = payload.notification?.title || 'नारायण भिशी सूचना';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/logo.svg',
    badge: '/favicon.svg',
    data: payload.data,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

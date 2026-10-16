import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: "narayanbishi-cdb62.firebaseapp.com",
  projectId: "narayanbishi-cdb62",
  storageBucket: "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: "859533495525",
  appId: "1:859533495525:web:1239ec259005699930d80c",
  measurementId: "G-E4RG6WPKJV"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectScheme() {
  const d = await getDoc(doc(db, 'bishi_schemes', 'TEST22'));
  if (d.exists()) {
    console.log('bishi_schemes TEST22:', d.data());
  } else {
    const d2 = await getDoc(doc(db, 'bishi', 'TEST22'));
    console.log('bishi TEST22:', d2.data());
  }
  process.exit(0);
}

inspectScheme().catch(e => {
  console.error(e);
  process.exit(1);
});

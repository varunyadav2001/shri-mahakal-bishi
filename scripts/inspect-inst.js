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

async function inspectDoc() {
  const d = await getDoc(doc(db, 'customers', 'TEST22_Acc1_Amrut'));
  const data = d.data();
  console.log('Customer Doc fields:', Object.keys(data));
  console.log('Installment 0:', data.installments[0]);
  console.log('Installment 1:', data.installments[1]);
  console.log('Installment 2:', data.installments[2]);
  process.exit(0);
}

inspectDoc().catch(e => {
  console.error(e);
  process.exit(1);
});

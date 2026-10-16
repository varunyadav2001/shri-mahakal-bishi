import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

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

async function checkAmrut() {
  console.log('--- Checking Amrut in customers ---');
  const custSnap = await getDocs(collection(db, 'customers'));
  for (const d of custSnap.docs) {
    const data = d.data();
    if (data.mobile === '9999999999' || d.id.includes('Amrut')) {
      console.log(`Cust doc ID: ${d.id}`);
      console.log(`Name: ${data.name || data.customerName}, mobile: ${data.mobile}, account: ${data.accountNumber}`);
      console.log('Summary:', JSON.stringify(data.summary, null, 2));
      if (data.installments) {
        console.log(`Total installments: ${data.installments.length}`);
        const paidInst = data.installments.filter(i => i.status === 'PAID');
        console.log(`Paid installments count: ${paidInst.length}`);
        paidInst.forEach(i => console.log(`  Inst #${i.periodIndex || i.installmentNo}: status=${i.status}, collected=${i.collectedAmount || i.totalPaid}, expected=${i.expectedAmount}`));
      }
    }
  }

  console.log('\n--- Checking Amrut in collections ---');
  const collSnap = await getDocs(collection(db, 'collections'));
  for (const d of collSnap.docs) {
    const data = d.data();
    if (data.customerMobile === '9999999999' || data.customerName?.includes('Amrut') || d.id.includes('Amrut')) {
      console.log(`Coll: ${d.id}, period: ${data.periodIndex}, status: ${data.status}, collected: ${data.collectedAmount}, totalPaid: ${data.totalPaid}`);
    }
  }

  process.exit(0);
}

checkAmrut().catch(e => {
  console.error(e);
  process.exit(1);
});

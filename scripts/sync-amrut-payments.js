import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';

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

async function syncAmrut() {
  const custRef = doc(db, 'customers', 'TEST22_Acc1_Amrut');
  const custSnap = await getDoc(custRef);
  if (!custSnap.exists()) {
    console.error('Customer TEST22_Acc1_Amrut not found!');
    process.exit(1);
  }

  const data = custSnap.data();
  const installments = [...data.installments];
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nowIso = now.toISOString();

  for (let i = 0; i < 5; i++) {
    const inst = installments[i];
    const instNo = i + 1;
    const periodPad = String(instNo).padStart(2, '0');
    inst.status = 'PAID';
    inst.collectedAmount = 500;
    inst.totalPaid = 500;
    inst.totalWithPenalty = 500;
    inst.remainingAmount = 0;
    inst.paymentDate = todayDate;
    inst.paymentTime = timeStr;
    inst.paymentMode = inst.paymentMode || 'ONLINE';
    inst.note = inst.note || 'युझर ॲपद्वारे जमा';
    inst.updatedAt = nowIso;

    // Create / Update in collections with standard Admin Web formats
    const collDocData = {
      id: inst.id || `coll_cust_1792145497021_${instNo}`,
      customerId: data.id || 'cust_1792145497021',
      customerName: 'Amrut',
      customerMobile: '9999999999',
      accountNumber: '1',
      officeId: data.officeId || 'MAIN',
      bishiType: 'TEST22',
      bishiName: 'test22',
      periodIndex: instNo,
      periodLabel: `आठवडा ${instNo}`,
      dueDate: inst.dueDate || todayDate,
      paymentDate: todayDate,
      paymentTime: timeStr,
      paymentMode: inst.paymentMode || 'ONLINE',
      expectedAmount: 500,
      collectedAmount: 500,
      extraAmount: 0,
      remainingAmount: 0,
      interestAmount: 0,
      penaltyAmount: 0,
      totalPaid: 500,
      totalWithPenalty: 500,
      status: 'PAID',
      note: 'युझर ॲपद्वारे जमा (Online App Payment)',
      updatedAt: nowIso
    };

    // 1. Doc id format A: TEST22_Acc1_Amrut_Hapta_0X
    const collKeyA = `TEST22_Acc1_Amrut_Hapta_${periodPad}`;
    await setDoc(doc(db, 'collections', collKeyA), collDocData, { merge: true });

    // 2. Doc id format B: inst.id (e.g. coll_cust_1792145497021_X)
    if (inst.id) {
      await setDoc(doc(db, 'collections', inst.id), collDocData, { merge: true });
    }

    console.log(`Synced installment #${instNo} into collections (${collKeyA} & ${inst.id})`);
  }

  // Update summary
  const summary = {
    totalExpected: 26000,
    totalCollected: 2500,
    totalCollectedWithPenalty: 2500,
    totalRemaining: 23500,
    totalPenalty: 0,
    totalExtraAmount: 0,
    totalInstallments: 52,
    paidInstallments: 5,
    pendingInstallments: 47
  };

  await updateDoc(custRef, {
    installments: installments,
    summary: summary,
    updatedAt: nowIso
  });
  console.log('Customer doc TEST22_Acc1_Amrut updated with 5 paid installments!');

  // Update stats/summary
  await setDoc(doc(db, 'stats', 'summary'), {
    lastUpdated: nowIso,
    lastPaymentTimestamp: Date.now()
  }, { merge: true });

  console.log('Stats updated successfully.');
  process.exit(0);
}

syncAmrut().catch(e => {
  console.error(e);
  process.exit(1);
});

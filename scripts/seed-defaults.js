/**
 * ==============================================================================
 * SHRI MAHAKAL FINANCE - SEED DEFAULTS SCRIPT (scripts/seed-defaults.js)
 * ==============================================================================
 * Starts with an isolated, empty database and seeds ONLY:
 * 1. The first administrator record (admin_primary, editable).
 * 2. Default interest & penalty settings (editable by admin).
 * 3. The two default offices (MAIN and HOME, with configurable names).
 * 4. Fresh stats/summary singleton document.
 * 
 * No scheme data or customers are preloaded - admin creates schemes after launch.
 * ==============================================================================
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "narayanbishi-cdb62.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "narayanbishi-cdb62",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "859533495525",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:859533495525:web:1239ec259005699930d80c",
};

async function seedDefaults() {
  console.log('====================================================');
  console.log('🌱 Shri Mahakal Finance - Seeding Default Configuration');
  console.log('====================================================');

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const now = new Date().toISOString();

  // 1. Seed First Admin
  console.log('1️⃣ Seeding Primary Administrator (admin_primary)...');
  const adminRef = doc(db, 'admins', 'admin_primary');
  const adminSnap = await getDoc(adminRef);
  if (!adminSnap.exists()) {
    await setDoc(adminRef, {
      id: 'admin_primary',
      name: 'श्री महाकाल फायनान्स व्यवस्थापक',
      mobile: '9876543210',
      email: 'admin@shreemahakalfinance.com',
      password: 'admin', // initial password (editable upon first login)
      role: 'SUPER_ADMIN',
      createdAt: now,
      updatedAt: now,
    });
    console.log('   ✅ Primary Admin created: Mobile: 9876543210, Pass: admin');
  } else {
    console.log('   ℹ️ Primary Admin already exists. Preserving current credentials.');
  }

  // 2. Seed Default Offices (MAIN and HOME)
  console.log('2️⃣ Seeding Default Offices (MAIN, HOME)...');
  const officesRef = doc(db, 'settings', 'offices');
  await setDoc(officesRef, {
    offices: [
      { id: 'MAIN', nameMR: 'मुख्य कार्यालय', nameEN: 'Main Office', active: true },
      { id: 'HOME', nameMR: 'गृह कार्यालय', nameEN: 'Home Office', active: true },
    ],
    updatedAt: now,
  }, { merge: true });
  console.log('   ✅ Offices configured: MAIN (मुख्य कार्यालय), HOME (गृह कार्यालय)');

  // 3. Seed Default Interest Rates Config
  console.log('3️⃣ Seeding Default Interest Rate Settings...');
  const interestMonthlyRef = doc(db, 'interestRates', 'default_monthly');
  await setDoc(interestMonthlyRef, {
    id: 'default_monthly',
    rate: 10,
    rateType: 'MONTHLY',
    effectiveDate: now.split('T')[0],
    note: 'प्राथमिक मासिक व्याजदर (१०%)',
    updatedAt: now,
  }, { merge: true });

  const interestWeeklyRef = doc(db, 'interestRates', 'default_weekly');
  await setDoc(interestWeeklyRef, {
    id: 'default_weekly',
    rate: 2.5,
    rateType: 'WEEKLY',
    effectiveDate: now.split('T')[0],
    note: 'प्राथमिक साप्ताहिक व्याजदर (२.५%)',
    updatedAt: now,
  }, { merge: true });
  console.log('   ✅ Interest rates configured: Monthly 10%, Weekly 2.5%');

  // 4. Seed Default Penalty Settings
  console.log('4️⃣ Seeding Default Penalty Settings...');
  const penaltyRef = doc(db, 'penaltySettings', 'default_penalty');
  await setDoc(penaltyRef, {
    id: 'default_penalty',
    weeklyPenalty: 50,
    monthlyPenalty: 200,
    graceDays: 3,
    updatedAt: now,
  }, { merge: true });
  console.log('   ✅ Penalty configured: Weekly ₹50, Monthly ₹200, Grace Days: 3');

  // 5. Initialize Stats Singleton Document
  console.log('5️⃣ Initializing Stats Singleton (stats/summary)...');
  const statsRef = doc(db, 'stats', 'summary');
  const statsSnap = await getDoc(statsRef);
  if (!statsSnap.exists()) {
    await setDoc(statsRef, {
      totalCustomers: 0,
      todaysCollection: 0,
      totalBishiCollected: 0,
      totalPrincipalLoans: 0,
      loanBalanceDue: 0,
      todaysPenalty: 0,
      todaysDueAmount: 0,
      todaysDueInstallments: 0,
      pendingRequestsCount: 0,
      lastUpdated: now,
    });
    console.log('   ✅ Fresh stats/summary singleton initialized.');
  } else {
    console.log('   ℹ️ stats/summary document already initialized.');
  }

  console.log('====================================================');
  console.log('🎉 Shri Mahakal Finance default database seed completed!');
  console.log('====================================================');
  console.log('Next Steps for Admin:');
  console.log('1. Launch the admin panel with `npm run dev`');
  console.log('2. Log in with Mobile: 9876543210 and Password: admin');
  console.log('3. Go to "माझी माहिती (Profile)" to update password & profile details');
  console.log('4. Create your schemes in "भिशी (Bishi Schemes)"');
  console.log('====================================================');
  process.exit(0);
}

seedDefaults().catch((err) => {
  console.error('❌ Error seeding defaults:', err);
  process.exit(1);
});

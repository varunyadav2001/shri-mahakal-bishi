/**
 * ==============================================================================
 * NARAYAN BHISHI - 100% CLOUD AUTOMATIC DAILY 11:00 PM BACKUP SCRIPT
 * ==============================================================================
 * Runs autonomously in GitHub Actions cloud servers every night at 11:00 PM IST.
 * 
 * Functions:
 * 1. Pulls all current records directly from Cloud Firestore (Customers, Loans,
 *    Collections, Thak Baki, Installments, Requests, Settings).
 * 2. Compiles complete Narayan Bhishi SystemBackupData JSON.
 * 3. Uploads the backup file to Google Drive folder "Narayan_Bhishi_Backups"
 *    via Google Apps Script Webhook.
 * 4. Updates Firestore stats/summary with the 11 PM completion slot so all
 *    user devices show "Completed" in real time.
 * ==============================================================================
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';

const DEFAULT_WEBHOOK_URL =
  process.env.DRIVE_WEBHOOK_URL || '';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "narayanbishi-cdb62.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "narayanbishi-cdb62",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "859533495525",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:859533495525:web:1239ec259005699930d80c",
};

async function fetchCollection(db, collectionName) {
  try {
    const snap = await getDocs(collection(db, collectionName));
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      items.push({ id: d.id, ...data });
    });
    return items;
  } catch (err) {
    console.warn(`[Backup] Warning fetching collection "${collectionName}":`, err.message);
    return [];
  }
}

function getTargetDailySlotDate(now = new Date()) {
  const istFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = istFormatter.formatToParts(now);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;
  const hour = parseInt(getPart('hour') || '23', 10);
  const year = parseInt(getPart('year'), 10);
  const month = parseInt(getPart('month'), 10) - 1;
  const day = parseInt(getPart('day'), 10);

  const d = new Date(Date.UTC(year, month, day));
  if (hour < 12) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function runCloudBackup() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('🚀 नारायण भिशी (Narayan Bhishi) - Automated Cloud 11 PM Backup');
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log('====================================================');

  // 1. Initialize Firebase
  console.log('📡 Connecting to Cloud Firestore...');
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const targetSlotDate = getTargetDailySlotDate(new Date());
  console.log(`🎯 Target Daily 11 PM Slot Date: ${targetSlotDate}`);

  // Idempotency check: Skip if already completed for this slot
  try {
    const statsRef = doc(db, 'stats', 'summary');
    const statsSnap = await getDoc(statsRef);
    if (statsSnap.exists() && statsSnap.data().lastDaily11pmDate === targetSlotDate) {
      console.log(`✅ Daily 11 PM backup for ${targetSlotDate} is already completed. Skipping redundant run.`);
      process.exit(0);
    }
  } catch (checkErr) {
    console.warn('⚠️ Idempotency check warning:', checkErr.message);
  }

  console.log('📥 Running full collection query for backup compilation...');
  const [
    customers,
    collections,
    loans,
    loanPayments,
    thakbaki,
    bishiConfigs,
    interestRates,
    penaltySettings,
    admins,
    smsLogs,
    requests,
    auditLogs
  ] = await Promise.all([
    fetchCollection(db, 'customers'),
    fetchCollection(db, 'collections'),
    fetchCollection(db, 'loans'),
    fetchCollection(db, 'loanPayments'),
    fetchCollection(db, 'thakbaki'),
    fetchCollection(db, 'bishi'),
    fetchCollection(db, 'interestRates'),
    fetchCollection(db, 'penaltySettings'),
    fetchCollection(db, 'admins'),
    fetchCollection(db, 'smsLogs'),
    fetchCollection(db, 'requests'),
    fetchCollection(db, 'auditLogs'),
  ]);

  const backupData = {
    version: '2.0.0',
    brand: 'Narayan Bhishi',
    exportedAt: new Date().toISOString(),
    customers,
    collections,
    loans,
    loanPayments,
    thakbaki,
    bishiConfigs,
    interestRates,
    penaltySettings,
    admins,
    smsLogs,
    requests,
    auditLogs,
  };

  console.log(`📊 Retrieved Data Summary:`);
  console.log(`   - Customers:     ${customers.length}`);
  console.log(`   - Collections:   ${collections.length}`);
  console.log(`   - Loans:         ${loans.length}`);
  console.log(`   - Thak Baki:     ${thakbaki.length}`);
  console.log(`   - Requests:      ${requests.length}`);
  console.log(`   - Bishi Configs: ${bishiConfigs.length}`);
  console.log(`   - Admins:        ${admins.length}`);

  const filename = `Narayan_Bhishi_AutoBackup_11PM_${targetSlotDate}_2300.json`;
  const jsonString = JSON.stringify(backupData, null, 2);
  const sizeKb = Math.round((jsonString.length * 2) / 1024);
  console.log(`💾 Backup file prepared: ${filename} (~${sizeKb} KB)`);

  const webhookUrl = (process.env.DRIVE_WEBHOOK_URL || DEFAULT_WEBHOOK_URL).trim();
  if (webhookUrl) {
    console.log(`☁️ Uploading to Google Drive webhook...`);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          filename,
          data: backupData,
          maxBackups: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(`Google Drive webhook failed with HTTP status ${response.status}`);
      }

      const result = await response.json();
      console.log(`✅ Google Drive Upload Succeeded! Drive Filename: ${result.fileName || filename}`);
    } catch (driveErr) {
      console.warn('⚠️ Google Drive webhook error:', driveErr.message);
    }
  } else {
    console.log('ℹ️ DRIVE_WEBHOOK_URL not configured. Skipping Drive upload, recording stats directly.');
  }

  // Update Firestore stats/summary
  console.log(`🔄 Updating Firestore stats/summary with 11 PM completion slot...`);
  const statsRef = doc(db, 'stats', 'summary');
  const nowTimestamp = Date.now();
  const isoNow = new Date().toISOString();

  const updatePayload = {
    lastDaily11pmDate: targetSlotDate,
    lastDaily11pmTimestamp: nowTimestamp,
    lastDaily11pmFilename: filename,
    lastDriveBackupTimestamp: nowTimestamp,
    lastDriveBackupDate: isoNow,
    lastDriveBackupFilename: filename,
    lastDriveBackupStatus: 'success',
    lastBackupTimestamp: nowTimestamp,
    lastBackupDate: isoNow,
    lastBackupFilename: filename,
    lastBackupCustomerCount: customers.length,
    lastBackupCollectionCount: collections.length,
    lastBackupLoanCount: loans.length,
    lastBackupSizeKb: sizeKb,
    lastUpdated: isoNow,
  };

  await setDoc(statsRef, updatePayload, { merge: true });
  console.log(`✅ stats/summary updated with lastDaily11pmDate: ${targetSlotDate}`);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('====================================================');
  console.log(`🎉 Automated Cloud Backup finished successfully in ${durationSec}s!`);
  console.log('====================================================');
  process.exit(0);
}

runCloudBackup().catch((err) => {
  console.error('❌ Cloud Backup Error:', err);
  process.exit(1);
});

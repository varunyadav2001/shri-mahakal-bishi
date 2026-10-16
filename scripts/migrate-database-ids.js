/**
 * ==============================================================================
 * NARAYAN BHISHI - DATABASE ID MIGRATION SCRIPT (scripts/migrate-database-ids.js)
 * ==============================================================================
 * Migrates existing Firestore documents from non-ASCII / percent-encoded names
 * to clean, readable Latin ASCII document IDs containing Title, Name, and Account ID.
 *
 * For example:
 *   "15_ऑगस्ट_2025_1_आदित्य_हप्ता_01" -> "15_August_2025_Acc1_Aditya_Hapta_01"
 *   "15_ऑगस्ट_2025_1_आदित्य"          -> "15_August_2025_Acc1_Aditya"
 *   "15_ऑगस्ट_2025"                   -> "15_August_2025"
 * ==============================================================================
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyD_jvyj34WVd1bZBiDG0uq84aeJluD1ybg",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "narayanbishi-cdb62.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "narayanbishi-cdb62",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "narayanbishi-cdb62.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "859533495525",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:859533495525:web:1239ec259005699930d80c",
};

const MARATHI_DICTIONARY = {
  'दिवाळी': 'Diwali',
  'भिशी': 'Bishi',
  'भिषी': 'Bishi',
  'गणेश': 'Ganesh',
  'गणपती': 'Ganpati',
  'दसरा': 'Dasara',
  'जानेवारी': 'January',
  'ऑगस्ट': 'August',
  'हप्ता': 'Hapta',
  'कर्ज': 'Loan',
  'पावती': 'Receipt',
  'थकबाकी': 'Thakbaki',
  'नारायण': 'Narayan',
  'आदित्य': 'Aditya',
  'सचिन': 'Sachin',
  'राहुल': 'Rahul',
  'रमेश': 'Ramesh',
  'सुरेश': 'Suresh',
  'दिनेश': 'Dinesh',
  'पाटील': 'Patil',
  'शिंदे': 'Shinde',
};

const DEVANAGARI_DIGITS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const DEVANAGARI_VOWELS = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u',
  'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o',
  'औ': 'au', 'अं': 'am', 'अः': 'ah', 'ॲ': 'a', 'ऑ': 'o',
};

const DEVANAGARI_MATRAS = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ः': 'h', 'ॅ': 'a', 'ॉ': 'o',
};

const DEVANAGARI_CONSONANTS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क्ष': 'ksh',
  'ज्ञ': 'dny',
};

function toReadableDocIdString(text) {
  if (!text) return '';
  let str = String(text).trim();

  for (const [mr, en] of Object.entries(MARATHI_DICTIONARY)) {
    str = str.split(mr).join(en);
  }

  str = str.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] || d);

  let result = '';
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (DEVANAGARI_CONSONANTS[ch]) {
      const cons = DEVANAGARI_CONSONANTS[ch];
      if (next === '्') {
        result += cons;
        i++;
      } else if (next && DEVANAGARI_MATRAS[next]) {
        result += cons + DEVANAGARI_MATRAS[next];
        i++;
      } else if (next && (DEVANAGARI_CONSONANTS[next] || DEVANAGARI_VOWELS[next])) {
        result += cons + 'a';
      } else {
        result += cons;
      }
    } else if (DEVANAGARI_VOWELS[ch]) {
      result += DEVANAGARI_VOWELS[ch];
    } else if (DEVANAGARI_MATRAS[ch]) {
      result += DEVANAGARI_MATRAS[ch];
    } else {
      result += ch;
    }
  }

  return result
    .replace(/[^\w-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function cleanDocString(val) {
  return toReadableDocIdString(val);
}

function computeReadableId(collectionName, docId, data) {
  if (!data) return toReadableDocIdString(docId);

  const acc = cleanDocString(data.accountNumber || data.accountNo);
  const name = cleanDocString(data.customerName || data.name);
  const bishi = cleanDocString(data.bishiType || data.bishiName || data.schemeName);

  if (collectionName === 'customers') {
    if (bishi && acc && name) return `${bishi}_Acc${acc}_${name}`;
    if (acc && name) return `Acc${acc}_${name}`;
    if (name) return name;
    if (acc) return `Acc${acc}`;
  } else if (collectionName === 'collections') {
    const period = String(data.periodIndex || 1).padStart(2, '0');
    if (bishi && acc && name) return `${bishi}_Acc${acc}_${name}_Hapta_${period}`;
    if (acc && name) return `Acc${acc}_${name}_Hapta_${period}`;
    if (acc) return `Acc${acc}_Hapta_${period}`;
    if (name) return `${name}_Hapta_${period}`;
  } else if (collectionName === 'bishi') {
    if (bishi) return bishi;
    if (name) return name;
    if (data.id) return cleanDocString(data.id);
  } else if (collectionName === 'loans') {
    if (bishi && acc && name) return `Loan_${bishi}_Acc${acc}_${name}`;
    if (acc && name) return `Loan_Acc${acc}_${name}`;
    if (acc) return `Loan_Acc${acc}`;
    if (name) return `Loan_${name}`;
  } else if (collectionName === 'loanPayments') {
    const dateStr = cleanDocString(data.paymentDate || docId);
    if (bishi && acc && name) return `Receipt_${bishi}_Acc${acc}_${name}_${dateStr}`;
    if (acc && name) return `Receipt_Acc${acc}_${name}_${dateStr}`;
    if (acc) return `Receipt_Acc${acc}_${dateStr}`;
  } else if (collectionName === 'thakbaki') {
    if (acc && name) return `Thakbaki_Acc${acc}_${name}`;
    if (name) return `Thakbaki_${name}`;
    if (acc) return `Thakbaki_Acc${acc}`;
  }

  return toReadableDocIdString(docId);
}

async function runMigration() {
  console.log('====================================================');
  console.log('🔄 Migrating Firestore Document IDs to Readable Format');
  console.log('====================================================');

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const collectionsToMigrate = ['bishi', 'customers', 'collections', 'loans', 'loanPayments', 'thakbaki'];

  let totalMigrated = 0;

  for (const colName of collectionsToMigrate) {
    const snap = await getDocs(collection(db, colName));
    console.log(`\nChecking collection "${colName}" (${snap.size} documents)...`);

    for (const d of snap.docs) {
      const oldId = d.id;
      const data = d.data();
      const newId = computeReadableId(colName, oldId, data);

      if (newId !== oldId) {
        console.log(`  Migrating: [${oldId}] -> [${newId}]`);
        
        // Save new doc with readable ID
        const newRef = doc(db, colName, newId);
        await setDoc(newRef, data);

        // Delete old doc with non-readable / percent-encoded ID
        const oldRef = doc(db, colName, oldId);
        await deleteDoc(oldRef);

        totalMigrated++;
      } else {
        console.log(`  Document already clean: [${oldId}]`);
      }
    }
  }

  console.log('\n====================================================');
  console.log(`🎉 Migration Completed! Total documents migrated: ${totalMigrated}`);
  console.log('====================================================');
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});

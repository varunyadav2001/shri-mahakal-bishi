import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  Admin,
  BishiConfig,
  CollectionEntry,
  Customer,
  InterestRateConfig,
  Loan,
  LoanPayment,
  PenaltySetting,
  SmsLog,
  SystemBackupData,
  ThakbakiEntry,
  ThakbakiPayment,
  MemberRequest,
  InAppNotification,
  AuditLog,
  Modality,
  Payout,
  Referral,
  StaffMember,
  BroadcastAlert,
} from '../types';
import {
  calculateLoanTotalAccruedInterest,
  reconcileCustomerInstallments,
  generateWeeklyEntries,
  generateMonthlyEntries,
} from '../utils/calculations';
import { generateNextAccountNumber } from '../utils/formatters';
import { toReadableDocIdString } from '../utils/transliterateDocId';
import { invalidateStatsCache } from './stats';
import { markInstallmentAsPaid } from './installments';
import {
  touchSyncTimestamp,
  touchSyncOnCustomerAdd,
  touchSyncOnCustomerDelete,
  recordDeletion,
} from './incrementalSync';
import { AuditService } from './audit';

export const STORAGE_KEYS = {
  ADMINS: 'nb_admins',
  CUSTOMERS: 'nb_customers',
  BISHI_CONFIGS: 'nb_bishi_configs',
  COLLECTIONS: 'nb_collections',
  LOANS: 'nb_loans',
  LOAN_PAYMENTS: 'nb_loan_payments',
  INTEREST_RATES: 'nb_interest_rates',
  PENALTY_SETTINGS: 'nb_penalty_settings',
  SMS_LOGS: 'nb_sms_logs',
  THAKBAKI: 'nb_thakbaki',
  REQUESTS: 'nb_requests',
  NOTIFICATIONS: 'nb_notifications',
  AUDIT_LOGS: 'nb_audit_logs',
  PAYOUTS: 'nb_payouts',
  REFERRALS: 'nb_referrals',
  STAFF: 'nb_staff',
  BROADCAST_ALERTS: 'nb_broadcast_alerts',
};

// ── Native IndexedDB Backing for Unlimited Local Storage ──
const APP_DB_NAME = 'NB_App_Database';
const APP_DB_STORE = 'app_records';
const APP_DB_VERSION = 1;


let appIDBInstance: IDBDatabase | null = null;
const memCache = new Map<string, any>();

function getAppIDB(): Promise<IDBDatabase> {
  if (appIDBInstance) return Promise.resolve(appIDBInstance);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB unavailable'));
    }
    const req = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(APP_DB_STORE)) {
        db.createObjectStore(APP_DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      appIDBInstance = req.result;
      resolve(appIDBInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveToAppIDB(key: string, data: any): Promise<void> {
  try {
    const db = await getAppIDB();
    const tx = db.transaction(APP_DB_STORE, 'readwrite');
    const store = tx.objectStore(APP_DB_STORE);
    store.put({ key, data, updatedAt: Date.now() });
  } catch (err) {
    // Non-fatal, localStorage and memory cache still hold data
  }
}

async function loadFromAppIDB(key: string): Promise<any> {
  try {
    const db = await getAppIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(APP_DB_STORE, 'readonly');
      const store = tx.objectStore(APP_DB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// On startup, asynchronously preload tables from IndexedDB into memory ONLY if localStorage was wiped or empty
if (typeof window !== 'undefined') {
  Object.values(STORAGE_KEYS).forEach((k) => {
    loadFromAppIDB(k).then((idbVal) => {
      if (idbVal && !memCache.has(k) && !localStorage.getItem(k)) {
        memCache.set(k, idbVal);
      }
    });
  });
}

// Local storage helper with Memory Cache + IndexedDB Backing (Synchronous return, 0 delay, unlimited size)
const getStoredData = <T>(key: string, defaultValue: T): T => {
  if (memCache.has(key)) {
    return memCache.get(key);
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      memCache.set(key, parsed);
      return parsed;
    }
  } catch (err) {
    console.error(`Error reading ${key} from storage:`, err);
  }
  return defaultValue;
};

// ── Reactive Data Change Bus & Multi-Tab BroadcastChannel ──
type DataChangeListener = (key?: string) => void;
const dataChangeListeners = new Set<DataChangeListener>();
let notifyDebounceTimer: any = null;
const pendingChangedKeys = new Set<string>();

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('nb_data_sync_channel');
    broadcastChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'DATA_CHANGED') {
        const keys: string[] = event.data.keys || (event.data.key ? [event.data.key] : []);
        if (keys.length > 0) {
          keys.forEach((k) => memCache.delete(k));
        } else {
          memCache.clear();
        }
        notifyDataChange(keys[0], false);
      }
    };
  } catch (err) {
    console.warn('[BroadcastChannel] Initialization note:', err);
  }
}

// Fallback for browsers or tabs without BroadcastChannel
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('nb_')) {
      memCache.delete(e.key);
      notifyDataChange(e.key, false);
    }
  });
}

export const onDataChange = (listener: DataChangeListener): (() => void) => {
  dataChangeListeners.add(listener);
  return () => {
    dataChangeListeners.delete(listener);
  };
};

export const notifyDataChange = (key?: string, broadcast: boolean = true): void => {
  if (key) pendingChangedKeys.add(key);

  if (notifyDebounceTimer) return;
  notifyDebounceTimer = setTimeout(() => {
    notifyDebounceTimer = null;
    const keys = Array.from(pendingChangedKeys);
    pendingChangedKeys.clear();
    const primaryKey = keys[0];

    dataChangeListeners.forEach((listener) => {
      try {
        listener(primaryKey);
      } catch (err) {
        console.warn('[Storage] DataChangeListener error:', err);
      }
    });

    if (broadcast && broadcastChannel) {
      try {
        broadcastChannel.postMessage({ type: 'DATA_CHANGED', keys, timestamp: Date.now() });
      } catch {
        // Non-fatal
      }
    }
  }, 25);
};

export const setStoredData = <T>(key: string, data: T): void => {
  memCache.set(key, data);
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err: any) {
    // If browser localStorage hits 5MB quota (QuotaExceededError at 1500+ clients),
    // IndexedDB below persists the full data safely without throwing an error!
    console.info(`[Storage] ${key} saved to IndexedDB (localStorage quota note):`, err?.message);
  }
  saveToAppIDB(key, data);
  notifyDataChange(key);
};

// Sanitize object for Firestore to eliminate undefined keys
const sanitizeForFirestore = <T>(data: T): T => {
  return JSON.parse(JSON.stringify(data));
};

// Helper to clean and transliterate strings for Firestore document keys into human-readable ASCII
const cleanDocString = (val: any): string => {
  return toReadableDocIdString(val);
};

// Generates neat, readable document IDs for Firebase Console with Customer Name, Scheme Title, and Account Number
export const getFirestoreDocId = (collectionName: string, docId: string, data: any): string => {
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
    if (data.id) return cleanDocString(data.id);
    if (bishi) return bishi;
    if (name) return name;
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
  } else if (collectionName === 'requests' || collectionName === 'member_requests') {
    return cleanDocString(docId);
  } else if (collectionName === 'notifications') {
    const mobile = cleanDocString(data.recipientPhone || data.mobile);
    if (mobile) return `Notification_${mobile}_${cleanDocString(docId)}`;
  }

  return toReadableDocIdString(docId);
};

// Enrich data with human-readable customer information before pushing to cloud
const enrichFirestoreData = (collectionName: string, rawData: any): any => {
  const data = { ...rawData };

  if (collectionName === 'customers') {
    data.customerName = data.customerName || data.name;
    data.name = data.name || data.customerName;

    // Attach summary and installments if available locally so customer document in Firebase is rich and neatly arranged
    try {
      const allColls = getStoredData<CollectionEntry[]>(STORAGE_KEYS.COLLECTIONS, []);
      const rawCustColls = allColls.filter(
        (c) => c.customerId === data.id || (data.accountNumber && String(c.accountNumber) === String(data.accountNumber))
      );
      // Deduplicate by periodIndex to prevent duplicate installments inflating summary
      const dedupMap = new Map<number, CollectionEntry>();
      rawCustColls.forEach((c) => {
        const existing = dedupMap.get(c.periodIndex);
        if (!existing || (c.updatedAt && (!existing.updatedAt || c.updatedAt >= existing.updatedAt))) {
          dedupMap.set(c.periodIndex, c);
        }
      });
      const targetCount = Number(data.totalInstallments) || (data.modality === 'W' ? 40 : 10);
      const custColls = Array.from(dedupMap.values())
        .filter((c) => c.periodIndex <= targetCount || c.status === 'PAID' || (c.collectedAmount || 0) > 0)
        .sort((a, b) => a.periodIndex - b.periodIndex);

      if (custColls.length > 0) {
        const totalExpected = custColls.reduce((acc, c) => acc + (c.expectedAmount || 0), 0);
        const totalCollected = custColls.reduce((acc, c) => acc + (c.collectedAmount || 0), 0);
        const totalExtraAmount = custColls.reduce((acc, c) => acc + (c.extraAmount || 0), 0);
        const totalPenalty = custColls.reduce((acc, c) => acc + (c.penaltyAmount || 0), 0);
        data.summary = {
          totalExpected,
          totalCollected,
          totalExtraAmount,
          totalPenalty,
          totalCollectedWithPenalty: totalCollected + totalExtraAmount + totalPenalty,
          totalRemaining: Math.max(0, totalExpected - totalCollected),
          totalInstallments: custColls.length,
          paidInstallments: custColls.filter((c) => c.status === 'PAID').length,
          pendingInstallments: custColls.filter((c) => c.status !== 'PAID').length,
        };
        data.installments = custColls.map((c) => ({
          id: c.id,
          customerId: c.customerId || data.id,
          customerName: c.customerName || data.name || data.customerName || '',
          accountNumber: c.accountNumber || data.accountNumber || '',
          officeId: c.officeId || data.officeId || 'MAIN',
          bishiType: c.bishiType || data.bishiType,
          bishiName: c.bishiName || data.bishiName,
          periodIndex: c.periodIndex,
          periodLabel: c.periodLabel,
          dueDate: c.dueDate,
          paymentDate: c.paymentDate || null,
          paymentTime: c.paymentTime || null,
          paymentMode: c.paymentMode || null,
          expectedAmount: Number(c.expectedAmount) || 0,
          collectedAmount: Number(c.collectedAmount) || 0,
          extraAmount: Number(c.extraAmount) || 0,
          remainingAmount: Number(c.remainingAmount) || 0,
          interestAmount: Number(c.interestAmount) || 0,
          historicalInterestRate: Number(c.historicalInterestRate) || 0,
          penaltyAmount: Number(c.penaltyAmount) || 0,
          historicalPenaltyRate: Number(c.historicalPenaltyRate) || 0,
          totalPaid: Number(c.totalPaid) || 0,
          totalWithPenalty: (Number(c.collectedAmount) || 0) + (Number(c.extraAmount) || 0) + (Number(c.penaltyAmount) || 0),
          status: c.status,
          note: c.note || '',
          updatedAt: c.updatedAt || new Date().toISOString(),
        }));
      }

      const allLoans = getStoredData<Loan[]>(STORAGE_KEYS.LOANS, []);
      const custLoans = allLoans.filter(
        (l) => l.customerId === data.id || (data.accountNumber && l.accountNumber === data.accountNumber)
      );
      const custLoan = custLoans.find((l) => l.status === 'ACTIVE')
        || [...custLoans].sort((a, b) => (b.updatedAt || b.issueDate || '').localeCompare(a.updatedAt || a.issueDate || ''))[0];
      if (custLoan) {
        const allLoanPayments = getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []);
        const paymentsForLoan = allLoanPayments.filter(
          (lp) => (lp.loanId && lp.loanId === custLoan.id) || lp.customerId === data.id
        );
        const totalInterestPaid = paymentsForLoan.reduce(
          (sum, p) => sum + (Number(p.interestPaid) || 0),
          0
        );
        const principal = Number(custLoan.principalAmount) || 0;
        const rate = Number(custLoan.interestRate) || 0;
        const calculatedInitialInterest = Math.round((principal * rate) / 100);
        data.loanDetails = {
          principalAmount: principal,
          interestRate: rate,
          totalInterest: Number(custLoan.totalInterest) > 0 ? Number(custLoan.totalInterest) : calculatedInitialInterest,
          totalInterestPaid: totalInterestPaid,
          totalPayable: custLoan.totalPayable || (principal + calculatedInitialInterest),
          paidAmount: custLoan.paidAmount || 0,
          remainingAmount: custLoan.remainingAmount || 0,
          status: custLoan.status,
        };
      }
    } catch (e) {
      // Ignore enrichment lookup issues
    }
  } else if (collectionName === 'collections') {
    try {
      const customers = getStoredData<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
      const cust = customers.find(
        (c) => c.id === data.customerId || (data.accountNumber && c.accountNumber === data.accountNumber)
      );
      if (cust) {
        data.customerName = data.customerName || cust.name;
        data.accountNumber = data.accountNumber || cust.accountNumber;
        data.officeId = data.officeId || cust.officeId || 'MAIN';
        data.customerMobile = data.customerMobile || cust.mobile || '';
      }
    } catch (e) {}
    data.penaltyAmount = Number(data.penaltyAmount) || 0;
    data.extraAmount = Number(data.extraAmount) || 0;
    data.totalWithPenalty = (Number(data.collectedAmount) || 0) + data.extraAmount + data.penaltyAmount;
  } else if (collectionName === 'loanPayments') {
    try {
      const customers = getStoredData<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
      const cust = customers.find(
        (c) => c.id === data.customerId || (data.accountNumber && c.accountNumber === data.accountNumber)
      );
      const allLoans = getStoredData<Loan[]>(STORAGE_KEYS.LOANS, []);
      const loan = allLoans.find((l) => (data.loanId && l.id === data.loanId) || l.customerId === data.customerId);

      if (cust || loan) {
        data.customerName = data.customerName || cust?.name || loan?.customerName || '';
        data.accountNumber = data.accountNumber || cust?.accountNumber || loan?.accountNumber || '';
        data.officeId = data.officeId || cust?.officeId || loan?.officeId || 'MAIN';
        data.customerMobile = data.customerMobile || cust?.mobile || (loan as any)?.customerMobile || '';
      }

      // Calculate cumulative total interest paid on this loan
      const allLoanPayments = getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []);
      const paymentsForLoan = allLoanPayments.filter(
        (lp) => (lp.loanId && lp.loanId === data.loanId) || lp.customerId === data.customerId
      );
      const totalInterest = paymentsForLoan.reduce(
        (sum, p) => sum + (Number(p.interestPaid) || 0),
        0
      );
      data.totalInterest = totalInterest;
      data.totalInterestPaid = totalInterest;
      data.totalPaid = (Number(data.paidAmount) || 0) + (Number(data.interestPaid) || 0) + (Number(data.penaltyPaid) || 0);
    } catch (e) {}
  } else if (collectionName === 'loans') {
    try {
      const customers = getStoredData<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
      const cust = customers.find(
        (c) => c.id === data.customerId || (data.accountNumber && c.accountNumber === data.accountNumber)
      );
      if (cust) {
        data.customerName = data.customerName || cust.name;
        data.accountNumber = data.accountNumber || cust.accountNumber;
        data.officeId = data.officeId || cust.officeId || 'MAIN';
        data.customerMobile = data.customerMobile || cust.mobile || '';
      }

      const allLoanPayments = getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []);
      const paymentsForLoan = allLoanPayments.filter(
        (lp) => (lp.loanId && lp.loanId === data.id) || lp.customerId === data.customerId
      );
      const totalInterestPaid = paymentsForLoan.reduce(
        (sum, p) => sum + (Number(p.interestPaid) || 0),
        0
      );
      data.totalInterestPaid = totalInterestPaid;

      const principal = Number(data.principalAmount) || 0;
      const rate = Number(data.interestRate) || 0;
      const calculatedInterest = Math.round((principal * rate) / 100);
      data.totalInterest = Number(data.totalInterest) > 0 ? Number(data.totalInterest) : calculatedInterest;
      data.totalPayable = principal + data.totalInterest;
    } catch (e) {}
  }

  return data;
};

// Sync Status Tracking for instant UI feedback
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type SyncStatusListener = (status: SyncStatus) => void;
const syncStatusListeners: Set<SyncStatusListener> = new Set();
let resetTimer: any = null;
let activeSyncOperations = 0;

export const notifySyncStatus = (status: SyncStatus) => {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  syncStatusListeners.forEach((listener) => {
    try {
      listener(status);
    } catch (e) {}
  });

  if (status === 'synced' || status === 'error') {
    resetTimer = setTimeout(() => {
      syncStatusListeners.forEach((listener) => {
        try {
          listener('idle');
        } catch (e) {}
      });
    }, 2500);
  }
};

export const onSyncStatusChange = (listener: SyncStatusListener) => {
  syncStatusListeners.add(listener);
  return () => {
    syncStatusListeners.delete(listener);
  };
};

const startSyncOp = () => {
  activeSyncOperations++;
  notifySyncStatus('syncing');
};

const endSyncOp = (success: boolean = true) => {
  activeSyncOperations = Math.max(0, activeSyncOperations - 1);
  if (activeSyncOperations === 0) {
    notifySyncStatus(success ? 'synced' : 'error');
  }
};

// Firestore sync helpers with auto sync status tracking
const syncToFirestore = async (collectionName: string, docId: string, data: any) => {
  startSyncOp();
  try {
    const enrichedData = enrichFirestoreData(collectionName, data);
    const readableDocId = getFirestoreDocId(collectionName, docId, enrichedData);
    const cleanData = sanitizeForFirestore(enrichedData);
    const ref = doc(db, collectionName, readableDocId);
    await setDoc(ref, cleanData);
    console.log(`[Firestore Sync] Saved to ${collectionName}/${readableDocId}`);
    endSyncOp(true);
  } catch (e: any) {
    console.warn(`Firestore sync note for ${collectionName}/${docId}:`, e?.message || e);
    endSyncOp(false);
  }
};

// Fast atomic batch sync for multiple entries (up to 400 per commit)
const syncBatchToFirestore = async (
  collectionName: string,
  items: { docId: string; data: any }[]
) => {
  if (!items || items.length === 0) return;
  startSyncOp();
  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const enrichedData = enrichFirestoreData(collectionName, item.data);
        const readableDocId = getFirestoreDocId(collectionName, item.docId, enrichedData);
        const cleanData = sanitizeForFirestore(enrichedData);
        const ref = doc(db, collectionName, readableDocId);
        batch.set(ref, cleanData, { merge: true });
      }
      await batch.commit();
    }
    console.log(`[Firestore Batch Sync] Committed ${items.length} items to ${collectionName}`);
    endSyncOp(true);
  } catch (e: any) {
    console.warn(`Firestore batch sync error for ${collectionName}:`, e?.message || e);
    endSyncOp(false);
  }
};

const deleteFromFirestore = async (collectionName: string, docId: string, data?: any) => {
  startSyncOp();
  try {
    const readableDocId = data ? getFirestoreDocId(collectionName, docId, data) : docId;
    const ref = doc(db, collectionName, readableDocId);
    await deleteDoc(ref);
    if (readableDocId !== docId) {
      const fallbackRef = doc(db, collectionName, docId);
      await deleteDoc(fallbackRef).catch(() => {});
    }
    console.log(`[Firestore Delete] Removed ${collectionName}/${readableDocId}`);
    endSyncOp(true);
  } catch (e: any) {
    console.warn(`Firestore delete note for ${collectionName}/${docId}:`, e?.message || e);
    endSyncOp(false);
  }
};

const sortInterestRatesHelper = (rates: InterestRateConfig[]): InterestRateConfig[] => {
  return [...rates].sort((a, b) => {
    const timeA = a.id?.startsWith('ir_') ? Number(a.id.replace('ir_', '')) : 0;
    const timeB = b.id?.startsWith('ir_') ? Number(b.id.replace('ir_', '')) : 0;
    if (timeA && timeB) return timeB - timeA;
    if (timeA && !timeB) return -1;
    if (!timeA && timeB) return 1;
    return (b.effectiveDate || '').localeCompare(a.effectiveDate || '');
  });
};

// Deduplicates collection entries so each customer has strictly ONE installment entry per periodIndex
export const deduplicateCollections = (entries: CollectionEntry[]): CollectionEntry[] => {
  if (!entries || !Array.isArray(entries) || entries.length === 0) return [];

  const map = new Map<string, CollectionEntry>();

  entries.forEach((entry) => {
    if (!entry) return;
    const custId = String(entry.customerId || '').trim();
    const acc = String(entry.accountNumber || '').trim().toLowerCase();
    const bishi = String(entry.bishiType || '').trim();
    const period = String(entry.periodIndex ?? '');

    // Canonical key: customer (acc or custId) + periodIndex
    const primaryKey = acc ? `${acc}_${period}` : `${custId}_${period}`;
    const key = bishi ? `${primaryKey}_${bishi}` : primaryKey;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
    } else {
      // Strictly pick the newest record based on updatedAt timestamp
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const entryTime = entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0;

      if (entryTime > existingTime) {
        map.set(key, entry);
      } else if (existingTime > entryTime) {
        // Keep existing
      } else {
        // When timestamps are identical or tied, prefer paid/active records over empty/pending
        const entryPaid = (entry.collectedAmount || 0) > 0 || entry.status === 'PAID';
        const existingPaid = (existing.collectedAmount || 0) > 0 || existing.status === 'PAID';
        if (entryPaid && !existingPaid) {
          map.set(key, entry);
        } else if (!entryPaid && existingPaid) {
          // Keep existing paid
        } else if ((entry.collectedAmount || 0) > (existing.collectedAmount || 0)) {
          map.set(key, entry);
        } else {
          // When amounts are identical, pick the canonical readable doc ID if one matches
          const readableId = getFirestoreDocId('collections', entry.id, entry);
          if (entry.id === readableId && existing.id !== readableId) {
            map.set(key, entry);
          }
        }
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => (a.periodIndex || 0) - (b.periodIndex || 0));
};

export const compareAccountNumbers = (a?: string, b?: string, direction: 'asc' | 'desc' = 'asc'): number => {
  const result = String(a || '').trim().localeCompare(String(b || '').trim(), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  return direction === 'asc' ? result : -result;
};

// Deduplicates customers by accountNumber (or ID) and sorts numerically by Account Number
export const deduplicateCustomers = (custs: Customer[]): Customer[] => {
  if (!custs || !Array.isArray(custs) || custs.length === 0) return [];

  const map = new Map<string, Customer>();
  custs.forEach((c) => {
    if (!c) return;
    const acc = String(c.accountNumber || '').trim().toLowerCase();
    const key = acc || c.id;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, c);
    } else {
      const existingTime = existing.updatedAt || existing.createdAt || '';
      const entryTime = c.updatedAt || c.createdAt || '';
      if (entryTime && (!existingTime || entryTime > existingTime)) {
        map.set(key, c);
      }
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    compareAccountNumbers(a.accountNumber, b.accountNumber)
  );
};

// Deduplicates loans by account number or customerId, always keeping the newest record
export const deduplicateLoans = (loans: Loan[]): Loan[] => {
  if (!loans || !Array.isArray(loans) || loans.length === 0) return [];

  const map = new Map<string, Loan>();
  loans.forEach((l) => {
    if (!l) return;
    const acc = String(l.accountNumber || '').trim().toLowerCase();
    const custId = String(l.customerId || '').trim().toLowerCase();
    const key = acc || custId || l.id;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, l);
    } else {
      const existingTime = existing.updatedAt || existing.issueDate || '';
      const entryTime = l.updatedAt || l.issueDate || '';
      if (entryTime && (!existingTime || entryTime >= existingTime)) {
        map.set(key, l);
      }
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    compareAccountNumbers(a.accountNumber, b.accountNumber)
  );
};

// Deduplicates loan payments
export const deduplicateLoanPayments = (payments: LoanPayment[]): LoanPayment[] => {
  if (!payments || payments.length === 0) return [];

  const map = new Map<string, LoanPayment>();
  payments.forEach((p) => {
    if (!p) return;
    const key = p.id || `${p.loanId || p.customerId}_${p.paymentDate}_${p.paidAmount}_${p.interestPaid}`;
    if (!map.has(key)) {
      map.set(key, p);
    }
  });

  return Array.from(map.values()).sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
};


// Initialize default configs and migrate any legacy 'sb_' data if empty
const initializeDefaultConfigs = () => {
  // 1. One-time legacy migration from 'sb_' to 'nb_' keys if present in browser localStorage
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const legacyKeys = [
      'bishi_configs',
      'customers',
      'collections',
      'loans',
      'loan_payments',
      'interest_rates',
      'penalty_settings',
      'admins',
      'admin_pass',
      'thakbaki',
      'requests',
    ];
    legacyKeys.forEach((key) => {
      const nbKey = 'nb_' + key;
      const sbKey = 'sb_' + key;
      try {
        const nbVal = localStorage.getItem(nbKey);
        const sbVal = localStorage.getItem(sbKey);
        if ((!nbVal || nbVal === '[]' || nbVal === 'null') && sbVal && sbVal !== '[]' && sbVal !== 'null') {
          localStorage.setItem(nbKey, sbVal);
          try {
            memCache.set(nbKey, JSON.parse(sbVal));
          } catch {}
        }
        // Always remove legacy sb_ keys so they never resurrect deleted records
        localStorage.removeItem(sbKey);
      } catch {}
    });
  }

  // 2. Ensure Bishi schemes are initialized if currently empty
  const currentConfigs = getStoredData<BishiConfig[]>(STORAGE_KEYS.BISHI_CONFIGS, []);
  if (!currentConfigs || currentConfigs.length === 0) {
    const currentYear = new Date().getFullYear();
    const defaults: BishiConfig[] = [
      {
        id: '15_AUGUST',
        name: '१५ ऑगस्ट भिशी',
        startDate: `${currentYear}-08-15`,
        endDate: `${currentYear + 1}-08-14`,
        totalInstallments: 40,
        modality: 'W',
        officeId: 'MAIN',
        color: 'bg-emerald-600',
        bgPastel: 'bg-pastel-green/30',
      },
      {
        id: 'DASARA',
        name: 'दसरा भिशी',
        startDate: `${currentYear}-10-15`,
        endDate: `${currentYear + 1}-10-14`,
        totalInstallments: 40,
        modality: 'W',
        officeId: 'MAIN',
        color: 'bg-amber-600',
        bgPastel: 'bg-pastel-yellow/30',
      },
    ];
    setStoredData(STORAGE_KEYS.BISHI_CONFIGS, defaults);
  }

  const penalty = getStoredData<PenaltySetting | null>(STORAGE_KEYS.PENALTY_SETTINGS, null);
  if (!penalty) {
    const defaultPenalty: PenaltySetting = {
      id: 'default',
      weeklyPenalty: 50,
      monthlyPenalty: 200,
      graceDays: 2,
    };
    setStoredData<PenaltySetting>(STORAGE_KEYS.PENALTY_SETTINGS, defaultPenalty);
  }

  const interest = getStoredData<InterestRateConfig[]>(STORAGE_KEYS.INTEREST_RATES, []);
  if (interest.length === 0) {
    const defaultInterest: InterestRateConfig[] = [
      {
        id: 'default_m',
        rate: 10,
        rateType: 'MONTHLY',
        effectiveDate: new Date().toISOString().split('T')[0],
        note: 'प्राथमिक मासिक व्याजदर',
      },
      {
        id: 'default_w',
        rate: 2.5,
        rateType: 'WEEKLY',
        effectiveDate: new Date().toISOString().split('T')[0],
        note: 'प्राथमिक साप्ताहिक व्याजदर',
      },
    ];
    setStoredData<InterestRateConfig[]>(STORAGE_KEYS.INTEREST_RATES, defaultInterest);
  }

  // Set up primary admin credentials locally if uninitialized
  const PRIMARY_ADMIN: Admin = {
    id: 'admin_primary',
    name: 'नारायण भिशी व्यवस्थापक',
    mobile: '9876543210',
    email: 'admin@narayanbishi.com',
    role: 'SUPER_ADMIN',
    createdAt: new Date().toISOString(),
  };

  try {
    const admins = getStoredData<Admin[]>(STORAGE_KEYS.ADMINS, []);
    const hasOnlyPrimaryAdmin =
      Array.isArray(admins) &&
      admins.length === 1 &&
      admins[0]?.mobile &&
      String(admins[0].mobile).trim() === '9876543210' &&
      admins[0].id === 'admin_primary';

    if (!hasOnlyPrimaryAdmin) {
      const currentPass = localStorage.getItem('nb_admin_pass') || 'admin';
      const adminWithPass = { ...PRIMARY_ADMIN, password: currentPass };
      setStoredData(STORAGE_KEYS.ADMINS, [adminWithPass]);
      localStorage.setItem('nb_admin_pass', currentPass);
    } else if (!localStorage.getItem('nb_admin_pass')) {
      localStorage.setItem('nb_admin_pass', 'admin');
    }
  } catch (err) {
    console.warn('initializeDefaultConfigs admin setup note:', err);
  }
};

export const normalizeMemberRequest = (raw: any, docId: string): MemberRequest => {
  const phone = String(raw.mobile || raw.customerPhone || raw.userPhone || raw.userId || '').replace(/\D/g, '');
  const name = String(raw.customerName || raw.userName || raw.name || 'सभासद').trim();
  const rawStatus = String(raw.status || 'PENDING').toUpperCase();
  const status: any = rawStatus === 'APPROVED' ? 'APPROVED' : rawStatus === 'REJECTED' ? 'REJECTED' : 'PENDING';

  // Frequency to Modality
  let modality: Modality = 'W';
  if (raw.modality === 'M' || String(raw.frequency || '').toLowerCase().includes('month') || raw.frequency === 'M') {
    modality = 'M';
  }

  // Type inference
  let type: any = raw.type ? String(raw.type).toUpperCase() : 'JOIN_SCHEME';
  if (!raw.type) {
    if (raw.schemeId || raw.schemeName || raw.frequency) {
      type = 'JOIN_SCHEME';
    } else if (raw.loanAmount || raw.loanPurpose) {
      type = 'LOAN';
    } else if (raw.paymentAmount) {
      type = 'PAYMENT';
    }
  }

  // Date parsing
  let createdAtIso = new Date().toISOString();
  if (raw.createdAt) {
    if (typeof raw.createdAt === 'string') {
      createdAtIso = raw.createdAt;
    } else if (raw.createdAt.seconds) {
      createdAtIso = new Date(raw.createdAt.seconds * 1000).toISOString();
    } else if (typeof raw.createdAt.toDate === 'function') {
      createdAtIso = raw.createdAt.toDate().toISOString();
    }
  } else if (raw.requestDate) {
    createdAtIso = typeof raw.requestDate === 'string' ? raw.requestDate : new Date().toISOString();
  }

  const rawAmt = Number(raw.amount || raw.installmentAmount || raw.payload?.amount || 0);
  const amount = rawAmt > 0 ? rawAmt : 1000;

  return {
    id: raw.id || docId,
    memberUid: raw.memberUid || raw.userId || '',
    customerId: raw.customerId || '',
    customerName: name,
    customerPhone: phone,
    mobile: phone,
    accountNumber: raw.accountNumber || '',
    type,
    amount,
    status,
    officeId: raw.officeId || 'MAIN',
    message: raw.message || (raw.schemeName ? `${raw.schemeName} (${modality === 'W' ? 'साप्ताहिक' : 'मासिक'} - ₹${amount}) मध्ये सहभाग अर्ज.` : 'अर्ज सादर केला.'),
    schemeId: raw.schemeId || raw.payload?.schemeId,
    schemeName: raw.schemeName || raw.payload?.schemeName,
    modality,
    totalInstallments: Number(raw.totalInstallments || raw.payload?.totalInstallments) || (modality === 'W' ? 52 : 12),
    referredBy: raw.referredBy || raw.payload?.referredBy || raw.metadata?.referredBy,
    referredByName: raw.referredByName || raw.payload?.referredByName || raw.metadata?.referredByName,
    referredByCode: raw.referredByCode || raw.payload?.referredByCode || raw.metadata?.referredByCode,
    referralDiscount: Number(raw.referralDiscount || raw.payload?.referralDiscount || Math.round(amount * 0.1)),
    createdAt: createdAtIso,
    updatedAt: raw.updatedAt || createdAtIso,
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
    reviewNote: raw.reviewNote,
    payload: {
      ...raw.payload,
      schemeId: raw.schemeId || raw.payload?.schemeId,
      schemeName: raw.schemeName || raw.payload?.schemeName,
      modality,
      amount,
      referredBy: raw.referredBy || raw.payload?.referredBy,
      referredByName: raw.referredByName || raw.payload?.referredByName,
      referredByCode: raw.referredByCode || raw.payload?.referredByCode,
      referralDiscount: Number(raw.referralDiscount || raw.payload?.referralDiscount || Math.round(amount * 0.1)),
      startDate: raw.payload?.startDate || raw.startDate || createdAtIso.split('T')[0],
    },
  };
};

initializeDefaultConfigs();

export const StorageService = {
  // Sync Status listener subscriptions
  onSyncStatusChange,
  notifySyncStatus,
  onDataChange,
  notifyDataChange,

  // Admin Operations
  updateAdminPassword: async (newPassword: string): Promise<void> => {
    localStorage.setItem('nb_admin_pass', newPassword);
    const admins = StorageService.getAdmins();
    const primary = admins[0] || {
      id: 'admin_primary',
      name: 'नारायण भिशी व्यवस्थापक',
      mobile: '9876543210',
      email: 'admin@narayanbishi.com',
      role: 'SUPER_ADMIN',
      createdAt: new Date().toISOString(),
    };
    const updatedAdmin: Admin = {
      ...primary,
      password: newPassword,
      updatedAt: new Date().toISOString(),
    };
    setStoredData(STORAGE_KEYS.ADMINS, [updatedAdmin]);
    await syncToFirestore('admins', 'admin_primary', updatedAdmin);
  },
  getAdmins: (): Admin[] => {
    const admins = getStoredData<Admin[]>(STORAGE_KEYS.ADMINS, []);
    const hasOnlyPrimaryAdmin =
      Array.isArray(admins) &&
      admins.length === 1 &&
      admins[0]?.mobile &&
      String(admins[0].mobile).trim() === '9876543210' &&
      admins[0].id === 'admin_primary';

    if (!hasOnlyPrimaryAdmin) {
      const PRIMARY_ADMIN: Admin = {
        id: 'admin_primary',
        name: 'नारायण भिशी व्यवस्थापक',
        mobile: '9876543210',
        email: 'admin@narayanbishi.com',
        role: 'SUPER_ADMIN',
        createdAt: new Date().toISOString(),
      };
      setStoredData(STORAGE_KEYS.ADMINS, [PRIMARY_ADMIN]);
      localStorage.setItem('nb_admin_pass', 'admin');
      return [PRIMARY_ADMIN];
    }
    return admins;
  },

  hasAdmin: (): boolean => true,

  createAdmin: (_admin: Omit<Admin, 'id' | 'createdAt'>): Admin => {
    throw new Error('नवीन प्रशासक नोंदणी बंद करण्यात आलेली आहे. थेट लॉगिन करा.');
  },

  updateAdmin: (id: string, updates: Partial<Admin>): Admin => {
    const admins = StorageService.getAdmins();
    const index = admins.findIndex((a) => a.id === id);
    if (index === -1) throw new Error('प्रशासक सापडला नाही.');

    admins[index] = { ...admins[index], ...updates };
    setStoredData(STORAGE_KEYS.ADMINS, admins);
    syncToFirestore('admins', id, admins[index]);
    return admins[index];
  },

  // Customer Operations
  getCustomers: (): Customer[] => {
    const raw = getStoredData<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const deduped = deduplicateCustomers(raw);
    if (deduped.length !== raw.length) {
      setStoredData(STORAGE_KEYS.CUSTOMERS, deduped);
    }
    return deduped;
  },

  getCustomerById: (id: string): Customer | undefined => {
    return StorageService.getCustomers().find((c) => c.id === id);
  },

  getCustomerByAccountNumber: (accountNumber: string): Customer | undefined => {
    return StorageService.getCustomers().find(
      (c) => c.accountNumber.trim().toLowerCase() === accountNumber.trim().toLowerCase()
    );
  },

  addCustomer: (customerData: Omit<Customer, 'id' | 'createdAt'>): Customer => {
    const customers = StorageService.getCustomers();

    const cleanAcc = customerData.accountNumber.trim();
    const exists = customers.some(
      (c) => c.bishiType === customerData.bishiType &&
             c.accountNumber.trim().toLowerCase() === cleanAcc.toLowerCase()
    );
    if (exists) {
      throw new Error('या भिशी योजनेमध्ये हा खाते क्रमांक आधीपासून वापरामध्ये आहे. कृपया वेगळा खाते क्रमांक वापरा.');
    }

    const cleanName = (customerData.name || customerData.customerName || '').trim();
    const nowIso = new Date().toISOString();
    const newCustomer: Customer = {
      ...customerData,
      id: 'cust_' + Date.now(),
      name: cleanName,
      customerName: cleanName,
      nameLower: cleanName.toLowerCase(),
      accountNumber: cleanAcc,
      accountNo: cleanAcc,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setStoredData(STORAGE_KEYS.CUSTOMERS, [newCustomer, ...customers]);
    if (newCustomer.bishiType !== 'LOAN_ONLY') {
      const targetInstallments = Number(newCustomer.totalInstallments) || (newCustomer.modality === 'W' ? 40 : 10);
      const reconcileRes = reconcileCustomerInstallments(newCustomer, [], targetInstallments);
      if (reconcileRes.updatedCollections.length > 0) {
        const allColls = getStoredData<CollectionEntry[]>(STORAGE_KEYS.COLLECTIONS, []);
        setStoredData(STORAGE_KEYS.COLLECTIONS, [...allColls, ...reconcileRes.updatedCollections]);
      }
    }
    syncToFirestore('customers', newCustomer.id, newCustomer);
    invalidateStatsCache();
    touchSyncOnCustomerAdd(cleanAcc);
    return newCustomer;
  },

  syncCustomerToFirestore: async (customer: Customer): Promise<void> => {
    await syncToFirestore('customers', customer.id, customer);
  },

  updateCustomer: (id: string, updates: Partial<Customer>): Customer => {
    const customers = StorageService.getCustomers();
    const index = customers.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('खातेदार सापडला नाही.');

    const targetType = updates.bishiType || customers[index].bishiType;
    if (updates.accountNumber && (updates.accountNumber !== customers[index].accountNumber || updates.bishiType !== customers[index].bishiType)) {
      const exists = customers.some(
        (c) => c.id !== id &&
               c.bishiType === targetType &&
               c.accountNumber.trim().toLowerCase() === updates.accountNumber!.trim().toLowerCase()
      );
      if (exists) {
        throw new Error('या भिशी योजनेमध्ये हा खाते क्रमांक आधीपासून वापरात आहे.');
      }
    }

    const oldCustomer = { ...customers[index] };
    customers[index] = { ...customers[index], ...updates };
    if (updates.name) {
      const trimmed = updates.name.trim();
      customers[index].name = trimmed;
      customers[index].nameLower = trimmed.toLowerCase();
      if (!updates.customerName) {
        customers[index].customerName = trimmed;
      }
    }
    if (updates.accountNumber) {
      customers[index].accountNo = updates.accountNumber.trim();
    }
    setStoredData(STORAGE_KEYS.CUSTOMERS, customers);
    invalidateStatsCache();

    // Clean up old Firestore doc ID if account number or name changed
    const accountChanged = oldCustomer.accountNumber !== customers[index].accountNumber;
    const nameChanged = oldCustomer.name !== customers[index].name;
    const oldDocId = getFirestoreDocId('customers', id, oldCustomer);
    const newDocId = getFirestoreDocId('customers', id, customers[index]);
    if (oldDocId !== newDocId) {
      deleteFromFirestore('customers', id, oldCustomer);
    }

    // Synchronize customer changes across collections, loans, and loan payments
    try {
      const allColls = getStoredData<CollectionEntry[]>(STORAGE_KEYS.COLLECTIONS, []);
      let collsChanged = false;
      if (customers[index].bishiType !== 'LOAN_ONLY') {
        const customerColls = allColls.filter(
          (c) => c.customerId === id || (oldCustomer.accountNumber && c.accountNumber === oldCustomer.accountNumber)
        );
        const otherColls = allColls.filter(
          (c) => c.customerId !== id && (!oldCustomer.accountNumber || c.accountNumber !== oldCustomer.accountNumber)
        );
        const targetInstallments = Number(customers[index].totalInstallments) || (customers[index].modality === 'W' ? 40 : 10);
        const reconcileRes = reconcileCustomerInstallments(customers[index], customerColls, targetInstallments);

        if (reconcileRes.hasChanges) {
          collsChanged = true;
          setStoredData(STORAGE_KEYS.COLLECTIONS, [...otherColls, ...reconcileRes.updatedCollections]);
          if (reconcileRes.deletedIds.length > 0) {
            for (const dId of reconcileRes.deletedIds) {
              deleteFromFirestore('collections', dId).catch(() => {});
              recordDeletion('collections', dId);
            }
          }
        } else {
          const newRate = typeof customers[index].interestRate === 'number' && !isNaN(customers[index].interestRate)
            ? customers[index].interestRate
            : (customers[index].modality === 'W' ? 2.5 : 10);

          const updatedColls = allColls.map((c) => {
            if (c.customerId === id || (oldCustomer.accountNumber && c.accountNumber === oldCustomer.accountNumber)) {
              collsChanged = true;
              const bishiCol = Math.min(c.collectedAmount || 0, c.expectedAmount || 0);
              const intAmt = bishiCol > 0 ? Math.round((bishiCol * newRate) / 100) : 0;
              return {
                ...c,
                customerId: id,
                customerName: customers[index].name,
                accountNumber: customers[index].accountNumber,
                officeId: customers[index].officeId,
                bishiType: customers[index].bishiType,
                historicalInterestRate: newRate,
                interestAmount: intAmt,
              };
            }
            return c;
          });
          if (collsChanged) {
            setStoredData(STORAGE_KEYS.COLLECTIONS, updatedColls);
            if (accountChanged || nameChanged) {
              const activeUpdatedColls = updatedColls
                .filter((c) => c.customerId === id || (customers[index].accountNumber && c.accountNumber === customers[index].accountNumber))
                .filter((c) => (c.collectedAmount || 0) > 0 || c.status === 'PAID' || c.status === 'PARTIAL');

              activeUpdatedColls.forEach((c) => {
                const oldC = { ...c, customerName: oldCustomer.name, accountNumber: oldCustomer.accountNumber };
                deleteFromFirestore('collections', c.id, oldC);
                syncToFirestore('collections', c.id, c);
              });
            }
          }
        }
      }

      const allLoans = getStoredData<Loan[]>(STORAGE_KEYS.LOANS, []);
      let loansChanged = false;
      const updatedLoans = allLoans.map((l) => {
        if (l.customerId === id || (oldCustomer.accountNumber && l.accountNumber === oldCustomer.accountNumber)) {
          if (accountChanged || nameChanged || l.customerMobile !== customers[index].mobile || l.officeId !== customers[index].officeId) {
            loansChanged = true;
            return {
              ...l,
              customerId: id,
              customerName: customers[index].name,
              accountNumber: customers[index].accountNumber,
              officeId: customers[index].officeId,
              customerMobile: customers[index].mobile,
            };
          }
        }
        return l;
      });
      if (loansChanged) {
        setStoredData(STORAGE_KEYS.LOANS, updatedLoans);
        if (accountChanged || nameChanged) {
          updatedLoans
            .filter((l) => l.customerId === id || (customers[index].accountNumber && l.accountNumber === customers[index].accountNumber))
            .forEach((l) => {
              const oldL = { ...l, customerName: oldCustomer.name, accountNumber: oldCustomer.accountNumber };
              deleteFromFirestore('loans', l.id, oldL);
              syncToFirestore('loans', l.id, l);
            });
        }
      }

      const allLoanPayments = getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []);
      let paymentsChanged = false;
      const updatedPayments = allLoanPayments.map((p) => {
        if (p.customerId === id || (oldCustomer.accountNumber && p.accountNumber === oldCustomer.accountNumber)) {
          if (accountChanged || nameChanged || p.customerMobile !== customers[index].mobile || p.officeId !== customers[index].officeId) {
            paymentsChanged = true;
            return {
              ...p,
              customerId: id,
              customerName: customers[index].name,
              accountNumber: customers[index].accountNumber,
              officeId: customers[index].officeId,
              customerMobile: customers[index].mobile,
            };
          }
        }
        return p;
      });
      if (paymentsChanged) {
        setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, updatedPayments);
        if (accountChanged || nameChanged) {
          updatedPayments
            .filter((p) => p.customerId === id || (customers[index].accountNumber && p.accountNumber === customers[index].accountNumber))
            .forEach((p) => {
              const oldP = { ...p, customerName: oldCustomer.name, accountNumber: oldCustomer.accountNumber };
              deleteFromFirestore('loanPayments', p.id, oldP);
              syncToFirestore('loanPayments', p.id, p);
            });
        }
      }
    } catch (e) {}

    customers[index].updatedAt = new Date().toISOString();
    syncToFirestore('customers', id, customers[index]);
    touchSyncTimestamp();
    return customers[index];
  },

  deleteCustomer: async (id: string): Promise<void> => {
    const customers = StorageService.getCustomers();
    const cleanId = String(id || '').trim();
    const customerToDelete = customers.find((c) => c.id === cleanId) ||
      customers.find((c) => String(c.accountNumber || '').trim().toLowerCase() === cleanId.toLowerCase());
    const targetId = customerToDelete?.id || cleanId;
    const targetAcc = customerToDelete?.accountNumber || cleanId;
    const targetBishi = customerToDelete?.bishiType;

    const remainingCustomers = customers.filter((c) => {
      if (c.id === targetId || c.id === cleanId) return false;
      if (customerToDelete && c.id === customerToDelete.id) return false;
      if (targetAcc && String(c.accountNumber || '').trim().toLowerCase() === String(targetAcc).trim().toLowerCase()) {
        if (!targetBishi || c.bishiType === targetBishi) return false;
      }
      return true;
    });
    setStoredData(STORAGE_KEYS.CUSTOMERS, remainingCustomers);

    // Delete associated collections, loans, and loan payments locally (strictly scoped to this customer and scheme)
    const collections = StorageService.getCollections();
    const toDeleteColls = collections.filter(
      (c) =>
        c.customerId === targetId ||
        c.customerId === cleanId ||
        (customerToDelete && c.customerId === customerToDelete.id) ||
        (targetAcc && String(c.accountNumber || '').trim().toLowerCase() === String(targetAcc).trim().toLowerCase() && (!targetBishi || c.bishiType === targetBishi))
    );
    const toDeleteCollIds = new Set(toDeleteColls.map((c) => c.id));
    const remainingColls = collections.filter((c) => !toDeleteCollIds.has(c.id));
    setStoredData(STORAGE_KEYS.COLLECTIONS, remainingColls);

    const loans = StorageService.getLoans();
    const toDeleteLoans = loans.filter(
      (l) =>
        l.customerId === targetId ||
        l.customerId === cleanId ||
        (customerToDelete && l.customerId === customerToDelete.id) ||
        (targetAcc && String(l.accountNumber || '').trim().toLowerCase() === String(targetAcc).trim().toLowerCase() && (!targetBishi || l.bishiType === targetBishi))
    );
    const toDeleteLoanIds = new Set(toDeleteLoans.map((l) => l.id));
    const remainingLoans = loans.filter((l) => !toDeleteLoanIds.has(l.id));
    setStoredData(STORAGE_KEYS.LOANS, remainingLoans);

    const allLoanPayments = StorageService.getLoanPayments();
    const toDeletePayments = allLoanPayments.filter(
      (p) =>
        p.customerId === targetId ||
        p.customerId === cleanId ||
        (customerToDelete && p.customerId === customerToDelete.id) ||
        (targetAcc && String(p.accountNumber || '').trim().toLowerCase() === String(targetAcc).trim().toLowerCase() && (!targetBishi || p.bishiType === targetBishi))
    );
    const toDeletePayIds = new Set(toDeletePayments.map((p) => p.id));
    const remainingPayments = allLoanPayments.filter((p) => !toDeletePayIds.has(p.id));
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, remainingPayments);

    // Completely and immediately purge from Firestore via atomic writeBatch (0 getDocs read queries)
    try {
      startSyncOp();
      const uniqueDocPaths = new Set<string>();
      const docRefsToDelete: any[] = [];

      const queueDelete = (collectionName: string, docId: string) => {
        if (!docId) return;
        const path = `${collectionName}/${docId}`;
        if (!uniqueDocPaths.has(path)) {
          uniqueDocPaths.add(path);
          docRefsToDelete.push(doc(db, collectionName, docId));
        }
      };

      // 1. Customer document refs
      queueDelete('customers', id);
      if (customerToDelete) {
        const readableDocId = getFirestoreDocId('customers', id, customerToDelete);
        queueDelete('customers', readableDocId);
      }

      // 2. Active collection document refs (only delete documents that could exist in cloud)
      const activeToDeleteColls = toDeleteColls.filter(
        (c) => (c.collectedAmount || 0) > 0 || c.status === 'PAID' || c.status === 'PARTIAL'
      );
      for (const c of activeToDeleteColls) {
        queueDelete('collections', c.id);
        const enriched = {
          ...c,
          customerName: c.customerName || customerToDelete?.name,
          accountNumber: c.accountNumber || customerToDelete?.accountNumber,
        };
        const readableCollId = getFirestoreDocId('collections', c.id, enriched);
        queueDelete('collections', readableCollId);
      }

      // 3. Loan document refs
      for (const l of toDeleteLoans) {
        queueDelete('loans', l.id);
        const enriched = {
          ...l,
          customerName: l.customerName || customerToDelete?.name,
          accountNumber: l.accountNumber || customerToDelete?.accountNumber,
        };
        const readableLoanId = getFirestoreDocId('loans', l.id, enriched);
        queueDelete('loans', readableLoanId);
      }

      // 4. Loan payment document refs
      for (const p of toDeletePayments) {
        queueDelete('loanPayments', p.id);
        const readablePayId = getFirestoreDocId('loanPayments', p.id, p);
        queueDelete('loanPayments', readablePayId);
      }

      // Commit in atomic chunks of 400 with writeBatch (strictly 0 getDocs reads)
      const CHUNK_SIZE = 400;
      for (let i = 0; i < docRefsToDelete.length; i += CHUNK_SIZE) {
        const chunk = docRefsToDelete.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const ref of chunk) {
          batch.delete(ref);
        }
        await batch.commit();
      }

      console.log(`[Firestore] Purged customer ${id} and ${docRefsToDelete.length} related documents.`);
      invalidateStatsCache();
      recordDeletion('customers', targetId, { accountNumber: targetAcc, name: customerToDelete?.name });
      if (toDeleteLoans.length > 0) {
        toDeleteLoans.forEach((l) => recordDeletion('loans', l.id, { accountNumber: targetAcc }));
      }
      if (toDeletePayments.length > 0) {
        toDeletePayments.forEach((p) => recordDeletion('loanPayments', p.id, { accountNumber: targetAcc }));
      }
      if (toDeleteColls.length > 0) {
        toDeleteColls.forEach((c) => recordDeletion('collections', c.id, { accountNumber: targetAcc }));
      }
      touchSyncOnCustomerDelete(targetAcc);

      // Clean up or mark member_requests for this customer in Firestore
      const cleanPhone = (customerToDelete?.mobile || '').replace(/\D/g, '');
      if (cleanPhone || targetAcc || targetId) {
        const reqs = StorageService.getRequests();
        let reqsChanged = false;
        for (const r of reqs) {
          const rPhone = (r.mobile || (r as any).customerPhone || (r as any).userPhone || '').replace(/\D/g, '');
          if ((cleanPhone && rPhone === cleanPhone) || r.customerId === targetId || (targetAcc && r.accountNumber === targetAcc)) {
            r.status = 'REJECTED';
            r.reviewNote = 'सभासद खाते अॅडमिनकडून हटवले गेले आहे (Customer removed by Admin)';
            r.updatedAt = new Date().toISOString();
            reqsChanged = true;
            syncToFirestore('requests', r.id, r).catch(() => {});
            syncToFirestore('member_requests', r.id, r).catch(() => {});
          }
        }
        if (reqsChanged) {
          StorageService.saveRequests(reqs);
          notifyDataChange(STORAGE_KEYS.REQUESTS);
        }

        // Reset user record in Firestore
        if (cleanPhone) {
          setDoc(
            doc(db, 'users', cleanPhone),
            {
              isApproved: false,
              status: 'removed',
              customerId: null,
              accountNumber: null,
              rejectionReason: 'सभासद खाते अॅडमिनकडून हटवले गेले आहे (Customer removed by Admin)',
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ).catch(() => {});
        }
      }

      endSyncOp(true);
    } catch (err) {
      console.warn('Firestore customer purge note:', err);
      endSyncOp(false);
    }
  },

  // Bishi Config Operations
  getBishiConfigs: (): BishiConfig[] => getStoredData<BishiConfig[]>(STORAGE_KEYS.BISHI_CONFIGS, []),

  saveBishiConfigs: (configs: BishiConfig[]): void => {
    const nowIso = new Date().toISOString();
    const stamped = configs.map((c) => ({ ...c, updatedAt: nowIso }));
    setStoredData(STORAGE_KEYS.BISHI_CONFIGS, stamped);
    stamped.forEach((c) => {
      syncToFirestore('bishi', c.id, c);
      syncToFirestore('bishi_configs', c.id, c);
    });
    touchSyncTimestamp();
  },

  deleteBishiConfig: async (id: string): Promise<void> => {
    const configs = StorageService.getBishiConfigs();
    const toDelete = configs.find((c) => c.id === id);
    const updated = configs.filter((c) => c.id !== id);
    setStoredData(STORAGE_KEYS.BISHI_CONFIGS, updated);

    // Also mark or update any active customer registered under this deleted scheme to 'CLOSED'
    const schemeName = toDelete?.name || id;
    const allCustomers = StorageService.getCustomers();
    const updatedCustomers = allCustomers.map((cust) => {
      if (cust.bishiType === schemeName || cust.bishiType === id) {
        const closedCust = { ...cust, status: 'CLOSED' as const, updatedAt: new Date().toISOString() };
        syncToFirestore('customers', cust.id, closedCust);
        return closedCust;
      }
      return cust;
    });
    setStoredData(STORAGE_KEYS.CUSTOMERS, updatedCustomers);

    // Also update any pending member requests for this deleted scheme
    const allRequests = StorageService.getRequests();
    let reqsChanged = false;
    for (const req of allRequests) {
      if ((req.schemeId === id || req.schemeName === schemeName) && req.status === 'PENDING') {
        req.status = 'REJECTED';
        req.reviewNote = 'ही योजना अॅडमिनकडून बंद / डिलीट करण्यात आली आहे (Scheme deleted by Admin)';
        req.updatedAt = new Date().toISOString();
        reqsChanged = true;
        syncToFirestore('requests', req.id, req).catch(() => {});
        syncToFirestore('member_requests', req.id, req).catch(() => {});
      }
    }
    if (reqsChanged) {
      StorageService.saveRequests(allRequests);
      notifyDataChange(STORAGE_KEYS.REQUESTS);
    }

    // Delete scheme from 'bishi', 'bishi_configs', and 'bishi_schemes' collections
    await deleteFromFirestore('bishi', id, toDelete);
    await deleteFromFirestore('bishi_configs', id, toDelete);
    await deleteFromFirestore('bishi_schemes', id, toDelete).catch(() => {});
    await recordDeletion('bishi', id, toDelete);
    await touchSyncTimestamp();
    notifyDataChange(STORAGE_KEYS.BISHI_CONFIGS);
  },

  // Collection Entries Operations
  getCollections: (): CollectionEntry[] => {
    const raw = getStoredData<CollectionEntry[]>(STORAGE_KEYS.COLLECTIONS, []);
    const deduped = deduplicateCollections(raw);
    if (deduped.length !== raw.length) {
      setStoredData(STORAGE_KEYS.COLLECTIONS, deduped);
    }
    return deduped;
  },

  saveCollectionsBatch: (newEntries: CollectionEntry[]): void => {
    const collections = StorageService.getCollections();
    const newEntryKeys = new Set(
      newEntries.map((e) => {
        const acc = String(e.accountNumber || '').trim().toLowerCase();
        const custId = String(e.customerId || '').trim();
        const bishi = String(e.bishiType || '').trim();
        const period = String(e.periodIndex ?? '');
        const primaryKey = acc ? `${acc}_${period}` : `${custId}_${period}`;
        return bishi ? `${primaryKey}_${bishi}` : primaryKey;
      })
    );
    const filtered = collections.filter((c) => {
      const acc = String(c.accountNumber || '').trim().toLowerCase();
      const custId = String(c.customerId || '').trim();
      const bishi = String(c.bishiType || '').trim();
      const period = String(c.periodIndex ?? '');
      const primaryKey = acc ? `${acc}_${period}` : `${custId}_${period}`;
      const key = bishi ? `${primaryKey}_${bishi}` : primaryKey;
      return !newEntryKeys.has(key);
    });
    const combined = deduplicateCollections([...newEntries, ...filtered]);
    setStoredData(STORAGE_KEYS.COLLECTIONS, combined);
    // Only sync active or paid collections to Firestore. Empty/pending future schedules remain offline/local.
    const activeEntriesToSync = newEntries.filter(
      (entry) => (entry.collectedAmount || 0) > 0 || entry.status === 'PAID' || entry.status === 'PARTIAL'
    );
    if (activeEntriesToSync.length > 0) {
      syncBatchToFirestore(
        'collections',
        activeEntriesToSync.map((entry) => ({ docId: entry.id, data: entry }))
      );

      // Sync owning customer doc(s) with embedded installments to Firestore only when active entries change
      const affectedCustIds = new Set<string>();
      activeEntriesToSync.forEach((e) => {
        if (e.customerId) affectedCustIds.add(e.customerId);
        if (e.accountNumber) {
          const cust = StorageService.getCustomers().find(
            (c) => String(c.accountNumber).trim().toLowerCase() === String(e.accountNumber).trim().toLowerCase()
          );
          if (cust) affectedCustIds.add(cust.id);
        }
      });

      affectedCustIds.forEach((cId) => {
        const cust = StorageService.getCustomerById(cId);
        if (cust) {
          syncToFirestore('customers', cust.id, cust);
        }
      });
    }
  },

  updateCollectionEntry: (id: string, updates: Partial<CollectionEntry>): CollectionEntry => {
    const collections = StorageService.getCollections();
    let index = collections.findIndex((c) => c.id === id);

    // If ID not found directly, look up by customerId/accountNumber and periodIndex
    if (index === -1 && updates.periodIndex !== undefined) {
      const targetAcc = String(updates.accountNumber || '').trim().toLowerCase();
      const targetCustId = updates.customerId;
      const targetBishi = updates.bishiType;
      index = collections.findIndex((c) => {
        const cAcc = String(c.accountNumber || '').trim().toLowerCase();
        const isSameCust = (targetCustId && c.customerId === targetCustId) ||
                           (targetAcc && cAcc === targetAcc && (!targetBishi || c.bishiType === targetBishi));
        return isSameCust && c.periodIndex === updates.periodIndex;
      });
    }

    const nowIso = new Date().toISOString();

    const findTargetCustomer = (cId?: string, accNo?: string, bishi?: string): Customer | undefined => {
      const cleanAcc = String(accNo || '').trim().toLowerCase();
      if (cId) {
        const found = StorageService.getCustomerById(cId);
        if (found) return found;
      }
      if (cleanAcc) {
        return StorageService.getCustomers().find(
          (c) => String(c.accountNumber || '').trim().toLowerCase() === cleanAcc &&
                 (!bishi || c.bishiType === bishi)
        );
      }
      return undefined;
    };

    const syncCustomerInstallmentData = (cust: Customer | undefined, entry: CollectionEntry) => {
      if (!cust) return;

      if (Array.isArray(cust.installments)) {
        const instIdx = cust.installments.findIndex((inst: any) =>
          Number(inst.periodIndex || inst.installmentNo) === Number(entry.periodIndex) ||
          inst.id === entry.id ||
          inst.id === id
        );
        if (instIdx !== -1) {
          const prev = cust.installments[instIdx];
          cust.installments[instIdx] = {
            ...prev,
            status: entry.status,
            collectedAmount: Number(entry.collectedAmount || 0),
            remainingAmount: Number(entry.remainingAmount || 0),
            paymentDate: entry.paymentDate || nowIso.split('T')[0],
            paidDate: entry.paymentDate || nowIso.split('T')[0],
            paymentTime: entry.paymentTime || '',
            paymentMode: entry.paymentMode || 'CASH',
            totalPaid: Number(entry.totalPaid || entry.collectedAmount || 0),
            totalWithPenalty: Number(entry.totalWithPenalty || entry.collectedAmount || 0),
            penaltyAmount: Number(entry.penaltyAmount || 0),
            extraAmount: Number(entry.extraAmount || 0),
            note: entry.note || prev.note || '',
            updatedAt: nowIso,
          };
        }
      }

      // Recalculate customer summary metrics
      let paidCount = 0;
      let totalCol = 0;
      let totalExtra = 0;
      let totalPen = 0;
      let totalColWithPen = 0;

      if (Array.isArray(cust.installments) && cust.installments.length > 0) {
        cust.installments.forEach((inst: any) => {
          const isPaid = inst.status === 'PAID' || inst.status === 'CLEARED' || (Number(inst.collectedAmount) >= Number(inst.expectedAmount) && Number(inst.expectedAmount) > 0);
          if (isPaid) paidCount++;
          totalCol += Number(inst.collectedAmount || 0);
          totalExtra += Number(inst.extraAmount || 0);
          totalPen += Number(inst.penaltyAmount || 0);
          totalColWithPen += Number(inst.totalWithPenalty || inst.totalPaid || inst.collectedAmount || 0);
        });
      }

      const totalInstCount = Number(cust.totalInstallments) || (Array.isArray(cust.installments) ? cust.installments.length : 52);
      const expectedInstAmt = Number(cust.amount) || 0;
      const totalExp = Number(cust.summary?.totalExpected) || (expectedInstAmt * totalInstCount);
      const totalRem = Math.max(0, totalExp - totalCol);

      cust.summary = {
        totalExpected: totalExp,
        totalCollected: totalCol,
        totalExtraAmount: totalExtra,
        totalPenalty: totalPen,
        totalCollectedWithPenalty: totalColWithPen,
        totalRemaining: totalRem,
        paidInstallments: paidCount,
        completedInstallments: paidCount,
        pendingInstallments: Math.max(0, totalInstCount - paidCount),
        totalInstallments: totalInstCount,
      };
      cust.updatedAt = nowIso;

      // Update local customers cache
      const allCust = StorageService.getCustomers();
      const cIdx = allCust.findIndex((c) => c.id === cust.id);
      if (cIdx !== -1) {
        allCust[cIdx] = cust;
        setStoredData(STORAGE_KEYS.CUSTOMERS, allCust);
      }

      // Sync customer doc to Firestore so Android App receives it in real-time
      syncToFirestore('customers', cust.id, cust);

      // Sync user doc in Firestore
      if (cust.mobile) {
        const cleanMobile = cust.mobile.replace(/\D/g, '');
        if (cleanMobile) {
          try {
            setDoc(
              doc(db, 'users', cleanMobile),
              {
                lastPaymentDate: nowIso,
                paidInstallments: paidCount,
                totalCollected: totalCol,
                totalRemaining: totalRem,
                updatedAt: nowIso,
              },
              { merge: true }
            ).catch(() => {});
          } catch (_) {}
        }
      }

      // If installment #1 has a payment or is PAID, check and award 10% referral commission to referrer
      if (Number(entry.periodIndex) === 1 && (entry.status === 'PAID' || Number(entry.collectedAmount) > 0)) {
        StorageService.awardReferralCommissionOnFirstPayment(
          cust,
          Number(entry.collectedAmount) || Number(entry.expectedAmount) || cust.amount
        );
      }
    };

    if (index === -1) {
      console.warn(`[StorageService] Collection entry ${id} not found to update, inserting new.`);
      const cust = findTargetCustomer(updates.customerId, updates.accountNumber, updates.bishiType);
      const newEntry: CollectionEntry = {
        id,
        customerId: updates.customerId || cust?.id || '',
        customerName: updates.customerName || cust?.name || '',
        accountNumber: updates.accountNumber || cust?.accountNumber || '',
        customerMobile: cust?.mobile,
        officeId: updates.officeId || cust?.officeId || 'MAIN',
        bishiType: (updates.bishiType || cust?.bishiType || '15_AUGUST') as any,
        periodIndex: updates.periodIndex || 1,
        periodLabel: updates.periodLabel || `हप्ता ${updates.periodIndex || 1}`,
        dueDate: updates.dueDate || new Date().toISOString().split('T')[0],
        expectedAmount: updates.expectedAmount || 0,
        collectedAmount: updates.collectedAmount || 0,
        remainingAmount: updates.remainingAmount || 0,
        interestAmount: updates.interestAmount || 0,
        historicalInterestRate: updates.historicalInterestRate || 0,
        penaltyAmount: updates.penaltyAmount || 0,
        historicalPenaltyRate: updates.historicalPenaltyRate || 0,
        totalPaid: updates.totalPaid || 0,
        totalWithPenalty: updates.totalWithPenalty || 0,
        status: updates.status || 'PENDING',
        ...updates,
        updatedAt: nowIso,
      };
      const combined = deduplicateCollections([...collections, newEntry]);
      setStoredData(STORAGE_KEYS.COLLECTIONS, combined);
      syncToFirestore('collections', id, newEntry);
      syncCustomerInstallmentData(cust, newEntry);
      invalidateStatsCache();
      touchSyncTimestamp();
      return newEntry;
    }

    const target = collections[index];
    const targetPeriod = updates.periodIndex ?? target.periodIndex;
    const targetCustId = updates.customerId || target.customerId;
    const targetAcc = String(updates.accountNumber || target.accountNumber || '').trim().toLowerCase();

    const cust = findTargetCustomer(targetCustId, targetAcc, target.bishiType);

    const updatedEntry: CollectionEntry = {
      ...target,
      ...updates,
      customerMobile: cust?.mobile || (target as any).customerMobile,
      accountNumber: cust?.accountNumber || target.accountNumber,
      updatedAt: nowIso,
    };

    // Update the target and also clean up any duplicate records for this customer and period
    const updatedList = collections.map((c) => {
      const cCustId = c.customerId;
      const cAcc = String(c.accountNumber || '').trim().toLowerCase();
      const isSamePeriod = c.periodIndex === targetPeriod;
      const isSameCustomer = (cCustId && cCustId === targetCustId) ||
                             (targetAcc && cAcc === targetAcc && (!target.bishiType || c.bishiType === target.bishiType));
      if (c.id === id || (isSameCustomer && isSamePeriod)) {
        return { ...c, ...updates, customerMobile: cust?.mobile || (c as any).customerMobile, updatedAt: nowIso };
      }
      return c;
    });

    const dedupedList = deduplicateCollections(updatedList);
    setStoredData(STORAGE_KEYS.COLLECTIONS, dedupedList);

    syncToFirestore('collections', target.id || id, updatedEntry);
    syncCustomerInstallmentData(cust, updatedEntry);

    if (updatedEntry.status === 'PAID' || Number(updatedEntry.collectedAmount) >= Number(updatedEntry.expectedAmount)) {
      markInstallmentAsPaid(updatedEntry.customerId, updatedEntry.periodIndex, 'bishi', updatedEntry.paymentDate || nowIso);
    }
    invalidateStatsCache();
    touchSyncTimestamp();
    return updatedEntry;
  },

  deleteCollectionEntry: async (id: string): Promise<void> => {
    const collections = StorageService.getCollections();
    const entryToDelete = collections.find((c) => c.id === id);
    const filtered = collections.filter((c) => c.id !== id);
    setStoredData(STORAGE_KEYS.COLLECTIONS, filtered);
    await deleteFromFirestore('collections', id, entryToDelete);

    // Strategy 2: Sync customer doc so deleted installment is pruned from embedded array
    if (entryToDelete) {
      const cust = entryToDelete.customerId
        ? StorageService.getCustomerById(entryToDelete.customerId)
        : StorageService.getCustomers().find(
            (c) => String(c.accountNumber || '').trim().toLowerCase() === String(entryToDelete.accountNumber || '').trim().toLowerCase()
          );
      if (cust) {
        syncToFirestore('customers', cust.id, cust);
      }
    }

    recordDeletion('collections', id);
    invalidateStatsCache();
    touchSyncTimestamp();
  },

  deleteCollectionEntriesBatch: async (ids: string[]): Promise<void> => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    const collections = StorageService.getCollections();
    const toDelete = collections.filter((c) => idSet.has(c.id));
    const filtered = collections.filter((c) => !idSet.has(c.id));
    setStoredData(STORAGE_KEYS.COLLECTIONS, filtered);

    for (const item of toDelete) {
      deleteFromFirestore('collections', item.id, item).catch(() => {});
      recordDeletion('collections', item.id);
    }

    const affectedCustIds = new Set(toDelete.map((c) => c.customerId).filter(Boolean));
    affectedCustIds.forEach((cId) => {
      const cust = StorageService.getCustomerById(cId);
      if (cust) {
        syncToFirestore('customers', cust.id, cust);
      }
    });

    invalidateStatsCache();
    touchSyncTimestamp();
  },

  // Loan Operations
  getLoans: (): Loan[] => {
    const rawLoans = deduplicateLoans(getStoredData<Loan[]>(STORAGE_KEYS.LOANS, []));
    const rawCustomers = StorageService.getCustomers();
    const rawPayments = deduplicateLoanPayments(getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []));
    let hasChanges = false;

    const sanitized = rawLoans.map((loan) => {
      let loanChanged = false;
      let principal = Number(loan.principalAmount) || 0;
      const discount = Number(loan.discountAmount) || 0;
      const penalty = Number(loan.penaltyAmount) || 0;

      const cust = rawCustomers.find(
        (c) => c.id === loan.customerId || (loan.accountNumber && c.accountNumber === loan.accountNumber)
      );

      const customerId = cust?.id || loan.customerId || '';
      const customerName = loan.customerName || cust?.name || '';
      const accountNumber = loan.accountNumber || cust?.accountNumber || '';
      const officeId = loan.officeId || cust?.officeId || 'MAIN';
      const customerMobile = loan.customerMobile || cust?.mobile || '';

      const paymentsForLoan = rawPayments.filter(
        (lp) => (lp.loanId && lp.loanId === loan.id) ||
                (loan.customerId && lp.customerId === loan.customerId) ||
                (loan.accountNumber && lp.accountNumber === loan.accountNumber)
      );

      const paymentsInterestSum = paymentsForLoan.reduce(
        (sum, p) => sum + (Number(p.interestPaid) || 0),
        0
      );
      // Ensure interest paid is never wiped to 0 if tracked directly on the loan
      const totalInterestPaid = paymentsForLoan.length > 0 ? paymentsInterestSum : (Number(loan.totalInterestPaid) || 0);

      const paymentsPrincipalSum = paymentsForLoan.reduce(
        (sum, p) => sum + (Number(p.paidAmount) || 0),
        0
      );
      const paid = paymentsForLoan.length > 0 ? Math.max(paymentsPrincipalSum, Number(loan.paidAmount) || 0) : (Number(loan.paidAmount) || 0);

      const remainingPrincipal = Math.max(0, principal - paid - discount);
      const expectedRemaining = remainingPrincipal + penalty;

      const rate = Number(loan.interestRate) || 0;
      const accruedInterest = calculateLoanTotalAccruedInterest(loan);
      const initialInterest = Math.round((principal * rate) / 100);
      const totalInterest = rate === 0 ? 0 : Math.max(initialInterest, accruedInterest);
      const dueInterest = Math.max(0, totalInterest - totalInterestPaid);

      let status = loan.status;
      let remainingAmount = loan.remainingAmount;
      let totalPayable = loan.totalPayable;

      // Auto-mark loans as COMPLETED if fully paid or previously marked CLOSED
      if ((status as string) === 'CLOSED' || (status === 'ACTIVE' && expectedRemaining <= 0 && dueInterest <= 0)) {
        status = 'COMPLETED';
        remainingAmount = 0;
        totalPayable = principal + totalInterest;
      } else if (status === 'ACTIVE') {
        remainingAmount = expectedRemaining + dueInterest;
        totalPayable = principal + totalInterest;
      }

      if (
        loan.status !== status ||
        loan.remainingAmount !== remainingAmount ||
        loan.totalInterest !== totalInterest ||
        loan.totalInterestPaid !== totalInterestPaid ||
        loan.paidAmount !== paid ||
        loan.customerId !== customerId ||
        loan.customerName !== customerName ||
        loan.accountNumber !== accountNumber ||
        loan.officeId !== officeId ||
        loan.customerMobile !== customerMobile ||
        loan.totalPayable !== totalPayable
      ) {
        loanChanged = true;
        hasChanges = true;
      }

      const updatedLoan: Loan = {
        ...loan,
        customerId,
        customerName,
        accountNumber,
        officeId,
        customerMobile,
        totalInterest,
        totalInterestPaid,
        paidAmount: paid,
        totalPayable,
        remainingAmount,
        status,
      };

      return updatedLoan;
    });

    sanitized.sort((a, b) => compareAccountNumbers(a.accountNumber, b.accountNumber));
    if (hasChanges) {
      setStoredData(STORAGE_KEYS.LOANS, sanitized);
    }
    return sanitized;
  },

  getLoanByCustomerId: (customerId: string): Loan | undefined => {
    const cust = StorageService.getCustomerById(customerId);
    const custLoans = StorageService.getLoans().filter(
      (l) => l.customerId === customerId || (cust && cust.accountNumber && l.accountNumber === cust.accountNumber)
    );
    return custLoans.find((l) => l.status === 'ACTIVE') || [...custLoans].sort((a, b) => (b.updatedAt || b.issueDate || '').localeCompare(a.updatedAt || a.issueDate || ''))[0];
  },

  saveLoan: (loanData: Omit<Loan, 'id' | 'updatedAt'> & { id?: string }): Loan => {
    const loans = StorageService.getLoans();
    const existingIndex = loans.findIndex(
      (l) => (loanData.id && l.id === loanData.id) ||
             (loanData.customerId && l.customerId === loanData.customerId && l.status === 'ACTIVE') ||
             (loanData.accountNumber && l.accountNumber === loanData.accountNumber && l.status === 'ACTIVE') ||
             (loanData.customerId && l.customerId === loanData.customerId) ||
             (loanData.accountNumber && l.accountNumber === loanData.accountNumber)
    );

    const customers = getStoredData<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const custIndex = customers.findIndex(
      (c) => (loanData.customerId && c.id === loanData.customerId) ||
             (loanData.accountNumber && c.accountNumber === loanData.accountNumber)
    );
    const cust = custIndex >= 0 ? customers[custIndex] : undefined;

    // Ensure customer has hasLoan flag set to true if loan is active
    if (custIndex >= 0 && loanData.status !== 'COMPLETED' && loanData.status !== 'CLOSED') {
      if (!customers[custIndex].hasLoan) {
        customers[custIndex].hasLoan = true;
        setStoredData(STORAGE_KEYS.CUSTOMERS, customers);
        syncToFirestore('customers', customers[custIndex].id, customers[custIndex]);
      }
    }

    const principal = Number(loanData.principalAmount) || 0;
    const rate = Number(loanData.interestRate) || 0;
    const initialInterest = Math.round((principal * rate) / 100);
    const totalInterest = rate === 0 ? 0 : (Number(loanData.totalInterest) > 0 ? Number(loanData.totalInterest) : initialInterest);

    const allLoanPayments = getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []);
    const paymentsForLoan = allLoanPayments.filter(
      (lp) => (loanData.id && lp.loanId === loanData.id) ||
              (loanData.customerId && lp.customerId === loanData.customerId) ||
              (loanData.accountNumber && lp.accountNumber === loanData.accountNumber)
    );
    const paymentsPrincipalSum = paymentsForLoan.reduce(
      (sum, p) => sum + (Number(p.paidAmount) || 0),
      0
    );
    const paymentsInterestSum = paymentsForLoan.reduce(
      (sum, p) => sum + (Number(p.interestPaid) || 0),
      0
    );
    // Respect explicit caller-provided totalInterestPaid and paidAmount, otherwise calculate from payments
    const totalInterestPaid = loanData.totalInterestPaid !== undefined
      ? Number(loanData.totalInterestPaid) || 0
      : (paymentsForLoan.length > 0 ? paymentsInterestSum : 0);

    const paidAmount = loanData.paidAmount !== undefined
      ? Number(loanData.paidAmount) || 0
      : (paymentsForLoan.length > 0 ? paymentsPrincipalSum : 0);

    const discount = Number(loanData.discountAmount) || 0;
    const penalty = Number(loanData.penaltyAmount) || 0;
    const remainingPrincipal = Math.max(0, principal - paidAmount - discount);
    const dueInterest = Math.max(0, totalInterest - totalInterestPaid);
    const calculatedRemaining = remainingPrincipal + penalty + dueInterest;
    const remainingAmount = loanData.remainingAmount !== undefined
      ? Number(loanData.remainingAmount) || 0
      : calculatedRemaining;
    const status = loanData.status || (remainingAmount <= 0 ? 'COMPLETED' : 'ACTIVE');
    const totalPayable = loanData.totalPayable !== undefined
      ? Number(loanData.totalPayable) || 0
      : (principal + totalInterest);

    const targetId = loanData.id || (existingIndex >= 0 ? loans[existingIndex].id : 'loan_' + Date.now());

    const newLoan: Loan = {
      ...loanData,
      id: targetId,
      customerId: loanData.customerId || cust?.id || '',
      customerName: loanData.customerName || cust?.name || '',
      accountNumber: loanData.accountNumber || cust?.accountNumber || '',
      officeId: loanData.officeId || cust?.officeId || 'MAIN',
      customerMobile: loanData.customerMobile || cust?.mobile || '',
      totalInterest,
      totalInterestPaid,
      paidAmount,
      totalPayable,
      remainingAmount,
      status,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      loans[existingIndex] = newLoan;
    } else {
      loans.push(newLoan);
    }

    setStoredData(STORAGE_KEYS.LOANS, loans);
    syncToFirestore('loans', newLoan.id, newLoan);
    touchSyncTimestamp();
    return newLoan;
  },

  // Loan Payment History Operations
  getLoanPayments: (): LoanPayment[] => {
    const rawPayments = deduplicateLoanPayments(getStoredData<LoanPayment[]>(STORAGE_KEYS.LOAN_PAYMENTS, []));
    const rawCustomers = StorageService.getCustomers();
    const rawLoans = deduplicateLoans(getStoredData<Loan[]>(STORAGE_KEYS.LOANS, []));
    let hasChanges = false;

    const sanitized = rawPayments.map((p) => {
      let changed = false;
      const cust = rawCustomers.find(
        (c) => c.id === p.customerId || (p.accountNumber && c.accountNumber === p.accountNumber)
      );
      const loan = rawLoans.find((l) => (p.loanId && l.id === p.loanId) || (p.customerId && l.customerId === p.customerId) || (p.accountNumber && l.accountNumber === p.accountNumber));

      const customerName = p.customerName || cust?.name || loan?.customerName || '';
      const accountNumber = p.accountNumber || cust?.accountNumber || loan?.accountNumber || '';
      const officeId = p.officeId || cust?.officeId || loan?.officeId || 'MAIN';
      const customerMobile = p.customerMobile || cust?.mobile || (loan as any)?.customerMobile || '';

      const paymentsForLoan = rawPayments.filter(
        (lp) => (p.loanId && lp.loanId === p.loanId) || (p.customerId && lp.customerId === p.customerId) || (p.accountNumber && lp.accountNumber === p.accountNumber)
      );
      const totalInterestPaid = paymentsForLoan.reduce(
        (sum, item) => sum + (Number(item.interestPaid) || 0),
        0
      );

      const principal = Number(loan?.principalAmount) || 0;
      const rate = Number(loan?.interestRate) || 0;
      const calculatedInterest = Math.round((principal * rate) / 100);
      const totalInterest = loan && Number(loan.totalInterest) > 0
        ? Number(loan.totalInterest)
        : (calculatedInterest > 0 ? calculatedInterest : totalInterestPaid);

      const totalPaid = (Number(p.paidAmount) || 0) + (Number(p.interestPaid) || 0) + (Number(p.penaltyPaid) || 0);

      let remainingLoan = p.remainingLoan;

      if (
        p.customerName !== customerName ||
        p.accountNumber !== accountNumber ||
        p.officeId !== officeId ||
        p.customerMobile !== customerMobile ||
        p.totalInterest !== totalInterest ||
        p.totalInterestPaid !== totalInterestPaid ||
        p.totalPaid !== totalPaid ||
        p.remainingLoan !== remainingLoan
      ) {
        changed = true;
        hasChanges = true;
      }

      const updatedPayment: LoanPayment = {
        ...p,
        customerName,
        accountNumber,
        officeId,
        customerMobile,
        totalInterest,
        totalInterestPaid,
        totalPaid,
        remainingLoan,
      };

      return updatedPayment;
    });

    if (hasChanges) {
      setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, sanitized);
    }
    return sanitized;
  },

  saveLoanPaymentsBatch: (updatedPayments: LoanPayment[]): void => {
    const deduped = deduplicateLoanPayments(updatedPayments);
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, deduped);
    deduped.forEach((p) => syncToFirestore('loanPayments', p.id, p));
  },

  addLoanPayment: (payment: Omit<LoanPayment, 'id'>): LoanPayment => {
    const payments = StorageService.getLoanPayments();
    const customers = getStoredData<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const cust = customers.find(
      (c) => c.id === payment.customerId || (payment.accountNumber && c.accountNumber === payment.accountNumber)
    );
    const allLoans = StorageService.getLoans();
    const loan = allLoans.find((l) => (payment.loanId && l.id === payment.loanId) || (payment.customerId && l.customerId === payment.customerId) || (payment.accountNumber && l.accountNumber === payment.accountNumber));

    const customerName = payment.customerName || cust?.name || loan?.customerName || '';
    const accountNumber = payment.accountNumber || cust?.accountNumber || loan?.accountNumber || '';
    const officeId = payment.officeId || cust?.officeId || loan?.officeId || 'MAIN';
    const customerMobile = payment.customerMobile || cust?.mobile || (loan as any)?.customerMobile || '';

    const prevPaymentsForLoan = payments.filter(
      (lp) => (payment.loanId && lp.loanId === payment.loanId) || (payment.customerId && lp.customerId === payment.customerId) || (payment.accountNumber && lp.accountNumber === payment.accountNumber)
    );
    const totalInterestPaid = prevPaymentsForLoan.reduce(
      (sum, p) => sum + (Number(p.interestPaid) || 0),
      0
    ) + (Number(payment.interestPaid) || 0);

    const principal = Number(loan?.principalAmount) || 0;
    const rate = Number(loan?.interestRate) || 0;
    const initialInterest = Math.round((principal * rate) / 100);
    const totalInterest = loan && Number(loan.totalInterest) > 0 ? Number(loan.totalInterest) : initialInterest;
    const totalPaid = (Number(payment.paidAmount) || 0) + (Number(payment.interestPaid) || 0) + (Number(payment.penaltyPaid) || 0);

    const newPayment: LoanPayment = {
      ...payment,
      customerName,
      accountNumber,
      officeId,
      customerMobile,
      totalInterest,
      totalInterestPaid,
      totalPaid,
      id: 'lpay_' + Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    payments.unshift(newPayment);
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, payments);
    syncToFirestore('loanPayments', newPayment.id, newPayment);

    if (loan) {
      const allLoanPayments = [newPayment, ...prevPaymentsForLoan];
      const newPaid = allLoanPayments.reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);
      const newDiscount = allLoanPayments.reduce((sum, p) => sum + (Number(p.discountAmount) || 0), 0);
      const newPenalty = (loan.penaltyAmount || 0) + (Number(payment.penaltyPaid) || 0);
      const remainingPrincipal = Math.max(0, principal - newPaid - newDiscount);
      const dueInterest = Math.max(0, totalInterest - totalInterestPaid);
      const newRemaining = remainingPrincipal + newPenalty + dueInterest;
      const isClosed = newRemaining <= 0;
      const newTotalPayable = principal + totalInterest;

      StorageService.saveLoan({
        ...loan,
        customerName,
        accountNumber,
        officeId,
        customerMobile,
        totalPayable: newTotalPayable,
        totalInterest,
        totalInterestPaid,
        paidAmount: newPaid,
        discountAmount: newDiscount,
        remainingAmount: newRemaining,
        penaltyAmount: newPenalty,
        status: isClosed ? 'COMPLETED' : 'ACTIVE',
      });
    }

    markInstallmentAsPaid(newPayment.customerId, 1, 'loan', newPayment.paymentDate);
    invalidateStatsCache();
    touchSyncTimestamp();

    return newPayment;
  },

  deleteLoan: async (loanId: string): Promise<void> => {
    const loans = StorageService.getLoans();
    const loanToDelete = loans.find((l) => l.id === loanId);
    if (!loanToDelete) return;

    // 1. Remove loan from storage
    const remainingLoans = loans.filter((l) => l.id !== loanId);
    setStoredData(STORAGE_KEYS.LOANS, remainingLoans);
    deleteFromFirestore('loans', loanId, loanToDelete);
    recordDeletion('loans', loanId, { accountNumber: loanToDelete.accountNumber });

    // 2. Remove all loan payments for this loan
    const allPayments = StorageService.getLoanPayments();
    const toDeletePayments = allPayments.filter(
      (p) => p.loanId === loanId ||
             (loanToDelete.customerId && p.customerId === loanToDelete.customerId) ||
             (loanToDelete.accountNumber && p.accountNumber === loanToDelete.accountNumber)
    );
    const remainingPayments = allPayments.filter(
      (p) => p.loanId !== loanId &&
             (!loanToDelete.customerId || p.customerId !== loanToDelete.customerId) &&
             (!loanToDelete.accountNumber || p.accountNumber !== loanToDelete.accountNumber)
    );
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, remainingPayments);
    for (const p of toDeletePayments) {
      deleteFromFirestore('loanPayments', p.id, p);
      recordDeletion('loanPayments', p.id, { accountNumber: p.accountNumber });
    }

    // 3. Update customer hasLoan flag to false if no other active loans exist
    const otherCustLoans = remainingLoans.filter(
      (l) => l.customerId === loanToDelete.customerId ||
             (loanToDelete.accountNumber && l.accountNumber === loanToDelete.accountNumber)
    );
    if (otherCustLoans.length === 0 && loanToDelete.customerId) {
      const customers = StorageService.getCustomers();
      const custIdx = customers.findIndex(
        (c) => c.id === loanToDelete.customerId || (loanToDelete.accountNumber && c.accountNumber === loanToDelete.accountNumber)
      );
      if (custIdx >= 0) {
        customers[custIdx].hasLoan = false;
        setStoredData(STORAGE_KEYS.CUSTOMERS, customers);
        syncToFirestore('customers', customers[custIdx].id, customers[custIdx]);
      }
    }

    invalidateStatsCache();
    touchSyncTimestamp();
  },

  deleteLoanPayment: async (paymentId: string): Promise<void> => {
    const allPayments = StorageService.getLoanPayments();
    const paymentToDelete = allPayments.find((p) => p.id === paymentId);
    if (!paymentToDelete) return;

    const remainingPayments = allPayments.filter((p) => p.id !== paymentId);
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, remainingPayments);
    deleteFromFirestore('loanPayments', paymentId, paymentToDelete);
    recordDeletion('loanPayments', paymentId, { accountNumber: paymentToDelete.accountNumber });

    // Recalculate associated loan
    const loans = StorageService.getLoans();
    const loan = loans.find(
      (l) => (paymentToDelete.loanId && l.id === paymentToDelete.loanId) ||
             (paymentToDelete.customerId && l.customerId === paymentToDelete.customerId) ||
             (paymentToDelete.accountNumber && l.accountNumber === paymentToDelete.accountNumber)
    );

    if (loan) {
      const remainingPaymentsForLoan = remainingPayments.filter(
        (lp) => (loan.id && lp.loanId === loan.id) ||
                (loan.customerId && lp.customerId === loan.customerId) ||
                (loan.accountNumber && lp.accountNumber === loan.accountNumber)
      );

      const newPaid = remainingPaymentsForLoan.reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);
      const newInterestPaid = remainingPaymentsForLoan.reduce((sum, p) => sum + (Number(p.interestPaid) || 0), 0);
      const newDiscount = remainingPaymentsForLoan.reduce((sum, p) => sum + (Number(p.discountAmount) || 0), 0);
      const penalty = Number(loan.penaltyAmount) || 0;
      const principal = Number(loan.principalAmount) || 0;
      const rate = Number(loan.interestRate) || 0;
      const accruedInterest = calculateLoanTotalAccruedInterest(loan);
      const initialInterest = Math.round((principal * rate) / 100);
      const totalInterest = rate === 0 ? 0 : Math.max(initialInterest, accruedInterest);
      const remainingPrincipal = Math.max(0, principal - newPaid - newDiscount);
      const dueInterest = Math.max(0, totalInterest - newInterestPaid);
      const newRemaining = remainingPrincipal + penalty + dueInterest;
      const isClosed = newRemaining <= 0;

      StorageService.saveLoan({
        ...loan,
        paidAmount: newPaid,
        totalInterestPaid: newInterestPaid,
        discountAmount: newDiscount,
        remainingAmount: newRemaining,
        status: isClosed ? 'COMPLETED' : 'ACTIVE',
      });
    }

    invalidateStatsCache();
    touchSyncTimestamp();
  },

  // Interest & Penalty Settings
  getInterestRates: (): InterestRateConfig[] => {
    const rates = getStoredData<InterestRateConfig[]>(STORAGE_KEYS.INTEREST_RATES, []);
    return sortInterestRatesHelper(rates);
  },

  addInterestRate: (rate: number, rateType: 'MONTHLY' | 'WEEKLY' = 'MONTHLY', note?: string): InterestRateConfig => {
    const rates = StorageService.getInterestRates();
    const newRate: InterestRateConfig = {
      id: 'ir_' + Date.now(),
      rate,
      rateType,
      effectiveDate: new Date().toISOString().split('T')[0],
      note: note || 'नवीन लागू केलेला व्याजदर',
    };
    rates.unshift(newRate);
    const sorted = sortInterestRatesHelper(rates);
    setStoredData(STORAGE_KEYS.INTEREST_RATES, sorted);
    syncToFirestore('interestRates', newRate.id, newRate);
    return newRate;
  },

  deleteInterestRate: (id: string): void => {
    const rates = StorageService.getInterestRates();
    const rateToDelete = rates.find((r) => r.id === id);
    const filtered = rates.filter((r) => r.id !== id);
    setStoredData(STORAGE_KEYS.INTEREST_RATES, filtered);
    deleteFromFirestore('interestRates', id);
    if (rateToDelete) {
      recordDeletion('interestRates' as any, id, { name: rateToDelete.note || String(rateToDelete.rate) });
    }
  },

  getPenaltySettings: (): PenaltySetting => {
    return getStoredData<PenaltySetting>(STORAGE_KEYS.PENALTY_SETTINGS, {
      id: 'default',
      weeklyPenalty: 50,
      monthlyPenalty: 200,
      graceDays: 2,
    });
  },

  savePenaltySettings: (settings: PenaltySetting): void => {
    setStoredData(STORAGE_KEYS.PENALTY_SETTINGS, settings);
    syncToFirestore('penaltySettings', 'default', settings);
  },

  // SMS Logs Operations
  getSmsLogs: (): SmsLog[] => getStoredData<SmsLog[]>(STORAGE_KEYS.SMS_LOGS, []),

  addSmsLog: (log: Omit<SmsLog, 'id' | 'sentAt'>): SmsLog => {
    const logs = StorageService.getSmsLogs();
    const newLog: SmsLog = {
      ...log,
      id: 'sms_' + Date.now(),
      sentAt: new Date().toISOString(),
    };
    logs.unshift(newLog);
    setStoredData(STORAGE_KEYS.SMS_LOGS, logs);
    // Note: smsLogs are kept local only and not synced to Firestore database as requested
    return newLog;
  },

  // ── Thakbaki (थकबाकी) Operations ──────────────────────────────────────────
  getThakbakiList: (): ThakbakiEntry[] => {
    return getStoredData<ThakbakiEntry[]>(STORAGE_KEYS.THAKBAKI, []);
  },

  getThakbakiById: (id: string): ThakbakiEntry | undefined => {
    return StorageService.getThakbakiList().find((e) => e.id === id);
  },

  addThakbaki: (data: Omit<ThakbakiEntry, 'id' | 'createdAt' | 'updatedAt' | 'payments' | 'paidAmount' | 'remainingAmount' | 'status'>): ThakbakiEntry => {
    const list = StorageService.getThakbakiList();
    const entry: ThakbakiEntry = {
      ...data,
      id: 'tb_' + Date.now(),
      paidAmount: 0,
      remainingAmount: data.initialAmount,
      status: 'PENDING',
      payments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setStoredData(STORAGE_KEYS.THAKBAKI, [entry, ...list]);
    syncToFirestore('thakbaki', entry.id, entry);
    return entry;
  },

  updateThakbaki: (id: string, updates: Partial<Omit<ThakbakiEntry, 'id' | 'createdAt' | 'payments'>>): ThakbakiEntry => {
    const list = StorageService.getThakbakiList();
    const index = list.findIndex((e) => e.id === id);
    if (index === -1) throw new Error('थकबाकी नोंद सापडली नाही.');
    list[index] = { ...list[index], ...updates, updatedAt: new Date().toISOString() };
    setStoredData(STORAGE_KEYS.THAKBAKI, list);
    syncToFirestore('thakbaki', id, list[index]);
    return list[index];
  },

  recordThakbakiPayment: (id: string, paymentData: { paymentDate: string; paidAmount: number; paymentMode: 'CASH' | 'ONLINE' | 'BANK'; note?: string }): ThakbakiEntry => {
    const list = StorageService.getThakbakiList();
    const index = list.findIndex((e) => e.id === id);
    if (index === -1) throw new Error('थकबाकी नोंद सापडली नाही.');

    const entry = list[index];
    const payment: ThakbakiPayment = {
      id: 'tbp_' + Date.now(),
      paymentDate: paymentData.paymentDate,
      paidAmount: paymentData.paidAmount,
      paymentMode: paymentData.paymentMode,
      note: paymentData.note,
      createdAt: new Date().toISOString(),
    };

    const newPaidAmount = (entry.paidAmount || 0) + paymentData.paidAmount;
    const newRemainingAmount = Math.max(0, entry.initialAmount - newPaidAmount);

    const updatedEntry: ThakbakiEntry = {
      ...entry,
      payments: [...(entry.payments || []), payment],
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      status: newRemainingAmount <= 0 ? 'CLEARED' : 'PENDING',
      lastPaymentDate: paymentData.paymentDate,
      updatedAt: new Date().toISOString(),
    };

    list[index] = updatedEntry;
    setStoredData(STORAGE_KEYS.THAKBAKI, list);
    syncToFirestore('thakbaki', id, updatedEntry);
    return updatedEntry;
  },

  deleteThakbakiPayment: (thakbakiId: string, paymentId: string): ThakbakiEntry => {
    const list = StorageService.getThakbakiList();
    const index = list.findIndex((e) => e.id === thakbakiId);
    if (index === -1) throw new Error('थकबाकी नोंद सापडली नाही.');

    const entry = list[index];
    const paymentToDelete = (entry.payments || []).find((p) => p.id === paymentId);
    if (!paymentToDelete) throw new Error('जमा नोंद सापडली नाही.');

    const newPayments = (entry.payments || []).filter((p) => p.id !== paymentId);
    const newPaidAmount = Math.max(0, (entry.paidAmount || 0) - paymentToDelete.paidAmount);
    const newRemainingAmount = Math.max(0, entry.initialAmount - newPaidAmount);
    const lastPayment = newPayments.length > 0 ? newPayments[newPayments.length - 1].paymentDate : undefined;

    const updatedEntry: ThakbakiEntry = {
      ...entry,
      payments: newPayments,
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      status: newRemainingAmount <= 0 ? 'CLEARED' : 'PENDING',
      lastPaymentDate: lastPayment,
      updatedAt: new Date().toISOString(),
    };

    list[index] = updatedEntry;
    setStoredData(STORAGE_KEYS.THAKBAKI, list);
    syncToFirestore('thakbaki', thakbakiId, updatedEntry);
    return updatedEntry;
  },

  deleteThakbaki: (id: string): void => {
    const list = StorageService.getThakbakiList();
    const entry = list.find((e) => e.id === id);
    const filtered = list.filter((e) => e.id !== id);
    setStoredData(STORAGE_KEYS.THAKBAKI, filtered);
    if (entry) {
      deleteFromFirestore('thakbaki', id, entry);
      recordDeletion('thakbaki' as any, id, entry);
    }
  },
  // ─────────────────────────────────────────────────────────────────────────────

  // Backup & Restore Operations
  exportBackup: (): SystemBackupData => {
    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      brand: 'Narayan Bhishi',
      admins: StorageService.getAdmins(),
      customers: StorageService.getCustomers(),
      bishiConfigs: StorageService.getBishiConfigs(),
      collections: StorageService.getCollections(),
      loans: StorageService.getLoans(),
      loanPayments: StorageService.getLoanPayments(),
      interestRates: StorageService.getInterestRates(),
      penaltySettings: [StorageService.getPenaltySettings()],
      smsLogs: StorageService.getSmsLogs(),
      thakbaki: StorageService.getThakbakiList(),
    };
  },

  importBackup: (backup: SystemBackupData): void => {
    if (!backup || !backup.version) {
      throw new Error('अवैध बॅकअप फाईल. कृपया योग्य JSON फाईल निवडा.');
    }
    setStoredData(STORAGE_KEYS.ADMINS, backup.admins || []);
    setStoredData(STORAGE_KEYS.CUSTOMERS, backup.customers || []);
    setStoredData(STORAGE_KEYS.BISHI_CONFIGS, backup.bishiConfigs || []);
    setStoredData(STORAGE_KEYS.COLLECTIONS, backup.collections || []);
    setStoredData(STORAGE_KEYS.LOANS, backup.loans || []);
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, backup.loanPayments || []);
    setStoredData(STORAGE_KEYS.INTEREST_RATES, backup.interestRates || []);
    if (backup.penaltySettings && backup.penaltySettings[0]) {
      setStoredData(STORAGE_KEYS.PENALTY_SETTINGS, backup.penaltySettings[0]);
    }
    setStoredData(STORAGE_KEYS.SMS_LOGS, backup.smsLogs || []);
    if (backup.thakbaki) {
      setStoredData(STORAGE_KEYS.THAKBAKI, backup.thakbaki);
    }

    // Sync full restoration to Firestore
    (backup.customers || []).forEach((c) => syncToFirestore('customers', c.id, c));
    (backup.collections || []).forEach((c) => syncToFirestore('collections', c.id, c));
    (backup.loans || []).forEach((l) => syncToFirestore('loans', l.id, l));
    (backup.thakbaki || []).forEach((tb) => syncToFirestore('thakbaki', tb.id, tb));
  },

  clearAllData: async (): Promise<void> => {
    setStoredData(STORAGE_KEYS.CUSTOMERS, []);
    setStoredData(STORAGE_KEYS.COLLECTIONS, []);
    setStoredData(STORAGE_KEYS.LOANS, []);
    setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, []);
    setStoredData(STORAGE_KEYS.SMS_LOGS, []);

    try {
      const collectionsToWipe = ['customers', 'collections', 'loans', 'loanPayments', 'smsLogs'];
      for (const colName of collectionsToWipe) {
        const snap = await getDocs(collection(db, colName));
        for (const d of snap.docs) {
          await deleteDoc(d.ref).catch(() => {});
        }
      }
      console.log('[Firestore] All customer and transaction records wiped cleanly.');
    } catch (err) {
      console.warn('Error wiping cloud database:', err);
    }
  },

  // Complete Cloud Database Sync: Uploads all local data to Firebase Firestore using fast atomic batches
  syncAllToFirestore: async (): Promise<void> => {
    try {
      const customers = StorageService.getCustomers();
      if (customers.length > 0) {
        await syncBatchToFirestore(
          'customers',
          customers.map((c) => ({ docId: c.id, data: c }))
        );
      }
      const loans = StorageService.getLoans();
      if (loans.length > 0) {
        await syncBatchToFirestore(
          'loans',
          loans.map((l) => ({ docId: l.id, data: l }))
        );
      }
      const loanPayments = StorageService.getLoanPayments();
      if (loanPayments.length > 0) {
        await syncBatchToFirestore(
          'loanPayments',
          loanPayments.map((p) => ({ docId: p.id, data: p }))
        );
      }
      const collections = StorageService.getCollections();
      const activeCollections = collections.filter(
        (c) => (c.collectedAmount || 0) > 0 || c.status === 'PAID' || c.status === 'PARTIAL'
      );
      if (activeCollections.length > 0) {
        await syncBatchToFirestore(
          'collections',
          activeCollections.map((c) => ({ docId: c.id, data: c }))
        );
      }
      const bishi = StorageService.getBishiConfigs();
      if (bishi.length > 0) {
        await syncBatchToFirestore(
          'bishi',
          bishi.map((b) => ({ docId: b.id, data: b }))
        );
      }
      const interest = StorageService.getInterestRates();
      if (interest.length > 0) {
        await syncBatchToFirestore(
          'interestRates',
          interest.map((i) => ({ docId: i.id, data: i }))
        );
      }
      const penalty = StorageService.getPenaltySettings();
      if (penalty) {
        await syncToFirestore('penaltySettings', penalty.id || 'default', penalty);
      }
      const thakbakiList = StorageService.getThakbakiList();
      if (thakbakiList.length > 0) {
        await syncBatchToFirestore(
          'thakbaki',
          thakbakiList.map((tb) => ({ docId: tb.id, data: tb }))
        );
      }
      console.log('[Firestore] Complete batch synchronization finished.');

      // Strategy 2: Pre-package backup snapshot in Firestore so 11 PM cloud backup uses only 1 Read!
      try {
        const { publishBackupSnapshotToFirestore } = await import('./snapshotService');
        await publishBackupSnapshotToFirestore();
      } catch (snapErr) {
        console.warn('[Firestore] Snapshot package note:', snapErr);
      }
    } catch (err) {
      console.warn('[Firestore] Sync all error:', err);
    }
  },

  // Proactive startup cloud pull: fetches all collections from Firestore to immediately populate or sync local storage
  fetchAndSyncFromFirestore: async (): Promise<void> => {
    try {
      startSyncOp();


      const [
        custSnap,
        loanSnap,
        loanPaySnap,
        bishiSnap,
        rateSnap,
        penaltySnap,
        adminSnap,
        thakbakiSnap,
        collSnap,
        reqSnap,
        memberReqSnap,
      ] = await Promise.all([
        getDocs(collection(db, 'customers')),
        getDocs(collection(db, 'loans')),
        getDocs(collection(db, 'loanPayments')),
        getDocs(collection(db, 'bishi')),
        getDocs(collection(db, 'interestRates')),
        getDocs(collection(db, 'penaltySettings')),
        getDocs(collection(db, 'admins')),
        getDocs(collection(db, 'thakbaki')),
        getDocs(collection(db, 'collections')).catch(() => null),
        getDocs(collection(db, 'requests')).catch(() => null),
        getDocs(collection(db, 'member_requests')).catch(() => null),
      ]);

      let hadRemoteData = false;

      if (!custSnap.empty) {
        hadRemoteData = true;
        const remoteCusts: Customer[] = [];
        const extractedColls: CollectionEntry[] = [];
        const seenCustDocs = new Map<string, any>();
        custSnap.forEach((d: any) => {
          const raw = d.data();
          const acc = String(raw.accountNumber || '').trim().toLowerCase();
          const key = acc || raw.id || d.id;
          if (seenCustDocs.has(key)) {
            const readableId = getFirestoreDocId('customers', d.id, raw);
            if (d.id === readableId) seenCustDocs.set(key, d);
          } else {
            seenCustDocs.set(key, d);
          }
          const fullCustomer: Customer = {
            ...raw,
            id: raw.id || d.id,
            name: raw.name || raw.customerName || '',
            customerName: raw.customerName || raw.name || '',
          };
          remoteCusts.push(fullCustomer);

          // Unpack embedded installments from customer document
          if (Array.isArray(raw.installments) && raw.installments.length > 0) {
            raw.installments.forEach((inst: any) => {
              extractedColls.push({
                id: inst.id || `coll_${fullCustomer.id}_${inst.periodIndex}`,
                customerId: fullCustomer.id,
                customerName: fullCustomer.name,
                accountNumber: fullCustomer.accountNumber,
                officeId: inst.officeId || fullCustomer.officeId || 'MAIN',
                bishiType: inst.bishiType || fullCustomer.bishiType,
                bishiName: inst.bishiName || fullCustomer.bishiName,
                periodIndex: inst.periodIndex,
                periodLabel: inst.periodLabel || `हप्ता ${inst.periodIndex}`,
                dueDate: inst.dueDate,
                paymentDate: inst.paymentDate || undefined,
                paymentTime: inst.paymentTime || undefined,
                paymentMode: inst.paymentMode || undefined,
                expectedAmount: Number(inst.expectedAmount) || 0,
                collectedAmount: Number(inst.collectedAmount) || 0,
                extraAmount: Number(inst.extraAmount) || 0,
                remainingAmount: Number(inst.remainingAmount) || 0,
                interestAmount: Number(inst.interestAmount) || 0,
                historicalInterestRate: Number(inst.historicalInterestRate) || 0,
                penaltyAmount: Number(inst.penaltyAmount) || 0,
                historicalPenaltyRate: Number(inst.historicalPenaltyRate) || 0,
                totalPaid: Number(inst.totalPaid) || 0,
                totalWithPenalty: Number(inst.totalWithPenalty) || 0,
                status: inst.status || 'PENDING',
                note: inst.note || undefined,
                updatedAt: inst.updatedAt || undefined,
              });
            });
          }
        });
        setStoredData(STORAGE_KEYS.CUSTOMERS, deduplicateCustomers(remoteCusts));

        // Merge both direct collections collection and customer embedded installments
        const directColls: CollectionEntry[] = [];
        if (collSnap && !collSnap.empty) {
          collSnap.forEach((d: any) => {
            const raw = d.data();
            directColls.push({ ...raw, id: raw.id || d.id });
          });
        }
        const allRemoteColls = deduplicateCollections([...directColls, ...extractedColls]);
        if (allRemoteColls.length > 0) {
          const validAccounts = new Set(
            remoteCusts.map((c) => String(c.accountNumber || '').trim().toLowerCase())
          );
          const localColls = getStoredData<CollectionEntry[]>(STORAGE_KEYS.COLLECTIONS, []);
          const validLocalColls = localColls.filter((c) =>
            validAccounts.has(String(c.accountNumber || '').trim().toLowerCase())
          );
          setStoredData(STORAGE_KEYS.COLLECTIONS, deduplicateCollections([...allRemoteColls, ...validLocalColls]));
        }
      }

      if (!loanSnap.empty) {
        hadRemoteData = true;
        const remoteLoans: Loan[] = [];
        const seenLoanDocs = new Map<string, any>();
        loanSnap.forEach((d: any) => {
          const raw = d.data();
          const acc = String(raw.accountNumber || '').trim().toLowerCase();
          const key = raw.id || d.id || (acc ? `${acc}_${raw.issueDate || ''}_${raw.principalAmount || 0}` : (raw.customerId || Math.random().toString()));
          if (seenLoanDocs.has(key)) {
            const readableId = getFirestoreDocId('loans', d.id, raw);
            if (d.id === readableId) seenLoanDocs.set(key, d);
          } else {
            seenLoanDocs.set(key, d);
          }
          remoteLoans.push({
            ...raw,
            id: raw.id || d.id,
            customerName: raw.customerName || '',
          });
        });
        setStoredData(STORAGE_KEYS.LOANS, deduplicateLoans(remoteLoans));
      }

      if (!loanPaySnap.empty) {
        hadRemoteData = true;
        const remotePayments: LoanPayment[] = [];
        loanPaySnap.forEach((d: any) => {
          const raw = d.data();
          remotePayments.push({
            ...raw,
            id: raw.id || d.id,
          });
        });
        setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, deduplicateLoanPayments(remotePayments));
      }

      if (!bishiSnap.empty) {
        hadRemoteData = true;
        const remoteBishi: BishiConfig[] = [];
        bishiSnap.forEach((d: any) => {
          const raw = d.data();
          remoteBishi.push({
            ...raw,
            id: raw.id || d.id,
          });
        });
        setStoredData(STORAGE_KEYS.BISHI_CONFIGS, remoteBishi);
      }

      if (!rateSnap.empty) {
        hadRemoteData = true;
        const remoteRates: InterestRateConfig[] = [];
        rateSnap.forEach((d: any) => {
          const raw = d.data();
          remoteRates.push({
            ...raw,
            id: raw.id || d.id,
          });
        });
        setStoredData(STORAGE_KEYS.INTEREST_RATES, sortInterestRatesHelper(remoteRates));
      }

      if (!penaltySnap.empty) {
        hadRemoteData = true;
        let remotePenalty: PenaltySetting | null = null;
        penaltySnap.forEach((d: any) => {
          remotePenalty = d.data() as PenaltySetting;
        });
        if (remotePenalty) {
          setStoredData(STORAGE_KEYS.PENALTY_SETTINGS, remotePenalty);
        }
      }

      if (!adminSnap.empty) {
        hadRemoteData = true;
        const remoteAdmins: Admin[] = [];
        adminSnap.forEach((d: any) => {
          const raw = d.data();
          remoteAdmins.push({
            ...raw,
            id: raw.id || d.id,
          });
          if (raw.password) {
            localStorage.setItem('nb_admin_pass', String(raw.password));
          }
        });
        if (remoteAdmins.length > 0) {
          setStoredData(STORAGE_KEYS.ADMINS, remoteAdmins);
        }
      }

      if (thakbakiSnap && !thakbakiSnap.empty) {
        hadRemoteData = true;
        const remoteThakbaki: ThakbakiEntry[] = [];
        thakbakiSnap.forEach((d: any) => {
          const raw = d.data();
          remoteThakbaki.push({
            ...raw,
            id: raw.id || d.id,
            payments: raw.payments || [],
          });
        });
        setStoredData(STORAGE_KEYS.THAKBAKI, remoteThakbaki);
      }

      if ((reqSnap && !reqSnap.empty) || (memberReqSnap && !memberReqSnap.empty)) {
        hadRemoteData = true;
        const remoteRequests: MemberRequest[] = [];
        if (reqSnap && !reqSnap.empty) {
          reqSnap.forEach((d: any) => {
            remoteRequests.push(normalizeMemberRequest(d.data(), d.id));
          });
        }
        if (memberReqSnap && !memberReqSnap.empty) {
          memberReqSnap.forEach((d: any) => {
            remoteRequests.push(normalizeMemberRequest(d.data(), d.id));
          });
        }
        const localRequests = StorageService.getRequests();
        const reqMap = new Map<string, MemberRequest>();
        remoteRequests.forEach((r) => reqMap.set(r.id, r));
        localRequests.forEach((r) => {
          if (!reqMap.has(r.id)) reqMap.set(r.id, r);
        });
        const mergedRequests = Array.from(reqMap.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setStoredData(STORAGE_KEYS.REQUESTS, mergedRequests);
      }

      // If Firestore is completely fresh and empty, upload local data to seed cloud database
      if (!hadRemoteData) {
        await StorageService.syncAllToFirestore();
      }

      // Update snapshot cache in background with fully merged records
      try {
        const { queueSnapshotPublishDebounced } = await import('./snapshotService');
        queueSnapshotPublishDebounced(5000);
      } catch {
        // Non-fatal
      }

      endSyncOp(true);
    } catch (err) {
      console.warn('[Firestore] Proactive pull note:', err);
      endSyncOp(false);
    }
  },

  // ── Requests (Member App Requests & Approvals) ───────────────────────────
  getRequests: (): MemberRequest[] => {
    return getStoredData<MemberRequest[]>(STORAGE_KEYS.REQUESTS, []);
  },

  fetchRequestsFromFirestore: async (): Promise<MemberRequest[]> => {
    try {
      const [reqSnap, memberReqSnap, userSnap] = await Promise.all([
        getDocs(collection(db, 'requests')).catch(() => null),
        getDocs(collection(db, 'member_requests')).catch(() => null),
        getDocs(collection(db, 'users')).catch(() => null),
      ]);
      const remoteRequests: MemberRequest[] = [];
      const userMap = new Map<string, any>();
      if (userSnap && !userSnap.empty) {
        userSnap.forEach((d: any) => {
          const u = d.data();
          const p = String(u.phone || u.userId || d.id || '').replace(/\D/g, '');
          if (p) userMap.set(p, u);
        });
      }

      if (reqSnap && !reqSnap.empty) {
        reqSnap.forEach((d: any) => {
          remoteRequests.push(normalizeMemberRequest(d.data(), d.id));
        });
      }
      if (memberReqSnap && !memberReqSnap.empty) {
        memberReqSnap.forEach((d: any) => {
          remoteRequests.push(normalizeMemberRequest(d.data(), d.id));
        });
      }
      if (userSnap && !userSnap.empty) {
        const existingMobiles = new Set(
          remoteRequests.map((r) => String(r.mobile || (r as any).userPhone || r.userId || '').replace(/\D/g, ''))
        );
        const existingCustMobiles = new Set(
          StorageService.getCustomers().map((c) => String(c.mobile || '').replace(/\D/g, ''))
        );
        userSnap.forEach((d: any) => {
          const u = d.data();
          const phone = String(u.phone || u.userId || d.id || '').replace(/\D/g, '');
          if (phone && !existingMobiles.has(phone) && !existingCustMobiles.has(phone)) {
            const hasRef = Boolean(u.referredBy);
            remoteRequests.push({
              id: `REQ_${phone}`,
              userId: phone,
              customerName: u.name || 'ॲप सभासद',
              mobile: phone,
              type: 'new_member',
              schemeId: u.activeSchemeId || '',
              schemeName: u.activeSchemeName || 'नवीन ॲप नोंदणी (New App Registration)',
              status: (u.isApproved || u.status === 'active' || u.status === 'approved') && u.activeSchemeId ? 'APPROVED' : 'PENDING',
              amount: 1000,
              message: hasRef
                ? `Android ॲपवरून नोंदणी (रेफरन्स: ${u.referredByName || u.referredBy})`
                : 'Android ॲपवरून नवीन सभासद नोंदणी झाली आहे.',
              referredBy: u.referredBy,
              referredByName: u.referredByName,
              referredByCode: u.referredByCode,
              referralDiscount: hasRef ? Math.round(1000 * 0.1) : undefined,
              createdAt: u.createdAtString || new Date().toISOString(),
              updatedAt: u.updatedAt || u.createdAtString || new Date().toISOString(),
            });
            existingMobiles.add(phone);
          }
        });
      }

      // Enrich any requests with user referral metadata if missing
      remoteRequests.forEach((req) => {
        const p = String(req.mobile || (req as any).userPhone || req.userId || '').replace(/\D/g, '');
        const u = userMap.get(p);
        if (u && u.referredBy && !req.referredBy) {
          req.referredBy = u.referredBy;
          req.referredByName = u.referredByName || 'मार्गदर्शक सदस्य';
          req.referredByCode = u.referredByCode || '';
          req.referralDiscount = Math.round((Number(req.amount) || 1000) * 0.1);
        }
      });
      const localRequests = StorageService.getRequests();
      const reqMap = new Map<string, MemberRequest>();
      // Remote documents take priority
      remoteRequests.forEach((r) => reqMap.set(r.id, r));
      // Keep any local requests
      localRequests.forEach((r) => {
        if (!reqMap.has(r.id)) reqMap.set(r.id, r);
      });
      const mergedRequests = Array.from(reqMap.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setStoredData(STORAGE_KEYS.REQUESTS, mergedRequests);
      notifyDataChange(STORAGE_KEYS.REQUESTS);
      return mergedRequests;
    } catch (err) {
      console.warn('[StorageService] fetchRequestsFromFirestore note:', err);
      return StorageService.getRequests();
    }
  },

  getRequestById: (id: string): MemberRequest | undefined => {
    return StorageService.getRequests().find((r) => r.id === id);
  },

  saveRequests: (requestsList: MemberRequest[]): void => {
    setStoredData(STORAGE_KEYS.REQUESTS, requestsList);
  },

  saveRequest: (reqData: Partial<MemberRequest> & { id?: string }): MemberRequest => {
    const requests = StorageService.getRequests();
    const existingIndex = requests.findIndex((r) => r.id === reqData.id);
    const targetId = reqData.id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const fullReq: MemberRequest = {
      id: targetId,
      memberUid: reqData.memberUid || '',
      customerId: reqData.customerId || '',
      customerName: reqData.customerName || '',
      accountNumber: reqData.accountNumber || '',
      mobile: reqData.mobile || '',
      type: reqData.type || 'other',
      amount: reqData.amount,
      message: reqData.message || '',
      schemeId: reqData.schemeId,
      schemeName: reqData.schemeName,
      fcmToken: reqData.fcmToken,
      status: reqData.status || 'PENDING',
      reviewNote: reqData.reviewNote,
      reviewedBy: reqData.reviewedBy,
      reviewedAt: reqData.reviewedAt,
      metadata: reqData.metadata || {},
      createdAt: reqData.createdAt || now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      requests[existingIndex] = fullReq;
    } else {
      requests.unshift(fullReq);
    }

    setStoredData(STORAGE_KEYS.REQUESTS, requests);
    syncToFirestore('requests', targetId, fullReq);

    AuditService.record({
      action: existingIndex >= 0 ? 'UPDATE' : 'CREATE',
      entityType: 'REQUEST',
      entityId: targetId,
      details: `Request ${fullReq.type} for ${fullReq.customerName} (${fullReq.mobile}) - status: ${fullReq.status}`,
    });

    return fullReq;
  },

  reviewRequest: async (
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    reviewNote: string = '',
    adminName: string = 'Admin',
    customAmount?: number,
    customSchemeId?: string
  ): Promise<MemberRequest> => {
    if (status === 'REJECTED' && !reviewNote.trim()) {
      throw new Error('अर्जाची नोंद नाकारताना कारण (Note) लिहिणे बंधनकारक आहे.');
    }

    const requests = StorageService.getRequests();
    const index = requests.findIndex((r) => r.id === requestId);
    if (index === -1) {
      throw new Error('हा अर्ज सिस्टीममध्ये सापडला नाही.');
    }

    const req = requests[index];
    const now = new Date().toISOString();

    // Idempotency: don't re-apply side-effects if already processed
    if (req.status !== 'PENDING') {
      return req;
    }

    let createdOrUpdatedCustomer: Customer | undefined;
    const searchMobile = (req.mobile || (req as any).customerPhone || (req as any).userPhone || (req as any).userId || '').replace(/\D/g, '');
    const customerName = (req.customerName || (req as any).userName || (req as any).name || 'सभासद').trim();

    // Process side-effects based on request type
    if (status === 'APPROVED') {
      try {
        const normType = (req.type || '').toLowerCase();
        const isSchemeEnrollment =
          normType === 'join_scheme' ||
          normType === 'join' ||
          normType === 'scheme' ||
          normType === 'new_member' ||
          normType === 'new_customer' ||
          normType === 'membership' ||
          normType === 'new_account' ||
          Boolean((req as any).schemeId) ||
          Boolean((req as any).payload?.schemeId) ||
          (!req.customerId && normType !== 'loan' && normType !== 'payment');

        if (isSchemeEnrollment) {
          const bishiConfigs = StorageService.getBishiConfigs();
          const defaultSchemeId = bishiConfigs.length > 0 ? bishiConfigs[0].id : '15_AUGUST';
          const schemeId = (customSchemeId || (req as any).schemeId || (req as any).payload?.schemeId || (req as any).bishiType || defaultSchemeId) as any;
          const matchedBishi = bishiConfigs.find((b) => b.id === schemeId || b.name === schemeId) || bishiConfigs[0];
          const modality: Modality = ((req as any).modality || (req as any).payload?.modality || matchedBishi?.modality || 'W') as any;
          const amount = Number(customAmount || req.amount || (req as any).payload?.amount || (req as any).installmentAmount || 1000);
          const totalInstallments = Number((req as any).totalInstallments || (req as any).payload?.totalInstallments || matchedBishi?.totalInstallments) || (modality === 'W' ? 40 : 10);
          const effectiveDate = (req as any).payload?.startDate || (matchedBishi?.startDate ? matchedBishi.startDate : now.split('T')[0]);

          let cust = req.customerId ? StorageService.getCustomerById(req.customerId) : undefined;
          if (!cust && searchMobile) {
            cust = StorageService.getCustomers().find(
              (c) => c.mobile.replace(/\D/g, '') === searchMobile && c.bishiType === schemeId
            );
          }

          if (!cust) {
            const allCust = StorageService.getCustomers();
            const autoAcc = generateNextAccountNumber(schemeId, allCust, bishiConfigs);

            // Check if user was referred (from req or payload or users collection doc)
            let refBy = req.referredBy || (req as any).payload?.referredBy;
            let refByName = req.referredByName || (req as any).payload?.referredByName;
            let refByCode = req.referredByCode || (req as any).payload?.referredByCode;

            if (!refBy && searchMobile) {
              try {
                const uDoc = await getDoc(doc(db, 'users', searchMobile));
                if (uDoc.exists()) {
                  const ud = uDoc.data();
                  if (ud.referredBy) {
                    refBy = String(ud.referredBy).replace(/\D/g, '');
                    refByName = ud.referredByName || refByName;
                    refByCode = ud.referredByCode || refByCode;
                  }
                }
              } catch (_) {}
            }

            const hasRef = Boolean(refBy);
            const refDiscount = hasRef ? Math.round(amount * 0.1) : 0;

            const newCust = StorageService.addCustomer({
              accountNumber: autoAcc,
              name: customerName,
              mobile: searchMobile || req.mobile || '',
              bishiType: schemeId,
              bishiName: matchedBishi?.name || (req as any).schemeName || schemeId,
              bishiDate: effectiveDate,
              modality,
              amount,
              totalInstallments,
              interestRate: (matchedBishi as any)?.interestRate ?? (modality === 'W' ? 2.5 : 10),
              penaltyRate: (matchedBishi as any)?.penaltyRate ?? 50,
              officeId: req.officeId || 'MAIN',
              address: 'Online Member Application',
              hasLoan: false,
              status: 'ACTIVE',
              referredBy: refBy,
              referredByName: refByName,
              referredByCode: refByCode,
              referralDiscount: refDiscount,
            });
            createdOrUpdatedCustomer = newCust;

            // Generate full weekly/monthly collection schedule upfront!
            // If referred, 1st installment will automatically have 10% cut!
            const rawEntries =
              modality === 'W'
                ? generateWeeklyEntries(newCust, effectiveDate, totalInstallments)
                : generateMonthlyEntries(newCust, effectiveDate, totalInstallments);

            const preparedCollections: CollectionEntry[] = rawEntries.map((c) => ({
              ...c,
              id: `coll_${newCust.id}_${c.periodIndex}`,
              customerName: newCust.name,
              collectedAmount: 0,
              remainingAmount: c.expectedAmount || 0,
              interestAmount: 0,
              totalPaid: 0,
              totalWithPenalty: 0,
              status: 'PENDING' as const,
            }));

            StorageService.saveCollectionsBatch(preparedCollections);

            if (hasRef && refBy) {
              const newRef: Omit<Referral, 'id' | 'createdAt' | 'updatedAt'> = {
                referrerCustomerId: refBy,
                referrerName: refByName || 'मार्गदर्शक सदस्य',
                referrerMobile: refBy,
                referrerAccountNumber: '',
                referredCustomerId: newCust.id,
                referredCustomerName: newCust.name,
                referredCustomerMobile: newCust.mobile,
                referredAccountNumber: newCust.accountNumber,
                referralCode: refByCode || `REF-${newCust.accountNumber}`,
                firstInstallmentAmount: Math.round(amount * 0.9),
                commissionPercentage: 10,
                commissionAmount: refDiscount,
                status: 'PENDING_FIRST_PAYMENT',
                notes: `Referred via code ${refByCode || ''}. 10% discount applied to 1st installment.`,
              };
              StorageService.saveReferral(newRef);
            }

            // Sync the newly created customer with full installment schedule to Firestore
            newCust.installments = preparedCollections.map((c) => ({
              id: c.id,
              customerId: newCust.id,
              customerName: newCust.name,
              accountNumber: newCust.accountNumber,
              officeId: newCust.officeId || 'MAIN',
              bishiType: newCust.bishiType,
              bishiName: newCust.bishiName,
              periodIndex: c.periodIndex,
              periodLabel: c.periodLabel,
              dueDate: c.dueDate,
              expectedAmount: c.expectedAmount,
              collectedAmount: 0,
              remainingAmount: c.expectedAmount,
              status: 'PENDING',
            }));
            await syncToFirestore('customers', newCust.id, newCust);
          } else {
            createdOrUpdatedCustomer = cust;
          }
        } else if (normType === 'loan') {
          let cust = req.customerId ? StorageService.getCustomerById(req.customerId) : undefined;
          if (!cust && searchMobile) {
            cust = StorageService.getCustomers().find(
              (c) => c.mobile.replace(/\D/g, '') === searchMobile
            );
          }
          if (cust && req.amount && req.amount > 0) {
            StorageService.saveLoan({
              customerId: cust.id,
              customerName: cust.name,
              accountNumber: cust.accountNumber,
              officeId: cust.officeId || 'MAIN',
              principalAmount: req.amount,
              issueDate: now.split('T')[0],
              interestRate: 12,
              totalInterest: Math.round((req.amount * 12) / 100),
              totalPayable: req.amount + Math.round((req.amount * 12) / 100),
              remainingAmount: req.amount + Math.round((req.amount * 12) / 100),
              penaltyAmount: 0,
              paidAmount: 0,
              status: 'ACTIVE',
              purposeNote: `Member Request: ${req.message || 'Loan request approved'}`,
            });
            createdOrUpdatedCustomer = cust;
          }
        } else if (normType === 'payment') {
          let cust = req.customerId ? StorageService.getCustomerById(req.customerId) : undefined;
          if (!cust && searchMobile) {
            cust = StorageService.getCustomers().find(
              (c) => c.mobile.replace(/\D/g, '') === searchMobile
            );
          }
          if (cust && req.amount && req.amount > 0) {
            const colls = StorageService.getCollections().filter((c: CollectionEntry) => c.customerId === cust.id);
            const pendingColl = colls.find((c: CollectionEntry) => c.status !== 'PAID');
            if (pendingColl) {
              StorageService.saveCollectionsBatch([{
                ...pendingColl,
                collectedAmount: req.amount,
                paymentDate: now.split('T')[0],
                paymentTime: new Date().toLocaleTimeString('en-US', { hour12: false }),
                paymentMode: 'ONLINE',
                status: req.amount >= pendingColl.expectedAmount ? 'PAID' : 'PARTIAL',
                note: `Member online payment request: ${req.id}`,
              }]);
            }
            createdOrUpdatedCustomer = cust;
          }
        } else if (normType === 'profile_change') {
          if (req.customerId) {
            const cust = StorageService.getCustomerById(req.customerId);
            if (cust) {
              const updates: Partial<Customer> = {};
              if (req.metadata?.name) updates.name = req.metadata.name;
              if (req.metadata?.mobile) updates.mobile = req.metadata.mobile;
              if (req.metadata?.address) updates.address = req.metadata.address;
              StorageService.updateCustomer(cust.id, updates);
              createdOrUpdatedCustomer = { ...cust, ...updates };
            }
          }
        }
      } catch (sideEffectErr) {
        console.error('[reviewRequest] Side-effect error:', sideEffectErr);
      }
    }

    // Update Request status
    const schemeConfigsList = StorageService.getBishiConfigs();
    const finalSchemeId = customSchemeId || (createdOrUpdatedCustomer ? createdOrUpdatedCustomer.bishiType : req.schemeId);
    const finalSchemeName = (finalSchemeId ? schemeConfigsList.find(b => b.id === finalSchemeId)?.name : req.schemeName) || req.schemeName;

    const updatedReq: MemberRequest = {
      ...req,
      status,
      schemeId: finalSchemeId,
      schemeName: finalSchemeName,
      accountNumber: createdOrUpdatedCustomer?.accountNumber || req.accountNumber || '',
      customerId: createdOrUpdatedCustomer?.id || req.customerId || '',
      reviewNote: reviewNote.trim() || undefined,
      reviewedBy: adminName,
      reviewedAt: now,
      updatedAt: now,
    };

    requests[index] = updatedReq;
    setStoredData(STORAGE_KEYS.REQUESTS, requests);

    // Sync to BOTH 'requests' and 'member_requests' collections in Firestore
    await syncToFirestore('requests', requestId, updatedReq);
    await syncToFirestore('member_requests', requestId, updatedReq);

    // Also update member_requests doc in Firestore if applicable
    try {
      await setDoc(
        doc(db, 'member_requests', requestId),
        {
          id: requestId,
          status,
          accountNumber: updatedReq.accountNumber || '',
          assignedAccountNo: updatedReq.accountNumber || '',
          customerId: updatedReq.customerId || '',
          reviewedBy: adminName,
          reviewedAt: now,
          reviewNote: reviewNote.trim() || null,
          adminRemarks: reviewNote.trim() || null,
          updatedAt: now,
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Could not update member_requests doc in Firestore:', e);
    }

    // Link user in 'users' collection in Firestore
    if (searchMobile) {
      try {
        await setDoc(
          doc(db, 'users', searchMobile),
          {
            customerId: updatedReq.customerId || '',
            accountNumber: updatedReq.accountNumber || '',
            assignedAccountNo: updatedReq.accountNumber || '',
            bishiType: finalSchemeId,
            isApproved: status === 'APPROVED',
            status: status === 'APPROVED' ? 'active' : 'rejected',
            rejectionReason: status === 'REJECTED' ? (reviewNote.trim() || null) : null,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('Could not update users doc in Firestore:', e);
      }
    }

    // In-App Notification for member
    const notifTitle = status === 'APPROVED' ? 'तुमचा अर्ज मंजूर झाला आहे' : 'तुमचा अर्ज नाकारला आहे';
    const notifBody = status === 'APPROVED'
      ? `तुमचा "${req.type}" संदर्भातील अर्ज मंजूर करण्यात आला आहे.`
      : `तुमचा अर्ज नाकारण्यात आला आहे. कारण: ${reviewNote.trim()}`;

    StorageService.saveNotification({
      memberUid: req.memberUid,
      customerId: req.customerId || updatedReq.customerId,
      mobile: req.mobile,
      title: notifTitle,
      body: notifBody,
      type: status === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
      requestId: req.id,
      read: false,
    });

    // Record Audit Log
    AuditService.record({
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityType: 'REQUEST',
      entityId: requestId,
      adminName,
      details: `${status} request (${req.type}) for ${req.customerName}. Note: ${reviewNote || 'None'}`,
    });

    notifyDataChange();
    touchSyncTimestamp(undefined, true);

    return updatedReq;
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  getNotifications: (mobileFilter?: string): InAppNotification[] => {
    const list = getStoredData<InAppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    if (!mobileFilter) return list;
    const clean = mobileFilter.replace(/\D/g, '');
    return list.filter((n) => !n.mobile || n.mobile.replace(/\D/g, '') === clean);
  },

  saveNotification: (notifData: Omit<InAppNotification, 'id' | 'createdAt'> & { id?: string }): InAppNotification => {
    const list = getStoredData<InAppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    const id = notifData.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullNotif: InAppNotification = {
      ...notifData,
      id,
      read: notifData.read ?? false,
      createdAt: new Date().toISOString(),
    };
    list.unshift(fullNotif);
    if (list.length > 200) list.length = 200;
    setStoredData(STORAGE_KEYS.NOTIFICATIONS, list);
    syncToFirestore('notifications', id, fullNotif);
    return fullNotif;
  },

  markNotificationRead: async (notifId: string): Promise<void> => {
    const list = getStoredData<InAppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    const idx = list.findIndex((n) => n.id === notifId);
    if (idx >= 0) {
      list[idx].read = true;
      setStoredData(STORAGE_KEYS.NOTIFICATIONS, list);
      await syncToFirestore('notifications', notifId, list[idx]);
    }
  },

  // ── Shri Mahakal Finance: Payouts (20% Return) ───────────────────────────
  getPayouts: (): Payout[] => {
    return getStoredData<Payout[]>(STORAGE_KEYS.PAYOUTS, []);
  },

  savePayout: (payoutData: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Payout => {
    const list = getStoredData<Payout[]>(STORAGE_KEYS.PAYOUTS, []);
    const id = payoutData.id || `payout_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();
    const newPayout: Payout = {
      ...payoutData,
      id,
      returnPercentage: payoutData.returnPercentage ?? 20,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    list.unshift(newPayout);
    setStoredData(STORAGE_KEYS.PAYOUTS, list);
    syncToFirestore('payouts', id, newPayout);
    notifyDataChange();
    return newPayout;
  },

  updatePayout: (payoutId: string, updates: Partial<Payout>): Payout | null => {
    const list = getStoredData<Payout[]>(STORAGE_KEYS.PAYOUTS, []);
    const idx = list.findIndex((p) => p.id === payoutId);
    if (idx === -1) return null;
    const updated: Payout = {
      ...list[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    list[idx] = updated;
    setStoredData(STORAGE_KEYS.PAYOUTS, list);
    syncToFirestore('payouts', payoutId, updated);
    notifyDataChange();
    return updated;
  },

  // ── Shri Mahakal Finance: Referrals (10% Commission) ──────────────────────
  getReferrals: (): Referral[] => {
    return getStoredData<Referral[]>(STORAGE_KEYS.REFERRALS, []);
  },

  saveReferral: (refData: Omit<Referral, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Referral => {
    const list = getStoredData<Referral[]>(STORAGE_KEYS.REFERRALS, []);
    const id = refData.id || `ref_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();
    const newRef: Referral = {
      ...refData,
      id,
      commissionPercentage: refData.commissionPercentage ?? 10,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    list.unshift(newRef);
    setStoredData(STORAGE_KEYS.REFERRALS, list);
    syncToFirestore('referrals', id, newRef);
    notifyDataChange();
    return newRef;
  },

  updateReferral: (referralId: string, updates: Partial<Referral>): Referral | null => {
    const list = getStoredData<Referral[]>(STORAGE_KEYS.REFERRALS, []);
    const idx = list.findIndex((r) => r.id === referralId);
    if (idx === -1) return null;
    const updated: Referral = {
      ...list[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    list[idx] = updated;
    setStoredData(STORAGE_KEYS.REFERRALS, list);
    syncToFirestore('referrals', referralId, updated);
    notifyDataChange();
    return updated;
  },

  awardReferralCommissionOnFirstPayment: async (customer: Customer, firstInstallmentAmount: number): Promise<void> => {
    try {
      const cleanMemberPhone = String(customer.mobile || '').replace(/\D/g, '');
      let refPhone = String(customer.referredBy || '').replace(/\D/g, '');
      let refName = customer.referredByName || 'मार्गदर्शक सदस्य';

      // If customer.referredBy is not set on Customer object, check Firestore users collection
      if (!refPhone && cleanMemberPhone) {
        try {
          const uDoc = await getDoc(doc(db, 'users', cleanMemberPhone));
          if (uDoc.exists()) {
            const uData = uDoc.data();
            if (uData.referredBy) {
              refPhone = String(uData.referredBy).replace(/\D/g, '');
              refName = uData.referredByName || refName;
              customer.referredBy = refPhone;
              customer.referredByName = refName;
              customer.referredByCode = uData.referredByCode;
            }
          }
        } catch (_) {}
      }

      if (!refPhone) return;

      const commId = `COMM_${cleanMemberPhone}_1`;
      const commAmount = Math.round((Number(customer.amount) || Number(firstInstallmentAmount) || 1000) * 0.1);
      const nowIso = new Date().toISOString();

      // 1. Write to commissions collection in Firestore
      await setDoc(
        doc(db, 'commissions', commId),
        {
          id: commId,
          referrerPhone: refPhone,
          referrerName: refName,
          referredPhone: cleanMemberPhone,
          referredName: customer.name || 'सदस्य',
          installmentAmount: firstInstallmentAmount,
          commissionPercentage: 10,
          commissionAmount: commAmount,
          status: 'CREDITED',
          schemeId: customer.bishiType || '',
          schemeName: customer.bishiName || customer.bishiType || '',
          accountNo: customer.accountNumber || '',
          createdAt: serverTimestamp(),
          createdAtIso: nowIso,
        },
        { merge: true }
      ).catch(() => {});

      // 2. Update referrals collection in Firestore & localStorage
      const allRefs = StorageService.getReferrals();
      const refIdx = allRefs.findIndex(
        (r) => r.referredCustomerMobile.replace(/\D/g, '') === cleanMemberPhone || r.referredCustomerId === customer.id
      );

      if (refIdx !== -1) {
        allRefs[refIdx] = {
          ...allRefs[refIdx],
          status: 'COMMISSION_EARNED',
          commissionAmount: commAmount,
          earnedAt: nowIso,
          updatedAt: nowIso,
        };
        setStoredData(STORAGE_KEYS.REFERRALS, allRefs);
        syncToFirestore('referrals', allRefs[refIdx].id, allRefs[refIdx]);
      } else {
        const newRef: Referral = {
          id: `ref_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          referrerCustomerId: refPhone,
          referrerName: refName,
          referrerMobile: refPhone,
          referrerAccountNumber: '',
          referredCustomerId: customer.id,
          referredCustomerName: customer.name,
          referredCustomerMobile: cleanMemberPhone,
          referredAccountNumber: customer.accountNumber,
          referralCode: customer.referredByCode || `REF-${customer.accountNumber}`,
          firstInstallmentAmount,
          commissionPercentage: 10,
          commissionAmount: commAmount,
          status: 'COMMISSION_EARNED',
          earnedAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        allRefs.unshift(newRef);
        setStoredData(STORAGE_KEYS.REFERRALS, allRefs);
        syncToFirestore('referrals', newRef.id, newRef);
      }
      notifyDataChange();

      // 3. Update referrer's user document in Firestore to increment earned commissions
      try {
        const refUserDoc = await getDoc(doc(db, 'users', refPhone));
        if (refUserDoc.exists()) {
          const currentTotal = Number(refUserDoc.data().totalCommissionEarned) || 0;
          await setDoc(
            doc(db, 'users', refPhone),
            {
              totalCommissionEarned: currentTotal + commAmount,
              lastCommissionEarnedAt: nowIso,
            },
            { merge: true }
          );
        }
      } catch (_) {}

      // 4. Update customer doc in Firestore
      customer.referralCommissionStatus = 'EARNED';
      syncToFirestore('customers', customer.id, customer);
    } catch (e) {
      console.warn('Error awarding referral commission:', e);
    }
  },

  // ── Staff & Roles Management ──────────────────────────────────────────────
  getStaffMembers: (): StaffMember[] => {
    const defaultStaff: StaffMember[] = [
      {
        id: 'staff_admin_1',
        name: 'मुख्य व्यवस्थापक (Super Admin)',
        mobile: '9876543210',
        email: 'admin@shrimahakal.com',
        role: 'SUPER_ADMIN',
        active: true,
        canCollect: true,
        canApproveRequests: true,
        canViewReports: true,
        canManageLoans: true,
        createdAt: new Date().toISOString(),
      },
    ];
    return getStoredData<StaffMember[]>(STORAGE_KEYS.STAFF, defaultStaff);
  },

  saveStaffMember: (staffData: Omit<StaffMember, 'id' | 'createdAt'> & { id?: string }): StaffMember => {
    const list = getStoredData<StaffMember[]>(STORAGE_KEYS.STAFF, []);
    const id = staffData.id || `staff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newStaff: StaffMember = {
      ...staffData,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.unshift(newStaff);
    setStoredData(STORAGE_KEYS.STAFF, list);
    syncToFirestore('staff', id, newStaff);
    notifyDataChange();
    return newStaff;
  },

  updateStaffMember: (staffId: string, updates: Partial<StaffMember>): StaffMember | null => {
    const list = getStoredData<StaffMember[]>(STORAGE_KEYS.STAFF, []);
    const idx = list.findIndex((s) => s.id === staffId);
    if (idx === -1) return null;
    const updated: StaffMember = {
      ...list[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    list[idx] = updated;
    setStoredData(STORAGE_KEYS.STAFF, list);
    syncToFirestore('staff', staffId, updated);
    notifyDataChange();
    return updated;
  },

  deleteStaffMember: (staffId: string): void => {
    const list = getStoredData<StaffMember[]>(STORAGE_KEYS.STAFF, []);
    const filtered = list.filter((s) => s.id !== staffId);
    setStoredData(STORAGE_KEYS.STAFF, filtered);
    deleteFromFirestore('staff', staffId);
    notifyDataChange();
  },

  // ── Broadcast Alerts (To All Members / Schemes) ───────────────────────────
  getBroadcastAlerts: (): BroadcastAlert[] => {
    return getStoredData<BroadcastAlert[]>(STORAGE_KEYS.BROADCAST_ALERTS, []);
  },

  saveBroadcastAlert: (alertData: Omit<BroadcastAlert, 'id' | 'sentAt'> & { id?: string }): BroadcastAlert => {
    const list = getStoredData<BroadcastAlert[]>(STORAGE_KEYS.BROADCAST_ALERTS, []);
    const id = alertData.id || `alert_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();
    const newAlert: BroadcastAlert = {
      ...alertData,
      id,
      sentAt: nowIso,
    };
    list.unshift(newAlert);
    setStoredData(STORAGE_KEYS.BROADCAST_ALERTS, list);
    syncToFirestore('broadcast_alerts', id, newAlert);

    // Also inject into member notifications collection for in-app display!
    const notif: InAppNotification = {
      id: `notif_${id}`,
      mobile: '', // Broadcast to all
      title: alertData.title,
      titleMr: alertData.titleMr || alertData.title,
      body: alertData.message,
      message: alertData.message,
      messageMr: alertData.messageMr || alertData.message,
      type: 'GENERAL',
      read: false,
      createdAt: nowIso,
    };
    StorageService.saveNotification(notif);
    notifyDataChange();
    return newAlert;
  },

  // Real-time synchronization listeners with Firebase Firestore across all collections
  setupFirestoreListeners: (onUpdate: () => void): (() => void) => {
    const unsubscribes: (() => void)[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onUpdate();
      }, 150);
    };

    // 1. Listen for customers in Firestore (Strategy 2: Customers doc embeds full installment schedule)
    try {
      const unsubCust = onSnapshot(
        collection(db, 'customers'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: Customer[] = [];
          const extractedColls: CollectionEntry[] = [];

          snapshot.forEach((d: any) => {
            const raw = d.data();
            const fullCustomer: Customer = {
              ...raw,
              id: raw.id || d.id,
              name: raw.name || raw.customerName || '',
              customerName: raw.customerName || raw.name || '',
            };
            remoteList.push(fullCustomer);

            // Unpack embedded installments from customer document
            if (Array.isArray(raw.installments) && raw.installments.length > 0) {
              raw.installments.forEach((inst: any) => {
                extractedColls.push({
                  id: inst.id || `coll_${fullCustomer.id}_${inst.periodIndex}`,
                  customerId: fullCustomer.id,
                  customerName: fullCustomer.name,
                  accountNumber: fullCustomer.accountNumber,
                  officeId: inst.officeId || fullCustomer.officeId || 'MAIN',
                  bishiType: inst.bishiType || fullCustomer.bishiType,
                  bishiName: inst.bishiName || fullCustomer.bishiName,
                  periodIndex: inst.periodIndex,
                  periodLabel: inst.periodLabel || `हप्ता ${inst.periodIndex}`,
                  dueDate: inst.dueDate,
                  paymentDate: inst.paymentDate || undefined,
                  paymentTime: inst.paymentTime || undefined,
                  paymentMode: inst.paymentMode || undefined,
                  expectedAmount: Number(inst.expectedAmount) || 0,
                  collectedAmount: Number(inst.collectedAmount) || 0,
                  extraAmount: Number(inst.extraAmount) || 0,
                  remainingAmount: Number(inst.remainingAmount) || 0,
                  interestAmount: Number(inst.interestAmount) || 0,
                  historicalInterestRate: Number(inst.historicalInterestRate) || 0,
                  penaltyAmount: Number(inst.penaltyAmount) || 0,
                  historicalPenaltyRate: Number(inst.historicalPenaltyRate) || 0,
                  totalPaid: Number(inst.totalPaid) || 0,
                  totalWithPenalty: Number(inst.totalWithPenalty) || 0,
                  status: inst.status || 'PENDING',
                  note: inst.note || undefined,
                  updatedAt: inst.updatedAt || undefined,
                });
              });
            }
          });

          setStoredData(STORAGE_KEYS.CUSTOMERS, deduplicateCustomers(remoteList));

          const activeAccounts = new Set(
            remoteList.map((c) => String(c.accountNumber || '').trim().toLowerCase())
          );
          const localColls = getStoredData<CollectionEntry[]>(STORAGE_KEYS.COLLECTIONS, []);
          const validLocalColls = localColls.filter((c) =>
            activeAccounts.has(String(c.accountNumber || '').trim().toLowerCase())
          );
          const merged = deduplicateCollections([...extractedColls, ...validLocalColls]);
          setStoredData(STORAGE_KEYS.COLLECTIONS, merged);

          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore customers listener error:', err?.message || err)
      );
      unsubscribes.push(unsubCust);
    } catch (e) {}

    // 2. Listen for loans in Firestore
    try {
      const unsubLoans = onSnapshot(
        collection(db, 'loans'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: Loan[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            const fullLoan: Loan = {
              ...raw,
              id: raw.id || d.id,
              customerName: raw.customerName || '',
            };
            remoteList.push(fullLoan);
          });
          setStoredData(STORAGE_KEYS.LOANS, deduplicateLoans(remoteList));
          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore loans listener error:', err?.message || err)
      );
      unsubscribes.push(unsubLoans);
    } catch (e) {}

    // 4. Listen for loanPayments in Firestore
    try {
      const unsubLoanPay = onSnapshot(
        collection(db, 'loanPayments'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: LoanPayment[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, deduplicateLoanPayments(remoteList));
          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore loanPayments listener error:', err?.message || err)
      );
      unsubscribes.push(unsubLoanPay);
    } catch (e) {}

    // 5. Listen for bishi configs in Firestore
    try {
      const unsubBishi = onSnapshot(
        collection(db, 'bishi'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: BishiConfig[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          setStoredData(STORAGE_KEYS.BISHI_CONFIGS, remoteList);
          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore bishi listener error:', err?.message || err)
      );
      unsubscribes.push(unsubBishi);
    } catch (e) {}

    // 6. Listen for interestRates in Firestore
    try {
      const unsubRates = onSnapshot(
        collection(db, 'interestRates'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          if (!snapshot.empty) {
            const remoteList: InterestRateConfig[] = [];
            snapshot.forEach((d: any) => {
              const raw = d.data();
              remoteList.push({
                ...raw,
                id: raw.id || d.id,
              });
            });
            setStoredData(STORAGE_KEYS.INTEREST_RATES, sortInterestRatesHelper(remoteList));
            debouncedUpdate();
          }
        },
        (err: any) => console.warn('Firestore interestRates listener error:', err?.message || err)
      );
      unsubscribes.push(unsubRates);
    } catch (e) {}

    // 7. Listen for penaltySettings in Firestore
    try {
      const unsubPenalty = onSnapshot(
        collection(db, 'penaltySettings'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          if (!snapshot.empty) {
            let remotePenalty: PenaltySetting | null = null;
            snapshot.forEach((d: any) => {
              remotePenalty = d.data() as PenaltySetting;
            });
            if (remotePenalty) {
              setStoredData(STORAGE_KEYS.PENALTY_SETTINGS, remotePenalty);
              debouncedUpdate();
            }
          }
        },
        (err: any) => console.warn('Firestore penaltySettings listener error:', err?.message || err)
      );
      unsubscribes.push(unsubPenalty);
    } catch (e) {}

    // 8. Listen for admins & password in Firestore
    try {
      const unsubAdmins = onSnapshot(
        collection(db, 'admins'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          if (!snapshot.empty) {
            const remoteList: Admin[] = [];
            snapshot.forEach((d: any) => {
              const raw = d.data();
              remoteList.push({
                ...raw,
                id: raw.id || d.id,
              });
              if (raw.password) {
                localStorage.setItem('nb_admin_pass', String(raw.password));
              }
            });
            setStoredData(STORAGE_KEYS.ADMINS, remoteList);
            debouncedUpdate();
          }
        },
        (err: any) => console.warn('Firestore admins listener error:', err?.message || err)
      );
      unsubscribes.push(unsubAdmins);
    } catch (e) {}

    // 9. Listen for thakbaki in Firestore
    try {
      const unsubThakbaki = onSnapshot(
        collection(db, 'thakbaki'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          if (!snapshot.empty) {
            const remoteList: ThakbakiEntry[] = [];
            snapshot.forEach((d: any) => {
              const raw = d.data();
              remoteList.push({
                ...raw,
                id: raw.id || d.id,
                payments: raw.payments || [],
              });
            });
            setStoredData(STORAGE_KEYS.THAKBAKI, remoteList);
            debouncedUpdate();
          }
        },
        (err: any) => console.warn('Firestore thakbaki listener error:', err?.message || err)
      );
      unsubscribes.push(unsubThakbaki);
    } catch (e) {}

    // 10. Listen for member requests in Firestore (both requests and member_requests)
    try {
      let cachedRequests: MemberRequest[] = [];
      let cachedMemberRequests: MemberRequest[] = [];
      let hasReceivedRequests = false;
      let hasReceivedMemberRequests = false;

      const mergeAndSaveRequests = () => {
        const reqMap = new Map<string, MemberRequest>();
        if (!hasReceivedRequests || !hasReceivedMemberRequests) {
          StorageService.getRequests().forEach((r) => reqMap.set(r.id, r));
        }
        if (hasReceivedRequests) {
          cachedRequests.forEach((r) => reqMap.set(r.id, r));
        }
        if (hasReceivedMemberRequests) {
          cachedMemberRequests.forEach((r) => reqMap.set(r.id, r));
        }
        const combined = Array.from(reqMap.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setStoredData(STORAGE_KEYS.REQUESTS, combined);
        debouncedUpdate();
      };

      const unsubRequests = onSnapshot(
        collection(db, 'requests'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: MemberRequest[] = [];
          snapshot.forEach((d: any) => {
            remoteList.push(normalizeMemberRequest(d.data(), d.id));
          });
          hasReceivedRequests = true;
          cachedRequests = remoteList;
          mergeAndSaveRequests();
        },
        (err: any) => console.warn('Firestore requests listener error:', err?.message || err)
      );
      unsubscribes.push(unsubRequests);

      const unsubMemberReqs = onSnapshot(
        collection(db, 'member_requests'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: MemberRequest[] = [];
          snapshot.forEach((d: any) => {
            remoteList.push(normalizeMemberRequest(d.data(), d.id));
          });
          hasReceivedMemberRequests = true;
          cachedMemberRequests = remoteList;
          mergeAndSaveRequests();
        },
        (err: any) => console.warn('Firestore member_requests listener error:', err?.message || err)
      );
      unsubscribes.push(unsubMemberReqs);
    } catch (e) {}

    // 11. Listen for notifications in Firestore
    try {
      const unsubNotifs = onSnapshot(
        collection(db, 'notifications'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: InAppNotification[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          remoteList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setStoredData(STORAGE_KEYS.NOTIFICATIONS, remoteList);
          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore notifications listener error:', err?.message || err)
      );
      unsubscribes.push(unsubNotifs);
    } catch (e) {}

    // 12. Listen for payouts (20% Return)
    try {
      const unsubPayouts = onSnapshot(
        collection(db, 'payouts'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: Payout[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          remoteList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setStoredData(STORAGE_KEYS.PAYOUTS, remoteList);
          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore payouts listener error:', err?.message || err)
      );
      unsubscribes.push(unsubPayouts);
    } catch (e) {}

    // 13. Listen for referrals (10% Commission)
    try {
      const unsubRefs = onSnapshot(
        collection(db, 'referrals'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: Referral[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          remoteList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setStoredData(STORAGE_KEYS.REFERRALS, remoteList);
          debouncedUpdate();
        },
        (err: any) => console.warn('Firestore referrals listener error:', err?.message || err)
      );
      unsubscribes.push(unsubRefs);
    } catch (e) {}

    // 14. Listen for staff members
    try {
      const unsubStaff = onSnapshot(
        collection(db, 'staff'),
        (snapshot: any) => {
          if (snapshot.metadata?.hasPendingWrites) return;
          const remoteList: StaffMember[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          if (remoteList.length > 0) {
            setStoredData(STORAGE_KEYS.STAFF, remoteList);
            debouncedUpdate();
          }
        },
        (err: any) => console.warn('Firestore staff listener error:', err?.message || err)
      );
      unsubscribes.push(unsubStaff);
    } catch (e) {}


    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribes.forEach((fn) => {
        try {
          fn();
        } catch (e) {}
      });
    };
  },
};

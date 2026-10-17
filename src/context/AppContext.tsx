import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  BishiConfig,
  BishiType,
  CollectionEntry,
  Customer,
  InterestRateConfig,
  Loan,
  LoanPayment,
  OfficeId,
  PenaltySetting,
  SmsLog,
  ThakbakiEntry,
  MemberRequest,
  InAppNotification,
  Payout,
  Referral,
  StaffMember,
  BroadcastAlert,
} from '../types';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  StorageService,
  setStoredData,
  STORAGE_KEYS,
  normalizeMemberRequest,
  deduplicateCustomers,
  deduplicateCollections,
  deduplicateLoans,
  deduplicateLoanPayments,
} from '../services/db';
import { useAuth } from './AuthContext';
import { Language, translations } from '../utils/translations';
import { performIncrementalSync, IncrementalSyncResult } from '../services/incrementalSync';
import { AutoBackupService } from '../services/backup';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AppContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations.MR;
  activeOffice: OfficeId;
  setActiveOffice: (office: OfficeId) => void;
  selectedBishiFilter: 'ALL' | BishiType;
  setSelectedBishiFilter: (bishi: 'ALL' | BishiType) => void;
  customers: Customer[];
  bishiConfigs: BishiConfig[];
  collections: CollectionEntry[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  interestRates: InterestRateConfig[];
  penaltySettings: PenaltySetting;
  smsLogs: SmsLog[];
  thakbakiList: ThakbakiEntry[];
  requests: MemberRequest[];
  pendingRequestsCount: number;
  notifications: InAppNotification[];
  payouts: Payout[];
  referrals: Referral[];
  staffMembers: StaffMember[];
  broadcastAlerts: BroadcastAlert[];
  refreshData: () => void;
  toasts: Toast[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  syncWithFirebase: () => Promise<void>;
  clearAllData: () => Promise<void>;
  isRefreshing: boolean;
  refreshAllData: (forceFull?: boolean) => Promise<IncrementalSyncResult>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentAdmin } = useAuth();
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      // Default to Marathi ('MR') on first open
      const sessionLang = sessionStorage.getItem('narayan_bishi_language');
      if (sessionLang === 'EN' || sessionLang === 'MR') {
        return sessionLang;
      }
      localStorage.setItem('narayan_bishi_language', 'MR');
    } catch {
      // ignore
    }
    return 'MR';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      sessionStorage.setItem('narayan_bishi_language', lang);
      localStorage.setItem('narayan_bishi_language', lang);
    } catch {
      // ignore
    }
  };

  const t = translations[language] || translations.MR;

  const [activeOffice, setActiveOffice] = useState<OfficeId>('ALL');

  useEffect(() => {
    try {
      sessionStorage.removeItem('narayan_bishi_active_office');
      localStorage.removeItem('narayan_bishi_active_office');
    } catch {
      // ignore
    }
  }, []);

  const [selectedBishiFilter, setSelectedBishiFilter] = useState<'ALL' | BishiType>('ALL');

  const [customers, setCustomers] = useState<Customer[]>(StorageService.getCustomers);
  const [bishiConfigs, setBishiConfigs] = useState<BishiConfig[]>(StorageService.getBishiConfigs);
  const [collections, setCollections] = useState<CollectionEntry[]>(StorageService.getCollections);
  const [loans, setLoans] = useState<Loan[]>(StorageService.getLoans);
  const [loanPayments, setLoanPayments] = useState<LoanPayment[]>(StorageService.getLoanPayments);
  const [interestRates, setInterestRates] = useState<InterestRateConfig[]>(StorageService.getInterestRates);
  const [penaltySettings, setPenaltySettings] = useState<PenaltySetting>(StorageService.getPenaltySettings);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>(StorageService.getSmsLogs);
  const [thakbakiList, setThakbakiList] = useState<ThakbakiEntry[]>(StorageService.getThakbakiList);
  const [requests, setRequests] = useState<MemberRequest[]>(StorageService.getRequests);
  const [notifications, setNotifications] = useState<InAppNotification[]>(StorageService.getNotifications);
  const [payouts, setPayouts] = useState<Payout[]>(StorageService.getPayouts);
  const [referrals, setReferrals] = useState<Referral[]>(StorageService.getReferrals);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(StorageService.getStaffMembers);
  const [broadcastAlerts, setBroadcastAlerts] = useState<BroadcastAlert[]>(StorageService.getBroadcastAlerts);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  const pendingRequestsCount = requests.filter((r) => r.status === 'PENDING').length;

  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshData = () => {
    setCustomers(StorageService.getCustomers());
    setBishiConfigs(StorageService.getBishiConfigs());
    setCollections(StorageService.getCollections());
    setLoans(StorageService.getLoans());
    setLoanPayments(StorageService.getLoanPayments());
    setInterestRates(StorageService.getInterestRates());
    setPenaltySettings(StorageService.getPenaltySettings());
    setSmsLogs(StorageService.getSmsLogs());
    setThakbakiList(StorageService.getThakbakiList());
    setRequests(StorageService.getRequests());
    setNotifications(StorageService.getNotifications());
    setPayouts(StorageService.getPayouts());
    setReferrals(StorageService.getReferrals());
    setStaffMembers(StorageService.getStaffMembers());
    setBroadcastAlerts(StorageService.getBroadcastAlerts());
  };

  const syncWithFirebase = async () => {
    setSyncStatus('syncing');
    try {
      await StorageService.syncAllToFirestore();
      setSyncStatus('synced');
      refreshData();
      showToast('Firebase डेटाबेससह यशस्वीपणे सिंक झाले!', 'success');
      setTimeout(() => setSyncStatus('idle'), 4000);
    } catch (err: any) {
      setSyncStatus('error');
      showToast('सिंक करताना त्रुटी आली: ' + (err?.message || 'अज्ञात त्रुटी'), 'error');
      setTimeout(() => setSyncStatus('idle'), 4000);
    }
  };

  useEffect(() => {
    refreshData();

    // 1. Subscribe to auto-sync status updates from StorageService for instant UI feedback
    const unsubStatus = StorageService.onSyncStatusChange((status) => {
      setSyncStatus(status);
    });

    // Reactive State Bus (Option A): Whenever any record is added, edited, or deleted anywhere,
    // automatically refresh all UI state instantly without needing a page reload!
    const unsubData = StorageService.onDataChange(() => {
      refreshData();
    });

    // Auto-refresh when user switches back to this tab
    const handleWindowFocus = () => {
      refreshData();
    };
    window.addEventListener('focus', handleWindowFocus);

    // 2. Realtime listener on stats/summary doc
    let unsubStats: (() => void) | null = null;
    let unsubCustomers: (() => void) | null = null;
    let unsubCollections: (() => void) | null = null;
    let unsubLoans: (() => void) | null = null;
    let unsubLoanPayments: (() => void) | null = null;
    let unsubBishi: (() => void) | null = null;

    try {
      unsubStats = onSnapshot(doc(db, 'stats', 'summary'), async (snap: any) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const cloudLastUpdated = data?.lastUpdated as string | undefined;
        const lastSyncedAt = localStorage.getItem('nb_last_synced_at');

        const cloudCusts = Number(data?.totalCustomers) || 0;
        const cloudLoans = Number(data?.totalLoans) || 0;
        const cloudColls = Number(data?.totalCollections) || 0;
        const localCustList = StorageService.getCustomers();
        const localCusts = localCustList.length;
        const localLoans = StorageService.getLoans().length;
        const localColls = StorageService.getCollections().length;

        // Prune deleted customers locally using activeCustomerAccounts if present
        if (
          Array.isArray(data?.activeCustomerAccounts) &&
          data.activeCustomerAccounts.length > 0 &&
          cloudCusts > 0
        ) {
          const activeSet = new Set(
            data.activeCustomerAccounts.map((a: string) => String(a).trim().toLowerCase())
          );
          if (localCustList.length > cloudCusts || localCustList.some((c) => !activeSet.has(String(c.accountNumber).trim().toLowerCase()))) {
            const pruned = localCustList.filter((c) =>
              activeSet.has(String(c.accountNumber).trim().toLowerCase())
            );
            if (pruned.length !== localCustList.length) {
              const removedAccs = new Set(
                localCustList
                  .filter((c) => !activeSet.has(String(c.accountNumber).trim().toLowerCase()))
                  .map((c) => String(c.accountNumber).trim().toLowerCase())
              );
              setStoredData(STORAGE_KEYS.CUSTOMERS, pruned);

              const collections = StorageService.getCollections();
              const prunedColls = collections.filter(
                (c) => !removedAccs.has(String(c.accountNumber).trim().toLowerCase())
              );
              if (prunedColls.length !== collections.length) {
                setStoredData(STORAGE_KEYS.COLLECTIONS, prunedColls);
              }

              const loans = StorageService.getLoans();
              const prunedLoans = loans.filter(
                (l) => !removedAccs.has(String(l.accountNumber).trim().toLowerCase())
              );
              if (prunedLoans.length !== loans.length) {
                setStoredData(STORAGE_KEYS.LOANS, prunedLoans);
              }

              const payments = StorageService.getLoanPayments();
              const prunedPayments = payments.filter(
                (p) => !removedAccs.has(String(p.accountNumber).trim().toLowerCase())
              );
              if (prunedPayments.length !== payments.length) {
                setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, prunedPayments);
              }

              refreshData();
            }
          }
        }

        const localAccSet = new Set(localCustList.map((c) => String(c.accountNumber).trim().toLowerCase()));
        const hasMissingActiveAccounts =
          Array.isArray(data?.activeCustomerAccounts) &&
          data.activeCustomerAccounts.some((acc: string) => !localAccSet.has(String(acc).trim().toLowerCase()));

        const isCountsMismatch =
          (cloudCusts > 0 && localCusts !== cloudCusts) ||
          (cloudLoans > 0 && localLoans !== cloudLoans) ||
          (cloudColls > 0 && localColls !== cloudColls) ||
          hasMissingActiveAccounts;

        const cloudBackupTime = Number(data?.lastDriveBackupTimestamp || data?.lastBackupTimestamp) || 0;
        if (cloudBackupTime > 0) {
          const hasUpdatedBackup = AutoBackupService.syncCloudBackup(data);
          if (hasUpdatedBackup) {
            window.dispatchEvent(new CustomEvent('nb_backup_synced', { detail: data }));
          }
        }

        if ((cloudLastUpdated && (!lastSyncedAt || cloudLastUpdated > lastSyncedAt)) || isCountsMismatch) {
          await performIncrementalSync(isCountsMismatch);
          refreshData();
        }
      });
    } catch (e) {
      console.warn('[AppContext] Realtime stats listener note:', e);
    }

    // Realtime Customers listener - instantly reflects remote customer additions, edits, and deletions
    try {
      unsubCustomers = onSnapshot(
        collection(db, 'customers'),
        (snapshot: any) => {
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

          const dedupedCusts = deduplicateCustomers(remoteList);
          setStoredData(STORAGE_KEYS.CUSTOMERS, dedupedCusts);
          setCustomers(dedupedCusts);

          const activeAccounts = new Set(
            remoteList.map((c) => String(c.accountNumber || '').trim().toLowerCase())
          );
          const localColls = StorageService.getCollections();
          const validLocalColls = localColls.filter((c) =>
            activeAccounts.has(String(c.accountNumber || '').trim().toLowerCase())
          );
          const merged = deduplicateCollections([...extractedColls, ...validLocalColls]);
          setStoredData(STORAGE_KEYS.COLLECTIONS, merged);
          setCollections(merged);

          refreshData();
        },
        (err: any) => console.warn('[AppContext] Customers listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] Customers listener setup note:', e);
    }

    // Realtime Collections listener - reflects direct installment deposits and payments
    try {
      unsubCollections = onSnapshot(
        collection(db, 'collections'),
        (snapshot: any) => {
          const directColls: CollectionEntry[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            directColls.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          const localColls = StorageService.getCollections();
          const merged = deduplicateCollections([...directColls, ...localColls]);
          setStoredData(STORAGE_KEYS.COLLECTIONS, merged);
          setCollections(merged);
        },
        (err: any) => console.warn('[AppContext] Collections listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] Collections listener setup note:', e);
    }

    // Realtime Loans listener - reflects remote loans directly
    try {
      unsubLoans = onSnapshot(
        collection(db, 'loans'),
        (snapshot: any) => {
          const remoteList: Loan[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
              customerName: raw.customerName || '',
            });
          });
          const dedupedLoans = deduplicateLoans(remoteList);
          setStoredData(STORAGE_KEYS.LOANS, dedupedLoans);
          setLoans(dedupedLoans);
          refreshData();
        },
        (err: any) => console.warn('[AppContext] Loans listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] Loans listener setup note:', e);
    }

    // Realtime Loan Payments listener - reflects loan repayments directly
    try {
      unsubLoanPayments = onSnapshot(
        collection(db, 'loanPayments'),
        (snapshot: any) => {
          const remoteList: LoanPayment[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          const dedupedPayments = deduplicateLoanPayments(remoteList);
          setStoredData(STORAGE_KEYS.LOAN_PAYMENTS, dedupedPayments);
          setLoanPayments(dedupedPayments);
          refreshData();
        },
        (err: any) => console.warn('[AppContext] LoanPayments listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] LoanPayments listener setup note:', e);
    }

    // Realtime Bishi listener - reflects remote configs directly (including deletions)
    try {
      unsubBishi = onSnapshot(
        collection(db, 'bishi'),
        (snapshot: any) => {
          const remoteList: BishiConfig[] = [];
          snapshot.forEach((d: any) => {
            const raw = d.data();
            remoteList.push({
              ...raw,
              id: raw.id || d.id,
            });
          });
          setStoredData(STORAGE_KEYS.BISHI_CONFIGS, remoteList);
          setBishiConfigs(remoteList);
        },
        (err: any) => console.warn('[AppContext] Bishi listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] Bishi listener setup note:', e);
    }

    // Realtime Requests listener - automatically receives member requests from Member App (both requests and member_requests)
    let unsubRequests: (() => void) | null = null;
    let unsubMemberRequests: (() => void) | null = null;
    try {
      let cachedRequests: MemberRequest[] = [];
      let cachedMemberReqs: MemberRequest[] = [];
      let hasReceivedRequests = false;
      let hasReceivedMemberReqs = false;

      const syncCombinedRequests = () => {
        const reqMap = new Map<string, MemberRequest>();
        if (!hasReceivedRequests || !hasReceivedMemberReqs) {
          StorageService.getRequests().forEach((r) => reqMap.set(r.id, r));
        }
        if (hasReceivedRequests) {
          cachedRequests.forEach((r) => reqMap.set(r.id, r));
        }
        if (hasReceivedMemberReqs) {
          cachedMemberReqs.forEach((r) => reqMap.set(r.id, r));
        }
        const combined = Array.from(reqMap.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        StorageService.saveRequests(combined);
        setRequests(combined);
      };

      unsubRequests = onSnapshot(
        collection(db, 'requests'),
        (snapshot: any) => {
          const remoteList: MemberRequest[] = [];
          snapshot.forEach((d: any) => {
            remoteList.push(normalizeMemberRequest(d.data(), d.id));
          });
          hasReceivedRequests = true;
          cachedRequests = remoteList;
          syncCombinedRequests();
        },
        (err: any) => console.warn('[AppContext] Requests listener error:', err?.message || err)
      );

      unsubMemberRequests = onSnapshot(
        collection(db, 'member_requests'),
        (snapshot: any) => {
          const remoteList: MemberRequest[] = [];
          snapshot.forEach((d: any) => {
            remoteList.push(normalizeMemberRequest(d.data(), d.id));
          });
          hasReceivedMemberReqs = true;
          cachedMemberReqs = remoteList;
          syncCombinedRequests();
        },
        (err: any) => console.warn('[AppContext] MemberRequests listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] Requests listener setup note:', e);
    }

    // Realtime Users listener - automatically receives new registered users from Member Android App
    let unsubUsers: (() => void) | null = null;
    try {
      unsubUsers = onSnapshot(
        collection(db, 'users'),
        () => {
          StorageService.fetchRequestsFromFirestore().then((remoteReqs) => {
            if (remoteReqs && remoteReqs.length > 0) {
              setRequests(remoteReqs);
            }
          });
        },
        (err: any) => console.warn('[AppContext] Users listener error:', err?.message || err)
      );
    } catch (e) {
      console.warn('[AppContext] Users listener setup note:', e);
    }

    // Proactively pull member requests from Firestore on app load
    StorageService.fetchRequestsFromFirestore()
      .then((remoteReqs) => {
        if (remoteReqs && remoteReqs.length > 0) {
          setRequests(remoteReqs);
        }
      })
      .catch((err) => {
        console.warn('[AppContext] Proactive requests pull note:', err);
      });

    // 3. Low-read startup sync: If local storage has minimal data, do a quick fetch
    if (currentAdmin) {
      const localCustCount = StorageService.getCustomers().length;
      if (localCustCount === 0) {
        StorageService.fetchAndSyncFromFirestore()
          .then(() => {
            refreshData();
          })
          .catch((err) => {
            console.warn('[AppContext] Startup full sync note:', err);
          });
      } else {
        performIncrementalSync()
          .then(() => {
            refreshData();
          })
          .catch((err) => {
            console.warn('[AppContext] Startup incremental sync note:', err);
          });
      }
    }

    return () => {
      if (unsubStatus) unsubStatus();
      if (unsubData) unsubData();
      window.removeEventListener('focus', handleWindowFocus);
      if (unsubStats) unsubStats();
      if (unsubCustomers) unsubCustomers();
      if (unsubCollections) unsubCollections();
      if (unsubLoans) unsubLoans();
      if (unsubLoanPayments) unsubLoanPayments();
      if (unsubBishi) unsubBishi();
      if (unsubRequests) unsubRequests();
      if (unsubMemberRequests) unsubMemberRequests();
      if (unsubUsers) unsubUsers();
    };
  }, [currentAdmin]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = 'toast_' + Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clearAllData = async () => {
    try {
      await StorageService.clearAllData();
      refreshData();
      showToast(language === 'EN' ? 'All data cleared successfully.' : 'सर्व डेटा यशस्वीपणे हटवला गेला.', 'success');
    } catch (err: any) {
      showToast(language === 'EN' ? 'Error clearing data: ' + err?.message : 'डेटा हटवताना त्रुटी आली: ' + err?.message, 'error');
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshAllData = async (forceFull: boolean = true): Promise<IncrementalSyncResult> => {
    setIsRefreshing(true);
    try {
      const res = await performIncrementalSync(forceFull);
      refreshData();
      if (res.updatedCount > 0 || res.deletedCount > 0) {
        showToast(
          language === 'EN'
            ? `Data updated: ${res.updatedCount} added/modified, ${res.deletedCount} removed (${res.readsCount} reads)`
            : `डेटा अद्ययावत: ${res.updatedCount} नवीन/बदल, ${res.deletedCount} हटवले (${res.readsCount} रीड्स)`,
          'success'
        );
      } else {
        showToast(
          language === 'EN'
            ? `All data is up to date (${res.readsCount} read)`
            : `सर्व डेटा अद्ययावत आहे (${res.readsCount} रीड)`,
          'info'
        );
      }
      return res;
    } catch (err: any) {
      const errorMsg = err?.message || 'Refresh error';
      showToast(language === 'EN' ? `Refresh error: ${errorMsg}` : `रिफ्रेश करताना त्रुटी: ${errorMsg}`, 'error');
      return {
        updatedCount: 0,
        deletedCount: 0,
        readsCount: 1,
        isUpToDate: false,
        message: errorMsg,
      };
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        t,
        activeOffice,
        setActiveOffice,
        selectedBishiFilter,
        setSelectedBishiFilter,
        customers,
        bishiConfigs,
        collections,
        loans,
        loanPayments,
        interestRates,
        penaltySettings,
        smsLogs,
        thakbakiList,
        requests,
        pendingRequestsCount,
        notifications,
        payouts,
        referrals,
        staffMembers,
        broadcastAlerts,
        refreshData,
        toasts,
        showToast,
        removeToast,
        syncStatus,
        syncWithFirebase,
        clearAllData,
        isRefreshing,
        refreshAllData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};

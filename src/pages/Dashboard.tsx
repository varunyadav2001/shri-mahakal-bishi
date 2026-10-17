import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { BishiType, OfficeId, Customer, Installment, StatsSummary } from '../types';
import { QuickCollectionModal } from '../components/collections/QuickCollectionModal';
import { WelcomeBanner } from '../components/common/WelcomeBanner';
import {
  formatCurrency,
  formatDateMarathi,
  getBishiNameMarathi,
  matchesCustomerSearch,
} from '../utils/formatters';
import { MarathiTextInput } from '../components/common/MarathiTextInput';
import { CustomDropdown } from '../components/common/CustomDropdown';
import { getStatsSummary, DEFAULT_STATS } from '../services/stats';
import {
  Users,
  Wallet,
  Clock,
  Landmark,
  Calendar,
  AlertTriangle,
  ArrowUpRight,
  Filter,
  Percent,
  FileText,
  ChevronRight,
  Zap,
  UserPlus,
  ShieldCheck,
  Search,
  X,
  RefreshCw,
  FileCheck,
  Share2,
  Gift,
  CheckCircle2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export const Dashboard: React.FC = () => {
  const {
    selectedBishiFilter,
    setSelectedBishiFilter,
    bishiConfigs,
    customers,
    collections,
    referrals,
    requests,
    loans,
    t,
    language,
    isRefreshing,
    refreshAllData,
    pendingRequestsCount,
  } = useApp();

  const [modalityFilter, setModalityFilter] = React.useState<'ALL' | 'W' | 'M'>('ALL');
  const officeFilter = 'ALL';

  const [isQuickCollectOpen, setIsQuickCollectOpen] = useState(false);
  const [collectCustId, setCollectCustId] = useState<string | undefined>(undefined);
  const [dashboardSearch, setDashboardSearch] = useState('');

  const navigate = useNavigate();
  const todayStr = new Date().toISOString().split('T')[0];

  // ── Step 2 & 4: Singleton stats/summary read with ~2 minute TTL cache ──
  const [stats, setStats] = useState<StatsSummary>(DEFAULT_STATS);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);


  const [dashboardSearchResults, setDashboardSearchResults] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const fetchStats = async (force: boolean = false) => {
    setIsRefreshingStats(true);
    try {
      const data = await getStatsSummary(force);
      setStats(data);
    } catch (e) {
      console.warn('Dashboard stats load note:', e);
    } finally {
      setIsRefreshingStats(false);
    }
  };

  useEffect(() => {
    // 1 getDoc() call (or 0 reads if within 2-min sessionStorage TTL)
    fetchStats(false);
  }, []);

  // When customers list updates via realtime listener, re-fetch fresh stats
  useEffect(() => {
    fetchStats(false);
  }, [customers.length]);

  // Instant client-side search (0 Firestore reads!)
  useEffect(() => {
    const term = dashboardSearch.trim();
    if (!term) {
      setDashboardSearchResults([]);
      setIsSearching(false);
      return;
    }

    const results = customers
      .filter((c) => matchesCustomerSearch(c, term))
      .slice(0, 10);
    setDashboardSearchResults(results);
    setIsSearching(false);
  }, [dashboardSearch, customers]);

  const isFilterActive = officeFilter !== 'ALL' || selectedBishiFilter !== 'ALL' || modalityFilter !== 'ALL';

  const filteredCustomers = React.useMemo(() => {
    return customers.filter((c) => {
      if (officeFilter !== 'ALL' && c.officeId !== officeFilter) return false;
      if (selectedBishiFilter !== 'ALL' && c.bishiType !== selectedBishiFilter) return false;
      if (modalityFilter !== 'ALL' && c.modality !== modalityFilter) return false;
      return true;
    });
  }, [customers, officeFilter, selectedBishiFilter, modalityFilter]);

  const filteredCustomerIdentifiers = React.useMemo(() => {
    const ids = new Set<string>();
    const accs = new Set<string>();
    for (const c of filteredCustomers) {
      if (c.id) ids.add(c.id);
      if (c.accountNumber) accs.add(String(c.accountNumber).trim());
    }
    return { ids, accs };
  }, [filteredCustomers]);

  const filteredCollections = React.useMemo(() => {
    if (!isFilterActive) return collections;
    return collections.filter(
      (c) =>
        filteredCustomerIdentifiers.ids.has(c.customerId) ||
        (c.accountNumber && filteredCustomerIdentifiers.accs.has(String(c.accountNumber).trim()))
    );
  }, [collections, isFilterActive, filteredCustomerIdentifiers]);

  const filteredLoans = React.useMemo(() => {
    if (!isFilterActive) return loans;
    return loans.filter(
      (l) =>
        filteredCustomerIdentifiers.ids.has(l.customerId) ||
        (l.accountNumber && filteredCustomerIdentifiers.accs.has(String(l.accountNumber).trim()))
    );
  }, [loans, isFilterActive, filteredCustomerIdentifiers]);

  // Combined reference and referral connections for Dashboard display
  const referredConnections = React.useMemo(() => {
    const list: Array<{
      id: string;
      referredName: string;
      referredMobile: string;
      accountNumber?: string;
      schemeName?: string;
      referrerName: string;
      referrerMobile: string;
      referrerCode?: string;
      originalAmount: number;
      discountedAmount: number;
      discountAmount: number;
      firstInstallmentStatus: 'PAID' | 'PENDING';
      commissionStatus: 'CREDITED' | 'PENDING';
      commissionAmount: number;
      isEnrolled: boolean;
    }> = [];

    const seenMobiles = new Set<string>();

    // 1. From customers who have referredBy
    customers.forEach((c) => {
      if (c.referredBy) {
        const mob = c.mobile.replace(/\D/g, '');
        seenMobiles.add(mob);

        const custColls = collections.filter(
          (item) => item.customerId === c.id || item.accountNumber === c.accountNumber
        );
        const firstColl = custColls.find((item) => item.periodIndex === 1);
        const isPaid = firstColl?.status === 'PAID' || (firstColl?.collectedAmount || 0) > 0;
        const origAmt = Number(c.amount) || 1000;
        const discAmt = Number(c.referralDiscount) || Math.round(origAmt * 0.1);
        const expAmt = Number(firstColl?.expectedAmount) || Math.max(0, origAmt - discAmt);

        list.push({
          id: `cust_${c.id}`,
          referredName: c.name,
          referredMobile: c.mobile,
          accountNumber: c.accountNumber,
          schemeName: getBishiNameMarathi(c.bishiType, language, bishiConfigs),
          referrerName: c.referredByName || 'मार्गदर्शक सदस्य',
          referrerMobile: c.referredBy,
          referrerCode: c.referredByCode,
          originalAmount: origAmt,
          discountedAmount: expAmt,
          discountAmount: discAmt,
          firstInstallmentStatus: isPaid ? 'PAID' : 'PENDING',
          commissionStatus: isPaid ? 'CREDITED' : 'PENDING',
          commissionAmount: discAmt,
          isEnrolled: true,
        });
      }
    });

    // 2. From referrals collection
    referrals.forEach((r) => {
      const mob = (r.referredCustomerMobile || '').replace(/\D/g, '');
      if (mob && !seenMobiles.has(mob)) {
        seenMobiles.add(mob);
        const isPaid = r.status === 'COMMISSION_PAID' || r.status === 'COMMISSION_EARNED';
        const origAmt = Number(r.firstInstallmentAmount) || 1000;
        const discAmt = Number(r.commissionAmount) || Math.round(origAmt * 0.1);

        list.push({
          id: `ref_${r.id}`,
          referredName: r.referredCustomerName,
          referredMobile: r.referredCustomerMobile,
          accountNumber: r.referredAccountNumber,
          referrerName: r.referrerName,
          referrerMobile: r.referrerMobile,
          referrerCode: r.referralCode,
          originalAmount: origAmt,
          discountedAmount: Math.max(0, origAmt - discAmt),
          discountAmount: discAmt,
          firstInstallmentStatus: isPaid ? 'PAID' : 'PENDING',
          commissionStatus: isPaid ? 'CREDITED' : 'PENDING',
          commissionAmount: discAmt,
          isEnrolled: Boolean(r.referredAccountNumber),
        });
      }
    });

    // 3. From pending member requests with referral
    requests.forEach((req) => {
      const mob = (req.mobile || '').replace(/\D/g, '');
      if (req.referredBy && mob && !seenMobiles.has(mob)) {
        seenMobiles.add(mob);
        const amt = Number(req.amount) || 1000;
        const disc = Math.round(amt * 0.1);
        list.push({
          id: `req_${req.id}`,
          referredName: req.customerName,
          referredMobile: req.mobile,
          referrerName: req.referredByName || 'मार्गदर्शक सदस्य',
          referrerMobile: req.referredBy,
          referrerCode: req.referredByCode,
          originalAmount: amt,
          discountedAmount: amt - disc,
          discountAmount: disc,
          firstInstallmentStatus: 'PENDING',
          commissionStatus: 'PENDING',
          commissionAmount: disc,
          isEnrolled: false,
        });
      }
    });

    return list;
  }, [customers, collections, referrals, requests, language, bishiConfigs]);

  // Today's pending list scoped to active filtered collections
  const todaysPendingList = React.useMemo(() => {
    return filteredCollections
      .filter((c) => {
        if (c.status === 'PAID') return false;
        if (!isFilterActive && officeFilter !== 'ALL' && c.officeId && c.officeId !== officeFilter) return false;
        return c.dueDate <= todayStr;
      })
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        customerId: c.customerId,
        accountNumber: c.accountNumber,
        customerName: c.customerName,
        dueDate: c.dueDate,
        amount: c.remainingAmount > 0 ? c.remainingAmount : c.expectedAmount,
      })) as any[];
  }, [filteredCollections, isFilterActive, officeFilter, todayStr]);

  // Card 1: Total Customers — live from memory (66), or filtered count if filter is active
  const totalCustomersCount = isFilterActive
    ? filteredCustomers.length
    : (customers.length > 0 ? customers.length : (stats.totalCustomers || 0));

  // Card 2: Today's Collection
  const todaysCollection = React.useMemo(() => {
    if (isFilterActive) {
      return filteredCollections
        .filter((c) => c.paymentDate === todayStr)
        .reduce((sum, c) => sum + (Number(c.collectedAmount) || 0), 0);
    }
    if (filteredCollections.length > 0) {
      return filteredCollections
        .filter((c) => c.paymentDate === todayStr)
        .reduce((sum, c) => sum + (Number(c.collectedAmount) || 0), 0);
    }
    return stats.todaysCollection || 0;
  }, [filteredCollections, isFilterActive, todayStr, stats.todaysCollection]);

  // Card 3: Today's Due / Pending Amount
  const todaysPendingAmount = React.useMemo(() => {
    if (isFilterActive) {
      return filteredCollections
        .filter((c) => c.dueDate <= todayStr && c.status !== 'PAID')
        .reduce(
          (sum, c) =>
            sum +
            (Number(c.remainingAmount) || Math.max(0, (Number(c.expectedAmount) || 0) - (Number(c.collectedAmount) || 0))),
          0
        );
    }
    if (todaysPendingList.length > 0) {
      return todaysPendingList
        .filter((inst) => officeFilter === 'ALL' || inst.officeId === officeFilter)
        .reduce((sum, inst) => sum + (Number(inst.amount) || 0), 0);
    }
    if (filteredCollections.length > 0) {
      return filteredCollections
        .filter((c) => c.dueDate <= todayStr && c.status !== 'PAID')
        .reduce(
          (sum, c) =>
            sum +
            (Number(c.remainingAmount) || Math.max(0, (Number(c.expectedAmount) || 0) - (Number(c.collectedAmount) || 0))),
          0
        );
    }
    return stats.todaysDueAmount || 0;
  }, [todaysPendingList, filteredCollections, isFilterActive, officeFilter, todayStr, stats.todaysDueAmount]);

  // Card 4: Total Bishi Collected
  const totalCollectedBishi = React.useMemo(() => {
    if (isFilterActive) {
      return filteredCollections.reduce((sum, c) => sum + (Number(c.collectedAmount) || 0), 0);
    }
    if (filteredCollections.length > 0) {
      return filteredCollections.reduce((sum, c) => sum + (Number(c.collectedAmount) || 0), 0);
    }
    return stats.totalBishiCollected || 0;
  }, [filteredCollections, isFilterActive, stats.totalBishiCollected]);

  // Card 5: Total Loan Principal
  const totalLoanAmount = React.useMemo(() => {
    if (isFilterActive) {
      return filteredLoans
        .filter((l) => l.status === 'ACTIVE')
        .reduce((sum, l) => sum + (Number(l.principalAmount) || 0), 0);
    }
    if (filteredLoans.length > 0) {
      return filteredLoans
        .filter((l) => l.status === 'ACTIVE')
        .reduce((sum, l) => sum + (Number(l.principalAmount) || 0), 0);
    }
    return stats.totalPrincipalLoans || 0;
  }, [filteredLoans, isFilterActive, stats.totalPrincipalLoans]);

  // Card 6: Loan Remaining Balance
  const loanRemainingAmount = React.useMemo(() => {
    if (isFilterActive) {
      return filteredLoans
        .filter((l) => l.status === 'ACTIVE')
        .reduce((sum, l) => sum + (Number(l.remainingAmount) || 0), 0);
    }
    if (filteredLoans.length > 0) {
      return filteredLoans
        .filter((l) => l.status === 'ACTIVE')
        .reduce((sum, l) => sum + (Number(l.remainingAmount) || 0), 0);
    }
    return stats.loanBalanceDue || 0;
  }, [filteredLoans, isFilterActive, stats.loanBalanceDue]);

  // Card 7: Pending Installments Count
  const todaysPendingInstallmentsCount = React.useMemo(() => {
    if (isFilterActive) {
      return filteredCollections.filter((c) => c.dueDate <= todayStr && c.status !== 'PAID').length;
    }
    if (todaysPendingList.length > 0) {
      return todaysPendingList.filter((inst) => officeFilter === 'ALL' || inst.officeId === officeFilter).length;
    }
    if (filteredCollections.length > 0) {
      return filteredCollections.filter((c) => c.dueDate <= todayStr && c.status !== 'PAID').length;
    }
    return stats.todaysDueInstallments || 0;
  }, [todaysPendingList, filteredCollections, isFilterActive, officeFilter, todayStr, stats.todaysDueInstallments]);

  // Card 8: Today's Penalty
  const todaysPenaltyAmount = React.useMemo(() => {
    if (isFilterActive) {
      return filteredCollections
        .filter((c) => c.paymentDate === todayStr)
        .reduce((sum, c) => sum + (Number(c.penaltyAmount) || 0), 0);
    }
    if (filteredCollections.length > 0) {
      return filteredCollections
        .filter((c) => c.paymentDate === todayStr)
        .reduce((sum, c) => sum + (Number(c.penaltyAmount) || 0), 0);
    }
    return stats.todaysPenalty || 0;
  }, [filteredCollections, isFilterActive, todayStr, stats.todaysPenalty]);

  return (
    <div className="space-y-4 sm:space-y-6 pb-12 font-marathi min-h-screen flex flex-col justify-between bg-[#F8FAFC]">
      <div className="space-y-3.5 sm:space-y-6">

        {/* Hero Welcome Banner Card */}
        <WelcomeBanner />

        {/* TOP QUICK DAILY ACTION BAR - Easy Access for Daily Collection & Request Approvals */}
        <div className="bg-gradient-to-r from-[#0F172A] via-[#1E3A8A] to-[#2563EB] p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl shadow-md border border-[#1E3A8A]/20 flex flex-col md:flex-row items-center justify-between gap-3.5 sm:gap-4 text-white">
          <div className="flex items-center space-x-3 sm:space-x-3.5 w-full md:w-auto">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center text-amber-300 font-black text-xl sm:text-2xl shadow-inner shrink-0">
              <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="bg-amber-400/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-400/30 uppercase tracking-wider">
                  {t.heroTagline}
                </span>
              </div>
              <h2 className="text-sm sm:text-lg font-black tracking-tight text-white mt-0.5 truncate">
                {t.heroTitle}
              </h2>
              <p className="text-[11px] sm:text-xs text-blue-100 font-bold truncate sm:whitespace-normal">
                {t.heroDesc}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 w-full md:w-auto shrink-0">
            {/* Quick Access to Request Approvals */}
            <button
              type="button"
              onClick={() => navigate('/requests')}
              className="w-full sm:w-auto min-h-[44px] px-4 sm:px-5 py-3 sm:py-3.5 bg-blue-800/80 hover:bg-blue-800 active:bg-blue-900 text-white font-extrabold rounded-xl sm:rounded-2xl border border-blue-400/30 hover:border-blue-300 shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center space-x-2 shrink-0 transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer backdrop-blur-xs"
              title={language === 'EN' ? 'Request Approvals' : 'अर्ज व विनंत्या मंजुरी'}
            >
              <FileCheck className="w-5 h-5 text-cyan-300" />
              <span className="text-sm tracking-tight font-black whitespace-nowrap">
                {language === 'EN' ? 'Request Approvals' : 'अर्ज मंजुरी'}
              </span>
              {pendingRequestsCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-black bg-rose-500 text-white rounded-full shadow-xs">
                  {pendingRequestsCount}
                </span>
              )}
            </button>

            {/* Quick Deposit button */}
            <button
              type="button"
              onClick={() => {
                setCollectCustId(undefined);
                setIsQuickCollectOpen(true);
              }}
              className="w-full sm:w-auto min-h-[44px] px-5 sm:px-6 py-3 sm:py-3.5 bg-amber-400 hover:bg-amber-500 text-[#0F172A] font-black rounded-xl sm:rounded-2xl shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center space-x-2 shrink-0 transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
            >
              <Wallet className="w-5 h-5 text-[#0F172A]" />
              <span className="text-sm tracking-tight font-black whitespace-nowrap">{t.heroButton}</span>
            </button>
          </div>
        </div>

        {/* DASHBOARD QUICK CUSTOMER SEARCH BAR */}
        <div className="bg-white p-3.5 sm:p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-3">
          <div className="relative">
            <Search className="w-5 h-5 text-[#2563EB] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
            <MarathiTextInput
              value={dashboardSearch}
              onChange={(val) => setDashboardSearch(val)}
              placeholder={language === 'EN' ? 'Search customer by Name or Account No (e.g. 101 / Suraj / 9822)...' : 'खातेदाराचे नाव किंवा खाते क्रमांक टाकून शोधा (उदा. 101, सुरज, मोबाईल)...'}
              className="w-full pl-11 pr-10 py-3 rounded-xl border border-[#E2E8F0] hover:border-[#2563EB]/60 text-sm font-extrabold text-slate-900 focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB] bg-[#F8FAFC]/50 transition-all"
            />
            {dashboardSearch && (
              <button
                type="button"
                onClick={() => setDashboardSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 z-10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Realtime Search Results Box if query entered */}
          {dashboardSearch.trim() !== '' && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="text-xs font-extrabold text-slate-600 flex justify-between items-center">
                <span>{language === 'EN' ? `Search results (${dashboardSearchResults.length} found):` : `शोध निकाल (${dashboardSearchResults.length} सापडले):`}</span>
                {dashboardSearchResults.length === 0 && (
                  <span className="text-rose-600 font-bold">{language === 'EN' ? 'No customer found.' : 'कोणताही खातेदार सापडला नाही.'}</span>
                )}
              </div>

              {dashboardSearchResults.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {dashboardSearchResults.map((cust) => (
                    <div
                      key={cust.id}
                      className="p-3 bg-white hover:bg-blue-50/60 rounded-xl border border-[#E2E8F0] hover:border-blue-300 transition-all flex items-center justify-between shadow-2xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 font-black text-xs shrink-0">
                            #{cust.accountNumber}
                          </span>
                          <span className="font-extrabold text-slate-900 text-xs truncate">{cust.name}</span>
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 mt-1 flex items-center space-x-2">
                          <span>{cust.mobile}</span>
                          <span>•</span>
                          <span className="truncate">{getBishiNameMarathi(cust.bishiType, language)}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCollectCustId(cust.id);
                            setIsQuickCollectOpen(true);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#2563EB] text-white font-extrabold text-xs hover:bg-blue-700 transition-all flex items-center space-x-1 shadow-2xs cursor-pointer"
                          title={language === 'EN' ? 'Record Collection' : 'हप्ता / जमा करा'}
                        >
                          <Wallet className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{language === 'EN' ? 'Collect' : 'जमा'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/customers/${cust.id}`)}
                          className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-bold text-xs transition-all cursor-pointer"
                          title={language === 'EN' ? 'View Customer Details' : 'खातेदार तपशील पहा'}
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filter Dropdown Bar */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
            <div className="flex items-center space-x-1.5 text-xs font-black text-[#1E3A8A] bg-[#EFF6FF] px-3 py-2 rounded-xl border border-blue-200/50 shrink-0 self-start sm:self-auto">
              <Filter className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>{language === 'EN' ? 'Filter' : 'फिल्टर'}:</span>
            </div>

            {/* Bishi Filter */}
            <div className="w-full sm:w-48">
              <CustomDropdown<string>
                value={selectedBishiFilter}
                onChange={(val) => setSelectedBishiFilter(val as any)}
                options={[
                  { value: 'ALL', label: t.allBishi },
                  ...bishiConfigs.map((cfg) => ({
                    value: cfg.id,
                    label: cfg.name,
                  })),
                ]}
                size="md"
              />
            </div>

            {/* Modality Filter */}
            <div className="w-full sm:w-40">
              <CustomDropdown<string>
                value={modalityFilter}
                onChange={(val) => setModalityFilter(val as any)}
                options={[
                  { value: 'ALL', label: t.allModalities },
                  { value: 'W', label: t.modalityWeekly },
                  { value: 'M', label: t.modalityMonthly },
                ]}
                size="md"
              />
            </div>

          </div>

          <div className="flex items-center justify-end space-x-2 shrink-0">
            <button
              onClick={async () => {
                await Promise.all([fetchStats(true), refreshAllData()]);
              }}
              disabled={isRefreshingStats || isRefreshing}
              title={language === 'EN' ? 'Refresh Dashboard (0 reads if unchanged)' : 'डॅशबोर्ड डेटा रिफ्रेश करा (बदल नसल्यास ० रीड्स)'}
              className="h-10 px-3.5 bg-white hover:bg-blue-50 text-[#2563EB] font-extrabold text-xs rounded-xl border border-[#E2E8F0] shadow-2xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-60 active:scale-95 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#2563EB] ${isRefreshingStats || isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{language === 'EN' ? 'Refresh' : 'रिफ्रेश'}</span>
            </button>
          </div>
        </div>

        {/* 8 Primary Stat Cards (Compact & Mobile-Optimized) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3.5">
          
          {/* Card 1: Total Customers */}
          <div 
            onClick={() => {
              const params = new URLSearchParams();
              if (selectedBishiFilter !== 'ALL') params.set('bishi', selectedBishiFilter);
              if (modalityFilter !== 'ALL') params.set('modality', modalityFilter);
              if (officeFilter !== 'ALL') params.set('office', officeFilter);
              const queryString = params.toString() ? `?${params.toString()}` : '';
              navigate(`/customers${queryString}`, {
                state: {
                  bishiFilter: selectedBishiFilter,
                  modalityFilter,
                  officeFilter,
                },
              });
            }}
            className="relative overflow-hidden bg-gradient-to-br from-[#b8860b] to-[#8c6705] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <button className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#b8860b] group-hover:scale-110 transition-all cursor-pointer">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">{t.statTotalCustomers}</span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {totalCustomersCount}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">{t.statTotalCustSub}</div>
            </div>
          </div>

          {/* Card 2: Today's Collection */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#2563EB] to-[#1E3A8A] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group">
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold text-xs sm:text-sm flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                ₹
              </div>
              <button
                onClick={() => {
                  setCollectCustId(undefined);
                  setIsQuickCollectOpen(true);
                }}
                className="px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/25 hover:bg-white text-white hover:text-[#2563EB] hover:scale-105 active:scale-95 text-[10px] sm:text-xs font-black transition-all shadow-2xs cursor-pointer"
              >
                <span>{t.btnCollect}</span>
              </button>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">{t.statTodayCollection}</span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {formatCurrency(todaysCollection, language)}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">{t.statTodayCollSub}</div>
            </div>
          </div>

          {/* Card 3: Today's Due / Pending */}
          <div 
            onClick={() => navigate('/collections?filter=pending')}
            className="relative overflow-hidden bg-gradient-to-br from-[#d94a4a] to-[#b33636] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="px-2 py-0.5 rounded-full bg-white text-[#b33636] font-black text-[10px] uppercase shadow-xs">
                  {language === 'EN' ? 'TO COLLECT' : 'येणे बाकी'}
                </span>
                <button 
                  onClick={(e) => { e.stopPropagation(); navigate('/collections?filter=pending'); }} 
                  className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#d94a4a] group-hover:scale-110 transition-all cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">{t.statTodayPending}</span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {formatCurrency(todaysPendingAmount, language)}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">{t.statTodayPendSub}</div>
            </div>
          </div>

          {/* Card 4: Total Bishi Collected */}
          <div 
            onClick={() => navigate('/collections')}
            className="relative overflow-hidden bg-gradient-to-br from-[#6b66cc] to-[#4e48b8] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <button onClick={(e) => { e.stopPropagation(); navigate('/collections'); }} className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#6b66cc] group-hover:scale-110 transition-all cursor-pointer">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">{t.statTotalBishiColl}</span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {formatCurrency(totalCollectedBishi, language)}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">{t.statTotalBishiSub}</div>
            </div>
          </div>

          {/* Card 5: Active Bishi Schemes */}
          <div 
            onClick={() => navigate('/bishi')}
            className="relative overflow-hidden bg-gradient-to-br from-[#059669] to-[#047857] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <button onClick={(e) => { e.stopPropagation(); navigate('/bishi'); }} className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#059669] group-hover:scale-110 transition-all cursor-pointer">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">
                {language === 'EN' ? 'Active Schemes' : 'सक्रिय भिशी योजना'}
              </span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {bishiConfigs.length}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">
                {language === 'EN' ? 'Bhishi Schemes' : 'सर्व उपलब्ध योजना'}
              </div>
            </div>
          </div>

          {/* Card 6: Member Requests */}
          <div 
            onClick={() => navigate('/requests')}
            className="relative overflow-hidden bg-gradient-to-br from-[#d97706] to-[#b45309] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <FileCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="px-2 py-0.5 rounded-full bg-amber-200 text-[#b45309] font-black text-[10px] uppercase shadow-xs">
                  {language === 'EN' ? 'PENDING' : 'प्रलंबित'}
                </span>
                <button onClick={(e) => { e.stopPropagation(); navigate('/requests'); }} className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#d97706] group-hover:scale-110 transition-all cursor-pointer">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">
                {language === 'EN' ? 'Member Requests' : 'नवीन सदस्य अर्ज'}
              </span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {pendingRequestsCount}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">
                {language === 'EN' ? 'Pending Approval' : 'मंजुरीसाठी प्रलंबित'}
              </div>
            </div>
          </div>

          {/* Card 7: Pending Installments */}
          <div 
            onClick={() => navigate('/collections')}
            className="relative overflow-hidden bg-gradient-to-br from-[#4b50b8] to-[#35398d] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <Percent className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <button onClick={(e) => { e.stopPropagation(); navigate('/collections'); }} className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#4b50b8] group-hover:scale-110 transition-all cursor-pointer">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">{t.statTodayPendInstallments}</span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {todaysPendingInstallmentsCount}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">{t.statTodayInstSub}</div>
            </div>
          </div>

          {/* Card 8: Referral Program */}
          <div 
            onClick={() => navigate('/referrals')}
            className="relative overflow-hidden bg-gradient-to-br from-[#7c3aed] to-[#6d28d9] p-3 sm:p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 group cursor-pointer"
          >
            <div className="absolute -top-3 -right-3 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 pointer-events-none group-hover:scale-125 transition-transform duration-300" />
            <div className="flex items-center justify-between relative z-10">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-bold flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="px-2 py-0.5 rounded-full bg-purple-200 text-[#6d28d9] font-black text-[10px] uppercase shadow-xs">
                  {language === 'EN' ? '10% COMM.' : '१०% कमिशन'}
                </span>
                <button onClick={(e) => { e.stopPropagation(); navigate('/referrals'); }} className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-black group-hover:bg-white group-hover:text-[#7c3aed] group-hover:scale-110 transition-all cursor-pointer">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 sm:mt-2.5 relative z-10">
              <span className="text-[11px] sm:text-xs font-bold text-white/90 truncate block">
                {language === 'EN' ? 'Referral Program' : 'रेफरल कार्यक्रम'}
              </span>
              <div className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
                {referrals.length}
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/75 font-medium truncate block mt-0.5">
                {language === 'EN' ? '10% Commission' : '१०% कमिशन व सवलत'}
              </div>
            </div>
          </div>

        </div>

        {/* Section: Reference & Referral Tracker (कोण कोणाच्या रेफरन्सने आले आणि १०% हप्ता १ सवलत) */}
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl border border-[#E2E8F0] shadow-xs overflow-hidden flex flex-col justify-between">
          <div className="p-3.5 sm:p-6 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                <Share2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <span>{language === 'EN' ? 'Referral & References Tracker' : 'रेफरन्स ट्रॅकर (References)'}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                    १०% हप्ता १ सवलत
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {language === 'EN'
                    ? 'Track who joined via whose referral & first installment 10% discount'
                    : 'कोण कोणाच्या रेफरन्सने आले आणि पहिल्या हप्त्यावर मिळालेली १०% सवलत'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center space-x-1 px-3 py-1 bg-emerald-50 text-emerald-800 text-xs font-black rounded-full border border-emerald-200">
                <span>{referredConnections.length} रेफरल्स</span>
              </span>
              <Link
                to="/referrals"
                className="inline-flex items-center space-x-1 px-3 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-900 text-xs font-black rounded-xl border border-brand-200 transition-colors cursor-pointer"
              >
                <span>{language === 'EN' ? 'View All' : 'सर्व रेफरल्स'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {referredConnections.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center space-y-2">
              <div className="w-12 h-12 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center">
                <Share2 className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-600">
                {language === 'EN' ? 'No referred members recorded yet.' : 'अद्याप कोणत्याही रेफरल सदस्याची नोंद नाही.'}
              </p>
              <p className="text-[11px] text-slate-400 max-w-sm">
                {language === 'EN'
                  ? 'When members share their referral code in the app, new members get 10% off their first installment and referrer earns 10% commission.'
                  : 'सभासदांनी ॲपमधून रेफरल कोड शेअर केल्यावर नवीन सभासदांना पहिल्या हप्त्यावर १०% सूट मिळते व रेफरल करणाऱ्याला १०% कमिशन मिळते.'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card View (< md) */}
              <div className="block md:hidden space-y-3 p-3 bg-slate-50/50">
                {referredConnections.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div>
                        <div className="font-extrabold text-slate-900 text-sm">{item.referredName}</div>
                        <div className="text-[11px] text-slate-500 font-semibold">{item.referredMobile}</div>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                        item.firstInstallmentStatus === 'PAID'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {item.firstInstallmentStatus === 'PAID' ? 'हप्ता १ भरला ✅' : 'हप्ता १ बाकी ⏳'}
                      </span>
                    </div>

                    <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-bold">कोणाचा रेफरन्स:</span>
                        <span className="font-black text-emerald-900">
                          👤 {item.referrerName} ({item.referrerMobile})
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-bold">१ला हप्ता (१०% सूट):</span>
                        <span className="font-black text-slate-900">
                          ₹{item.discountedAmount} <span className="text-[10px] text-emerald-700 font-bold">(-₹{item.discountAmount})</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-bold">१०% कमिशन:</span>
                        <span className="font-black text-emerald-700">
                          {item.commissionStatus === 'CREDITED' ? `₹${item.commissionAmount} जमा ✅` : `₹${item.commissionAmount} प्रतीक्षा ⏳`}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View (>= md) */}
              <div className="hidden md:block overflow-x-auto p-4">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-[#F8FAFC] text-[#0F172A] font-extrabold border-b border-[#E2E8F0]">
                    <tr>
                      <th className="p-3 pl-4">नवीन आलेला सदस्य (Referred User)</th>
                      <th className="p-3">कोणाचा रेफरन्स (Referred By)</th>
                      <th className="p-3 text-right">मूळ हप्ता रक्कम</th>
                      <th className="p-3 text-right">१ला हप्ता (१०% सूट)</th>
                      <th className="p-3 text-center">१ला हप्ता स्थिती</th>
                      <th className="p-3 text-center">१०% कमिशन स्थिती</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] font-medium">
                    {referredConnections.map((item) => (
                      <tr key={item.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-3 pl-4">
                          <div className="font-extrabold text-slate-900">{item.referredName}</div>
                          <div className="text-[11px] text-slate-500 font-semibold">
                            {item.referredMobile} {item.accountNumber ? `• खाते क्र. ${item.accountNumber}` : '• नवीन अर्ज'}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200 font-bold text-xs">
                            <span>👤 {item.referrerName}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-semibold mt-0.5">
                            {item.referrerMobile} {item.referrerCode ? `• कोड: ${item.referrerCode}` : ''}
                          </div>
                        </td>
                        <td className="p-3 text-right font-bold text-slate-600">
                          ₹{item.originalAmount}
                        </td>
                        <td className="p-3 text-right font-extrabold text-slate-900">
                          <div>₹{item.discountedAmount}</div>
                          <div className="text-[10px] text-emerald-700 font-black">
                            -₹{item.discountAmount} (१०% सूट)
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black ${
                            item.firstInstallmentStatus === 'PAID'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {item.firstInstallmentStatus === 'PAID' ? 'भरला ✅' : 'प्रलंबित ⏳'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black ${
                            item.commissionStatus === 'CREDITED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {item.commissionStatus === 'CREDITED' ? `₹${item.commissionAmount} जमा ✅` : `₹${item.commissionAmount} प्रतीक्षा ⏳`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Bottom Section: Daily Pending Box */}
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl border border-[#E2E8F0] shadow-xs overflow-hidden flex flex-col justify-between">
          <div className="p-3.5 sm:p-6 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-[#C4525B]/10 text-[#C4525B] flex items-center justify-center font-bold">
                <Clock className="w-4 h-4" />
              </div>
              <h3 className="text-base font-black text-[#10241E]">
                {t.todayPendingTitle} <span className="text-xs font-bold text-[#5F6E68]">{t.todayPendingSub}</span>
              </h3>
            </div>

            <span className="inline-flex items-center space-x-1 px-3 py-1 bg-[#C4525B]/10 text-[#C4525B] text-xs font-extrabold rounded-full border border-[#C4525B]/20">
              <span>{todaysPendingList.length} {t.pendingCountSuffix}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>

          {todaysPendingList.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-[#F8FAFC] text-[#2563EB] flex items-center justify-center">
                <FileText className="w-7 h-7" />
              </div>
              <p className="text-xs font-bold text-[#64748B]">
                {t.noPendingText}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card View (< md screens) */}
              <div className="block md:hidden space-y-3 p-3 bg-slate-50/50">
                {todaysPendingList.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 text-xs font-black">
                          {item.accountNumber || item.accountNo || '-'}
                        </span>
                        <span className="font-bold text-slate-900 text-xs truncate">
                          {item.customerName || 'Customer'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="inline-block px-2.5 py-0.5 rounded-lg bg-rose-100 text-rose-900 border border-rose-300 text-xs font-black shadow-2xs">
                          {language === 'EN' ? 'Due to Pay: ' : 'येणे बाकी: '}{formatCurrency(item.amount, language)}
                        </span>
                        {item.dueDate < todayStr && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black animate-pulse">
                            {language === 'EN' ? 'Overdue' : 'थकीत'} ({formatDateMarathi(item.dueDate, language)})
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setCollectCustId(item.customerId);
                        setIsQuickCollectOpen(true);
                      }}
                      className="px-3.5 py-2 min-h-[44px] bg-[#2563EB] hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold transition-colors shadow-xs shrink-0 cursor-pointer touch-target flex items-center justify-center"
                    >
                      {t.btnCollect}
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop Table View (>= md screens) */}
              <div className="hidden md:block overflow-x-auto p-4">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-[#F8FAFC] text-[#0F172A] font-extrabold border-b border-[#E2E8F0]">
                    <tr>
                      <th className="p-3 pl-4">{t.colAccountNo}</th>
                      <th className="p-3">{t.colCustomerName}</th>
                      <th className="p-3">{t.colDueDate}</th>
                      <th className="p-3 text-right">{t.colRemaining}</th>
                      <th className="p-3 text-center">{t.colActions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] font-medium">
                    {todaysPendingList.map((item) => (
                      <tr key={item.id} className="hover:bg-[#F8FAFC]">
                        <td className="p-3 pl-4 font-bold">{item.accountNumber || item.accountNo || '-'}</td>
                        <td className="p-3 font-bold">{item.customerName || 'Customer'}</td>
                        <td className="p-3 font-semibold text-slate-700">
                          <span>{formatDateMarathi(item.dueDate, language)}</span>
                          {item.dueDate < todayStr && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">
                              {language === 'EN' ? 'Overdue' : 'थकीत'}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-extrabold">
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 border border-rose-300 font-black shadow-2xs">
                            {formatCurrency(item.amount, language)}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => {
                              setCollectCustId(item.customerId);
                              setIsQuickCollectOpen(true);
                            }}
                            className="px-3 py-1 bg-[#2563EB] hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                          >
                            {t.btnCollect}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

      </div>

      {/* Page Bottom Copyright & Trust Footer */}
      <div className="pt-6 border-t border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between text-xs font-bold text-[#64748B] gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-[#0F172A] font-black">{t.appName}</span>
          <span>|</span>
          <span className="text-[#64748B] font-semibold">{t.tagline}</span>
        </div>
        <div className="flex items-center space-x-1.5 text-[#2563EB] font-extrabold">
          <ShieldCheck className="w-4 h-4" />
          <span>{t.secureSystem}</span>
        </div>
      </div>

      {/* Quick Collection Modal */}
      <QuickCollectionModal
        isOpen={isQuickCollectOpen}
        onClose={() => setIsQuickCollectOpen(false)}
        initialCustomerId={collectCustId}
      />
    </div>
  );
};

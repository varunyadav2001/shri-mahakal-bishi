import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Customer, Payout, BishiType } from '../../types';
import { StorageService } from '../../services/db';
import { formatCurrency, formatDateMarathi } from '../../utils/formatters';
import { MarathiTextInput } from '../../components/common/MarathiTextInput';
import { CustomDropdown } from '../../components/common/CustomDropdown';
import { ModalPortal } from '../../components/common/ModalPortal';
import {
  Gift,
  CheckCircle2,
  Clock,
  Wallet,
  ArrowUpRight,
  Search,
  Filter,
  Printer,
  Calendar,
  AlertCircle,
  FileCheck,
  Building2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

export const PayoutManager: React.FC = () => {
  const {
    customers,
    bishiConfigs,
    collections,
    loans,
    payouts,
    language,
    showToast,
    refreshData,
    isRefreshing,
    refreshAllData,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'ELIGIBLE' | 'HISTORY'>('ELIGIBLE');
  const [searchTerm, setSearchTerm] = useState('');
  const [bishiFilter, setBishiFilter] = useState<'ALL' | BishiType>('ALL');

  // Disburse Payout Modal state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDisburseModalOpen, setIsDisburseModalOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'BANK' | 'UPI'>('BANK');
  const [referenceNo, setReferenceNo] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().split('T')[0]);

  // View Receipt Modal state
  const [receiptPayout, setReceiptPayout] = useState<Payout | null>(null);

  // 1. Calculate Eligibility & 20% Return for each customer
  const customerEligibilityList = useMemo(() => {
    return customers.map((c) => {
      // Find matching collections
      const custColls = collections.filter(
        (coll) => coll.customerId === c.id || coll.accountNumber === c.accountNumber
      );
      const totalDeposit = custColls.reduce((sum, coll) => sum + (Number(coll.collectedAmount) || 0), 0);
      const paidInstallments = custColls.filter((coll) => coll.status === 'PAID').length;
      const targetInstallments = Number(c.totalInstallments) || (c.modality === 'W' ? 40 : 10);

      // Standard 20% Return Calculation as specified in Proposal
      const returnPercentage = 20;
      const returnAmount = Math.round((totalDeposit * returnPercentage) / 100);

      // Check active loan deductions if any
      const custLoans = loans.filter((l) => l.customerId === c.id || l.accountNumber === c.accountNumber);
      const activeLoan = custLoans.find((l) => l.status === 'ACTIVE');
      const loanDeduction = activeLoan ? Math.max(0, Number(activeLoan.remainingAmount) || 0) : 0;

      const netPayout = Math.max(0, totalDeposit + returnAmount - loanDeduction);

      // Check if already paid out in payouts collection
      const existingPayout = payouts.find((p) => p.customerId === c.id && p.status === 'PAID');
      const isMatured = paidInstallments >= targetInstallments || c.status === 'COMPLETED';

      return {
        customer: c,
        totalDeposit,
        paidInstallments,
        targetInstallments,
        returnPercentage,
        returnAmount,
        loanDeduction,
        netPayout,
        isMatured,
        existingPayout,
      };
    });
  }, [customers, collections, loans, payouts]);

  // Filtered lists
  const filteredEligible = useMemo(() => {
    return customerEligibilityList.filter((item) => {
      const matchSearch =
        item.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.customer.accountNumber.includes(searchTerm) ||
        item.customer.mobile.includes(searchTerm);
      const matchBishi = bishiFilter === 'ALL' || item.customer.bishiType === bishiFilter;
      return matchSearch && matchBishi && !item.existingPayout;
    });
  }, [customerEligibilityList, searchTerm, bishiFilter]);

  const filteredHistory = useMemo(() => {
    return payouts.filter((p) => {
      const matchSearch =
        p.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.accountNumber.includes(searchTerm) ||
        p.mobile.includes(searchTerm);
      const matchBishi = bishiFilter === 'ALL' || p.bishiType === bishiFilter;
      return matchSearch && matchBishi;
    });
  }, [payouts, searchTerm, bishiFilter]);

  // Aggregate Stats
  const totalMaturedCount = customerEligibilityList.filter((i) => i.isMatured && !i.existingPayout).length;
  const totalReturnBonusGenerated = payouts.reduce((sum, p) => sum + (Number(p.returnAmount) || 0), 0);
  const totalDisbursedAmount = payouts.reduce((sum, p) => sum + (Number(p.netPayoutAmount) || 0), 0);
  const pendingPayoutsAmount = customerEligibilityList
    .filter((i) => i.isMatured && !i.existingPayout)
    .reduce((sum, i) => sum + i.netPayout, 0);

  const handleOpenDisburse = (cust: Customer) => {
    setSelectedCustomer(cust);
    setPaymentMode('BANK');
    setReferenceNo('');
    setPayoutNotes('');
    setPayoutDate(new Date().toISOString().split('T')[0]);
    setIsDisburseModalOpen(true);
  };

  const handleConfirmDisburse = async () => {
    if (!selectedCustomer) return;

    const item = customerEligibilityList.find((i) => i.customer.id === selectedCustomer.id);
    if (!item) return;

    try {
      const newPayout: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'> = {
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        accountNumber: selectedCustomer.accountNumber,
        mobile: selectedCustomer.mobile,
        bishiType: selectedCustomer.bishiType,
        bishiName: selectedCustomer.bishiName || selectedCustomer.bishiType,
        totalInstallmentsPaid: item.paidInstallments,
        totalPrincipalCollected: item.totalDeposit,
        returnPercentage: 20,
        returnAmount: item.returnAmount,
        netPayoutAmount: item.netPayout,
        deductions: item.loanDeduction,
        status: 'PAID',
        maturityDate: new Date().toISOString().split('T')[0],
        payoutDate,
        paymentMode,
        referenceNo: referenceNo.trim() || undefined,
        notes: payoutNotes.trim() || undefined,
      };

      StorageService.savePayout(newPayout);

      // Mark customer status as COMPLETED
      StorageService.updateCustomer(selectedCustomer.id, {
        status: 'COMPLETED',
      });

      refreshData();
      setIsDisburseModalOpen(false);
      showToast(
        language === 'EN'
          ? `Payout of ₹${item.netPayout} recorded successfully!`
          : `₹${item.netPayout} चा २०% परतावा पेआउट यशस्वीपणे नोंदवला गेला!`,
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Error recording payout', 'error');
    }
  };

  const selectedItem = selectedCustomer
    ? customerEligibilityList.find((i) => i.customer.id === selectedCustomer.id)
    : null;

  return (
    <div className="space-y-6 pb-16">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Gift className="w-6 h-6 text-brand-700" />
            <span>{language === 'EN' ? 'Maturity Payouts (20% Return)' : 'मॅच्युरिटी पेआउट्स (२०% परतावा)'}</span>
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {language === 'EN'
              ? 'Manage completed bishi maturity settlements with official 20% member return'
              : 'भिशी पूर्ण झालेल्या खातेदारांना २०% परताव्यासह अंतिम रक्कम वाटप व्यवस्थापन'}
          </p>
        </div>

        <button
          onClick={() => refreshAllData()}
          disabled={isRefreshing}
          className="h-10 px-3.5 bg-white hover:bg-blue-50 text-[#2563EB] font-extrabold text-xs rounded-xl border border-[#E2E8F0] shadow-2xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-60 active:scale-95 transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#2563EB] ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{language === 'EN' ? 'Refresh' : 'रिफ्रेश'}</span>
        </button>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Eligible Matured */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? 'Matured Schemes' : 'पूर्ण झालेल्या भिशी'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">{totalMaturedCount}</div>
          <p className="text-[11px] text-amber-700 font-bold mt-1">
            {language === 'EN' ? 'Ready for 20% return disbursement' : '२०% परतावा देण्यासाठी पात्र खातेदार'}
          </p>
        </div>

        {/* Card 2: Total 20% Return Bonus Paid */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? '20% Returns Paid' : 'दिलेला २०% परतावा'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Gift className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600">
            {formatCurrency(totalReturnBonusGenerated, language)}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {language === 'EN' ? 'Total bonus return to members' : 'खातेदारांना मिळालेला एकूण बोनस लाभांश'}
          </p>
        </div>

        {/* Card 3: Total Disbursed */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? 'Total Payouts Settled' : 'एकूण वाटप झालेले पेआउट्स'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-700">
            {formatCurrency(totalDisbursedAmount, language)}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {payouts.length} {language === 'EN' ? 'settlements completed' : 'पेआउट्स पूर्ण झाले'}
          </p>
        </div>

        {/* Card 4: Pending Payouts */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? 'Pending Disbursal' : 'देणे बाकी पेआउट्स'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-rose-600">
            {formatCurrency(pendingPayoutsAmount, language)}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {language === 'EN' ? 'Awaiting finance approval' : 'मंजुरी व वाटपाची प्रतीक्षा'}
          </p>
        </div>
      </div>

      {/* Tabs & Search Filter */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          {/* Tab buttons */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('ELIGIBLE')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
                activeTab === 'ELIGIBLE'
                  ? 'bg-white text-brand-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'EN' ? 'Eligible Members' : 'पात्र खातेदार (Pending)'} ({totalMaturedCount})
            </button>
            <button
              onClick={() => setActiveTab('HISTORY')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
                activeTab === 'HISTORY'
                  ? 'bg-white text-brand-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'EN' ? 'Payout History' : 'पेआउट इतिहास (Settled)'} ({payouts.length})
            </button>
          </div>

          {/* Search bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={language === 'EN' ? 'Search by name or account...' : 'नाव किंवा खाते क्र. शोधा...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <select
              value={bishiFilter}
              onChange={(e) => setBishiFilter(e.target.value as any)}
              className="py-2 px-3 text-xs rounded-xl border border-slate-200 bg-white font-bold text-slate-700"
            >
              <option value="ALL">{language === 'EN' ? 'All Schemes' : 'सर्व योजना'}</option>
              {bishiConfigs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab 1: Eligible Members Table */}
        {activeTab === 'ELIGIBLE' && (
          <div className="overflow-x-auto">
            {filteredEligible.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">
                {language === 'EN'
                  ? 'No members matching search criteria or eligible for payout.'
                  : 'कोणतेही खातेदार पेआउटसाठी पात्र किंवा उपलब्ध नाहीत.'}
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase tracking-wider">
                    <th className="py-3 px-3">खाते क्र.</th>
                    <th className="py-3 px-3">खातेदाराचे नाव</th>
                    <th className="py-3 px-3">भिशी योजना</th>
                    <th className="py-3 px-3 text-center">हप्ते प्रगती</th>
                    <th className="py-3 px-3 text-right">जमा भिशी</th>
                    <th className="py-3 px-3 text-right text-emerald-700">+२०% परतावा</th>
                    <th className="py-3 px-3 text-right">कर्ज वजावट</th>
                    <th className="py-3 px-3 text-right text-brand-900 font-black">अंतिम देय रक्कम</th>
                    <th className="py-3 px-3 text-center">कृती</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEligible.map((item) => (
                    <tr
                      key={item.customer.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        item.isMatured ? 'bg-emerald-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">
                        #{item.customer.accountNumber}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-extrabold text-slate-900">{item.customer.name}</div>
                        <div className="text-[10px] text-slate-400 font-bold">{item.customer.mobile}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-700">
                          {item.customer.bishiName || item.customer.bishiType}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            item.isMatured
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.paidInstallments} / {item.targetInstallments}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800">
                        {formatCurrency(item.totalDeposit, language)}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-600">
                        +{formatCurrency(item.returnAmount, language)}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-rose-600">
                        {item.loanDeduction > 0 ? `-${formatCurrency(item.loanDeduction, language)}` : '₹०'}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-brand-900 text-sm">
                        {formatCurrency(item.netPayout, language)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => handleOpenDisburse(item.customer)}
                          disabled={!item.isMatured && item.totalDeposit === 0}
                          className="px-3 py-1.5 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
                        >
                          {language === 'EN' ? 'Disburse Payout' : 'पेआउट द्या'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 2: Payout History Table */}
        {activeTab === 'HISTORY' && (
          <div className="overflow-x-auto">
            {filteredHistory.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">
                {language === 'EN' ? 'No payout history recorded yet.' : 'अद्याप कोणताही पेआउट इतिहास नोंदवलेला नाही.'}
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase tracking-wider">
                    <th className="py-3 px-3">तारीख</th>
                    <th className="py-3 px-3">खाते क्र.</th>
                    <th className="py-3 px-3">नाव</th>
                    <th className="py-3 px-3">योजना</th>
                    <th className="py-3 px-3 text-right">जमा रक्कम</th>
                    <th className="py-3 px-3 text-right text-emerald-700">+२०% परतावा</th>
                    <th className="py-3 px-3 text-right font-black text-brand-900">एकूण दिलेली रक्कम</th>
                    <th className="py-3 px-3 text-center">पेमेंट मोड</th>
                    <th className="py-3 px-3 text-center">पावती</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredHistory.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 font-mono text-slate-600">
                        {p.payoutDate || p.createdAt?.split('T')[0]}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">#{p.accountNumber}</td>
                      <td className="py-3 px-3">
                        <div className="font-extrabold text-slate-900">{p.customerName}</div>
                        <div className="text-[10px] text-slate-400">{p.mobile}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-700 font-medium">{p.bishiName || p.bishiType}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-700">
                        {formatCurrency(p.totalPrincipalCollected, language)}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-600">
                        +{formatCurrency(p.returnAmount, language)}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-800 text-sm">
                        {formatCurrency(p.netPayoutAmount, language)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                          {p.paymentMode || 'BANK'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => setReceiptPayout(p)}
                          className="p-1.5 hover:bg-slate-100 text-brand-700 rounded-lg transition-colors cursor-pointer"
                          title="पावती पहा"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Disburse Payout Modal */}
      {isDisburseModalOpen && selectedCustomer && selectedItem && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 border border-slate-200 shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Gift className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {language === 'EN' ? 'Disburse 20% Maturity Payout' : '२०% मॅच्युरिटी परतावा वाटप'}
                  </h3>
                </div>
                <button
                  onClick={() => setIsDisburseModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Customer Summary Card */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-bold">खातेदार:</span>
                  <span className="font-extrabold text-slate-900">
                    {selectedCustomer.name} (#{selectedCustomer.accountNumber})
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-bold">योजना:</span>
                  <span className="font-bold text-slate-800">
                    {selectedCustomer.bishiName || selectedCustomer.bishiType}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-bold">एकूण जमा भिशी:</span>
                  <span className="font-bold text-slate-900">
                    {formatCurrency(selectedItem.totalDeposit, language)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-emerald-700 font-bold">अधिकृत २०% परतावा लाभांश:</span>
                  <span className="font-black text-emerald-700">
                    +{formatCurrency(selectedItem.returnAmount, language)}
                  </span>
                </div>
                {selectedItem.loanDeduction > 0 && (
                  <div className="flex justify-between items-center text-xs text-rose-600">
                    <span className="font-bold">सुरू कर्ज वजावट:</span>
                    <span className="font-black">-{formatCurrency(selectedItem.loanDeduction, language)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-200">
                  <span className="text-slate-900 font-extrabold">अंतिम देय पेआउट रक्कम:</span>
                  <span className="font-black text-brand-900 text-lg">
                    {formatCurrency(selectedItem.netPayout, language)}
                  </span>
                </div>
              </div>

              {/* Payment Details Form */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">पेआउट तारीख</label>
                    <input
                      type="date"
                      value={payoutDate}
                      onChange={(e) => setPayoutDate(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">पेमेंट मोड</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as any)}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-white font-bold"
                    >
                      <option value="BANK">बँक ट्रान्सफर (NEFT/RTGS)</option>
                      <option value="UPI">UPI / GPay / PhonePe</option>
                      <option value="CASH">रोख (Cash)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    रेफरन्स क्र. / UTR No. (पर्यायी)
                  </label>
                  <input
                    type="text"
                    placeholder="उदा. UTR12345678"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">शेरा (Notes)</label>
                  <input
                    type="text"
                    placeholder="उदा. भिशी पूर्ण झाल्याबद्दल अंतिम २०% परतावा अदा केला."
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDisburseModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDisburse}
                  className="flex-1 py-2.5 bg-[#2563EB] hover:bg-[#1E3A8A] text-white text-xs font-black rounded-xl shadow-md cursor-pointer transition-all"
                >
                  पेआउट जमा करा
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Payout Receipt Print Modal */}
      {receiptPayout && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-fade-in print:shadow-none print:border-none">
              <div className="text-center pb-3 border-b border-slate-200">
                <h2 className="text-base font-extrabold text-[#1E3A8A]">श्री महाकाल फायनान्स</h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  भिशी समाप्ती व २०% अंतिम परतावा पावती
                </p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">पावती क्र.:</span>
                  <span className="font-mono font-bold text-slate-900">{receiptPayout.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">तारीख:</span>
                  <span className="font-medium text-slate-800">{receiptPayout.payoutDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">खातेदार:</span>
                  <span className="font-extrabold text-slate-900">
                    {receiptPayout.customerName} (#{receiptPayout.accountNumber})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">मोबाईल:</span>
                  <span className="font-medium text-slate-800">{receiptPayout.mobile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">भिशी योजना:</span>
                  <span className="font-bold text-slate-800">{receiptPayout.bishiName}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 space-y-1">
                  <div className="flex justify-between">
                    <span>एकूण जमा मुद्दल:</span>
                    <span className="font-bold">
                      {formatCurrency(receiptPayout.totalPrincipalCollected, language)}
                    </span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>+२०% परतावा बोनस:</span>
                    <span>+{formatCurrency(receiptPayout.returnAmount, language)}</span>
                  </div>
                  {receiptPayout.deductions && receiptPayout.deductions > 0 ? (
                    <div className="flex justify-between text-rose-600">
                      <span>कर्ज वजावट:</span>
                      <span>-{formatCurrency(receiptPayout.deductions, language)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-sm font-black text-brand-900 pt-1 border-t border-dashed border-slate-300">
                    <span>अंतिम मिळालेली रक्कम:</span>
                    <span>{formatCurrency(receiptPayout.netPayoutAmount, language)}</span>
                  </div>
                </div>

                <div className="pt-2 text-[10px] text-slate-500">
                  <div>पेमेंट मोड: <span className="font-bold text-slate-800">{receiptPayout.paymentMode}</span></div>
                  {receiptPayout.referenceNo && (
                    <div>रेफरन्स क्र.: <span className="font-mono text-slate-800">{receiptPayout.referenceNo}</span></div>
                  )}
                </div>
              </div>

              <div className="pt-4 flex justify-between gap-3 no-print">
                <button
                  onClick={() => setReceiptPayout(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  बंद करा
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 py-2 bg-[#2563EB] hover:bg-[#1E3A8A] text-white text-xs font-black rounded-xl shadow-xs flex items-center justify-center space-x-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>प्रिंट करा</span>
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Referral, Customer } from '../../types';
import { StorageService } from '../../services/db';
import { formatCurrency, formatDateMarathi } from '../../utils/formatters';
import { ModalPortal } from '../../components/common/ModalPortal';
import {
  Share2,
  Users,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  DollarSign,
  Printer,
  Sparkles,
  ArrowRight,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';

export const ReferralManager: React.FC = () => {
  const {
    customers,
    collections,
    referrals,
    language,
    showToast,
    refreshData,
    isRefreshing,
    refreshAllData,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'EARNED' | 'PAID' | 'PENDING'>('ALL');

  // Add Referral Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedReferrerId, setSelectedReferrerId] = useState('');
  const [selectedReferredId, setSelectedReferredId] = useState('');
  const [customFirstAmount, setCustomFirstAmount] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  // Pay Commission Modal state
  const [selectedRefToPay, setSelectedRefToPay] = useState<Referral | null>(null);
  const [payMode, setPayMode] = useState<'CASH' | 'UPI' | 'BANK'>('UPI');
  const [payRefNo, setPayRefNo] = useState('');

  // Receipt Modal state
  const [receiptRef, setReceiptRef] = useState<Referral | null>(null);

  // Compute stats
  const totalReferrals = referrals.length;
  const uniqueReferrers = new Set(referrals.map((r) => r.referrerCustomerId)).size;
  const totalCommissionGenerated = referrals.reduce((sum, r) => sum + (Number(r.commissionAmount) || 0), 0);
  const totalCommissionPaid = referrals
    .filter((r) => r.status === 'COMMISSION_PAID')
    .reduce((sum, r) => sum + (Number(r.commissionAmount) || 0), 0);
  const pendingCommission = referrals
    .filter((r) => r.status === 'COMMISSION_EARNED')
    .reduce((sum, r) => sum + (Number(r.commissionAmount) || 0), 0);

  // Auto-detect first installment for selected referred customer
  const detectedFirstInstallment = useMemo(() => {
    if (!selectedReferredId) return 0;
    const cust = customers.find((c) => c.id === selectedReferredId);
    if (!cust) return 0;

    const custColls = collections.filter(
      (c) => c.customerId === cust.id || c.accountNumber === cust.accountNumber
    );
    if (custColls.length > 0) {
      const first = custColls.sort((a, b) => (a.periodIndex || 0) - (b.periodIndex || 0))[0];
      return Number(first.collectedAmount) || Number(first.expectedAmount) || cust.amount || 0;
    }
    return cust.amount || 0;
  }, [selectedReferredId, customers, collections]);

  const effectiveFirstAmount = customFirstAmount !== '' ? Number(customFirstAmount) : detectedFirstInstallment;
  const calculated10PercentCommission = Math.round((effectiveFirstAmount * 10) / 100);

  // Filtered referrals list
  const filteredReferrals = useMemo(() => {
    return referrals.filter((r) => {
      const matchSearch =
        r.referrerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.referredCustomerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.referrerMobile.includes(searchTerm) ||
        r.referredCustomerMobile.includes(searchTerm);

      let matchStatus = true;
      if (statusFilter === 'EARNED') matchStatus = r.status === 'COMMISSION_EARNED';
      if (statusFilter === 'PAID') matchStatus = r.status === 'COMMISSION_PAID';
      if (statusFilter === 'PENDING') matchStatus = r.status === 'PENDING_FIRST_PAYMENT';

      return matchSearch && matchStatus;
    });
  }, [referrals, searchTerm, statusFilter]);

  const handleCreateReferral = () => {
    const referrer = customers.find((c) => c.id === selectedReferrerId);
    const referred = customers.find((c) => c.id === selectedReferredId);

    if (!referrer || !referred) {
      showToast('कृपया रेफर करणारा आणि नवीन खातेदार दोघेही निवडा.', 'error');
      return;
    }

    if (referrer.id === referred.id) {
      showToast('खातेदार स्वतःला रेफर करू शकत नाही.', 'error');
      return;
    }

    const firstAmount = effectiveFirstAmount;
    if (firstAmount <= 0) {
      showToast('पहिल्या हप्त्याची रक्कम ० पेक्षा जास्त असावी.', 'error');
      return;
    }

    // Check if referred member already has a collection payment
    const hasPaidFirst = collections.some(
      (c) => (c.customerId === referred.id || c.accountNumber === referred.accountNumber) && (Number(c.collectedAmount) || 0) > 0
    );

    const newRef: Omit<Referral, 'id' | 'createdAt' | 'updatedAt'> = {
      referrerCustomerId: referrer.id,
      referrerName: referrer.name,
      referrerMobile: referrer.mobile,
      referrerAccountNumber: referrer.accountNumber,
      referredCustomerId: referred.id,
      referredCustomerName: referred.name,
      referredCustomerMobile: referred.mobile,
      referredAccountNumber: referred.accountNumber,
      referralCode: `REF-${referrer.accountNumber}`,
      firstInstallmentAmount: firstAmount,
      commissionPercentage: 10,
      commissionAmount: calculated10PercentCommission,
      status: hasPaidFirst ? 'COMMISSION_EARNED' : 'PENDING_FIRST_PAYMENT',
      earnedAt: hasPaidFirst ? new Date().toISOString() : undefined,
      notes: notes.trim() || undefined,
    };

    StorageService.saveReferral(newRef);
    refreshData();
    setIsAddModalOpen(false);
    setSelectedReferrerId('');
    setSelectedReferredId('');
    setCustomFirstAmount('');
    setNotes('');

    showToast('रेफरल यशस्वीपणे जोडले गेले! १०% कमिशन नोंदवले गेले.', 'success');
  };

  const handlePayCommission = () => {
    if (!selectedRefToPay) return;

    StorageService.updateReferral(selectedRefToPay.id, {
      status: 'COMMISSION_PAID',
      paidAt: new Date().toISOString(),
      paymentMode: payMode,
      referenceNo: payRefNo.trim() || undefined,
    });

    refreshData();
    setSelectedRefToPay(null);
    setPayRefNo('');
    showToast('१०% कमिशन यशस्वीपणे अदा केले गेले!', 'success');
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Share2 className="w-6 h-6 text-brand-700" />
            <span>{language === 'EN' ? 'Referral Program (10% Commission)' : 'रेफरल प्रोग्राम (१०% कमिशन)'}</span>
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {language === 'EN'
              ? 'Track referral chains and automatic 10% commission on the referred member’s first installment'
              : 'रेफरल चेन्स आणि नवीन सदस्याच्या पहिल्या हप्त्यावरील १०% कमिशन ट्रॅकिंग'}
          </p>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          <button
            onClick={() => refreshAllData()}
            disabled={isRefreshing}
            className="h-10 px-3.5 bg-white hover:bg-blue-50 text-[#2563EB] font-extrabold text-xs rounded-xl border border-[#E2E8F0] shadow-2xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-60 active:scale-95 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#2563EB] ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>रिफ्रेश</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="h-10 px-4 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-black text-xs rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{language === 'EN' ? 'Link New Referral' : 'नवीन रेफरल जोडा'}</span>
          </button>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? 'Total Referrals' : 'एकूण जोडलेले रेफरल्स'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">{totalReferrals}</div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {uniqueReferrers} {language === 'EN' ? 'active referrers' : 'सक्रिय खातेदार रेफरर्स'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? '10% Commission Total' : 'एकूण १०% कमिशन रक्कम'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-700">
            {formatCurrency(totalCommissionGenerated, language)}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {language === 'EN' ? '10% of 1st installments' : 'पहिल्या हप्त्यावरील १०% कमिशन'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? 'Commission Paid' : 'अदा केलेले कमिशन'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600">
            {formatCurrency(totalCommissionPaid, language)}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {language === 'EN' ? 'Successfully disbursed' : 'रेफरर्सना दिलेले कमिशन'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {language === 'EN' ? 'Pending Commission' : 'देणे बाकी कमिशन'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-600">
            {formatCurrency(pendingCommission, language)}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {language === 'EN' ? 'Ready to pay to referrers' : 'रेफरर्सना देण्यास पात्र'}
          </p>
        </div>
      </div>

      {/* Referrals Table Card */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          {/* Status Filter Buttons */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-white text-brand-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              सर्व ({referrals.length})
            </button>
            <button
              onClick={() => setStatusFilter('EARNED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                statusFilter === 'EARNED' ? 'bg-white text-brand-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              पात्र कमिशन
            </button>
            <button
              onClick={() => setStatusFilter('PAID')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                statusFilter === 'PAID' ? 'bg-white text-brand-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              अदा केले
            </button>
          </div>

          {/* Search bar */}
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="रेफरर किंवा सदस्याचे नाव/मोबाईल शोधा..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {filteredReferrals.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm font-medium">
              {language === 'EN' ? 'No referrals recorded yet.' : 'कोणतेही रेफरल नोंदी उपलब्ध नाहीत.'}
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-3">रेफर करणारा खातेदार</th>
                  <th className="py-3 px-3">नवीन जोडलेला खातेदार</th>
                  <th className="py-3 px-3 text-right">पहिला हप्ता रक्कम</th>
                  <th className="py-3 px-3 text-right text-emerald-700 font-black">१०% कमिशन</th>
                  <th className="py-3 px-3 text-center">स्थिती</th>
                  <th className="py-3 px-3 text-center">कृती</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReferrals.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-extrabold text-slate-900">{r.referrerName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        #{r.referrerAccountNumber} • {r.referrerMobile}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-extrabold text-brand-900">{r.referredCustomerName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        #{r.referredAccountNumber} • {r.referredCustomerMobile}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-800">
                      {formatCurrency(r.firstInstallmentAmount, language)}
                    </td>
                    <td className="py-3 px-3 text-right font-black text-emerald-700 text-sm">
                      {formatCurrency(r.commissionAmount, language)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {r.status === 'COMMISSION_PAID' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                          कमिशन दिले
                        </span>
                      ) : r.status === 'COMMISSION_EARNED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                          देणे बाकी
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600">
                          हप्ता अपूर्ण
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center space-x-1">
                      {r.status === 'COMMISSION_EARNED' && (
                        <button
                          onClick={() => setSelectedRefToPay(r)}
                          className="px-3 py-1.5 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                        >
                          कमिशन द्या
                        </button>
                      )}
                      {r.status === 'COMMISSION_PAID' && (
                        <button
                          onClick={() => setReceiptRef(r)}
                          className="p-1.5 hover:bg-slate-100 text-brand-700 rounded-lg cursor-pointer"
                          title="पावती पहा"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal: Link New Referral */}
      {isAddModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    नवीन रेफरल लिंक करा (१०% कमिशन)
                  </h3>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Referrer Dropdown */}
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    १. रेफर करणारा खातेदार (Referrer):
                  </label>
                  <select
                    value={selectedReferrerId}
                    onChange={(e) => setSelectedReferrerId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white font-medium text-slate-800"
                  >
                    <option value="">खातेदार निवडा...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.accountNumber} - {c.name} ({c.mobile})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Referred Member Dropdown */}
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    २. नवीन जोडलेला खातेदार (Referred Customer):
                  </label>
                  <select
                    value={selectedReferredId}
                    onChange={(e) => setSelectedReferredId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white font-medium text-slate-800"
                  >
                    <option value="">नवीन खातेदार निवडा...</option>
                    {customers
                      .filter((c) => c.id !== selectedReferrerId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.accountNumber} - {c.name} ({c.mobile})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Commission Calculation Preview */}
                <div className="bg-emerald-50/60 p-3.5 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-emerald-950">पहिला हप्ता रक्कम:</span>
                    <span className="font-black text-slate-900 text-sm">
                      ₹{effectiveFirstAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-emerald-200">
                    <span className="font-bold text-emerald-900">अधिकृत १०% कमिशन रक्कम:</span>
                    <span className="font-black text-emerald-700 text-base">
                      ₹{calculated10PercentCommission.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">शेरा (Notes - पर्यायी):</label>
                  <input
                    type="text"
                    placeholder="उदा. मित्राच्या शिफारशीनुसार भिशी जॉईन केली."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handleCreateReferral}
                  className="flex-1 py-2.5 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-black rounded-xl shadow-md cursor-pointer transition-all"
                >
                  रेफरल सेव्ह करा
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal: Pay Commission */}
      {selectedRefToPay && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-base font-extrabold text-slate-900">
                  १०% कमिशन वाटप
                </h3>
                <button
                  onClick={() => setSelectedRefToPay(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">रेफरर नाव:</span>
                  <span className="font-extrabold text-slate-900">{selectedRefToPay.referrerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">मोबाईल:</span>
                  <span className="font-medium text-slate-800">{selectedRefToPay.referrerMobile}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="text-emerald-800 font-bold">देय १०% कमिशन:</span>
                  <span className="font-black text-emerald-700 text-base">
                    ₹{selectedRefToPay.commissionAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">पेमेंट मोड:</label>
                  <select
                    value={payMode}
                    onChange={(e) => setPayMode(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold bg-white"
                  >
                    <option value="UPI">UPI / GPay / PhonePe</option>
                    <option value="BANK">बँक ट्रान्सफर (NEFT)</option>
                    <option value="CASH">रोख (Cash)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-600 block mb-1">रेफरन्स क्र. / UTR No.:</label>
                  <input
                    type="text"
                    placeholder="उदा. UPI-123456"
                    value={payRefNo}
                    onChange={(e) => setPayRefNo(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRefToPay(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handlePayCommission}
                  className="flex-1 py-2 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-black rounded-xl shadow-md cursor-pointer transition-all"
                >
                  कमिशन अदा करा
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal: Commission Receipt */}
      {receiptRef && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-fade-in print:shadow-none print:border-none">
              <div className="text-center pb-3 border-b border-slate-200">
                <h2 className="text-base font-extrabold text-[#1E3A8A]">श्री महाकाल फायनान्स</h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  रेफरल कमिशन वाटप पावती (१०% कमिशन)
                </p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">पावती क्र.:</span>
                  <span className="font-mono font-bold text-slate-900">{receiptRef.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">रेफरर नाव:</span>
                  <span className="font-extrabold text-slate-900">
                    {receiptRef.referrerName} (#{receiptRef.referrerAccountNumber})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">नवीन खातेदार:</span>
                  <span className="font-bold text-slate-800">
                    {receiptRef.referredCustomerName} (#{receiptRef.referredAccountNumber})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">पहिला हप्ता:</span>
                  <span className="font-bold text-slate-800">
                    ₹{receiptRef.firstInstallmentAmount.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-black text-emerald-800">
                  <span>१०% कमिशन रक्कम:</span>
                  <span>₹{receiptRef.commissionAmount.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                  <span>पेमेंट मोड:</span>
                  <span className="font-bold text-slate-800">{receiptRef.paymentMode || 'UPI'}</span>
                </div>
                {receiptRef.referenceNo && (
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>रेफरन्स क्र.:</span>
                    <span className="font-mono text-slate-800">{receiptRef.referenceNo}</span>
                  </div>
                )}
              </div>

              <div className="pt-4 flex justify-between gap-3 no-print">
                <button
                  onClick={() => setReceiptRef(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  बंद करा
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 py-2 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-black rounded-xl shadow-xs flex items-center justify-center space-x-1 cursor-pointer"
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

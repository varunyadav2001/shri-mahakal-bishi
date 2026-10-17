import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { StorageService } from '../../services/db';
import { MemberRequest, RequestType, RequestStatus, Modality } from '../../types';
import { formatCurrency, formatDateMarathi, getBishiNameMarathi } from '../../utils/formatters';
import {
  Inbox,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Filter,
  UserCheck,
  CreditCard,
  Landmark,
  User,
  HelpCircle,
  AlertTriangle,
  RefreshCw,
  Send,
  MessageSquare,
} from 'lucide-react';
import { ModalPortal } from '../../components/common/ModalPortal';
import { ConfirmModal } from '../../components/common/ConfirmModal';

export const RequestsManager: React.FC = () => {
  const { requests, bishiConfigs, refreshData, showToast, language } = useApp();
  const { currentAdmin } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | RequestStatus>('ALL');
  const [schemeFilter, setSchemeFilter] = useState<string>('ALL');

  // Review Modal state
  const [selectedRequest, setSelectedRequest] = useState<MemberRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [approvalAmount, setApprovalAmount] = useState<string>('1000');
  const [selectedSchemeId, setSelectedSchemeId] = useState<string>('');
  const [rejectionNote, setRejectionNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [isRefreshingCloud, setIsRefreshingCloud] = useState(false);

  const handleCloudRefresh = async (silent: boolean = false) => {
    setIsRefreshingCloud(true);
    try {
      const fetched = await StorageService.fetchRequestsFromFirestore();
      refreshData();
      if (!silent) {
        showToast(
          language === 'EN'
            ? `Synced ${fetched.length} request(s) from Firebase cloud.`
            : `Firebase वरून ${fetched.length} अर्ज यशस्वीपणे लोड झाले.`,
          'success'
        );
      }
    } catch (err: any) {
      if (!silent) {
        showToast(
          language === 'EN' ? 'Failed to fetch cloud requests' : 'क्लाउड अर्ज लोड करताना त्रुटी आली',
          'error'
        );
      }
    } finally {
      setIsRefreshingCloud(false);
    }
  };

  React.useEffect(() => {
    handleCloudRefresh(true);
  }, []);

  // Counts
  const totalCount = requests.length;
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const approvedCount = requests.filter((r) => r.status === 'APPROVED').length;
  const rejectedCount = requests.filter((r) => r.status === 'REJECTED').length;

  // Distinct schemes from bishiConfigs and existing requests
  const availableSchemes = React.useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();

    bishiConfigs.forEach((cfg) => {
      if (cfg.id && !seen.has(cfg.id)) {
        seen.add(cfg.id);
        list.push({
          id: cfg.id,
          name: getBishiNameMarathi(cfg.id as any, language, bishiConfigs) || cfg.name,
        });
      }
    });

    requests.forEach((r) => {
      const sId = (r.schemeId || (r as any).bishiType || (r as any).payload?.schemeId || '').trim();
      const sName = (r.schemeName || (r as any).payload?.schemeName || (r as any).bishiName || '').trim();
      if (sId && !seen.has(sId)) {
        seen.add(sId);
        list.push({
          id: sId,
          name: sName || getBishiNameMarathi(sId as any, language, bishiConfigs) || sId,
        });
      } else if (!sId && sName && !seen.has(sName)) {
        seen.add(sName);
        list.push({
          id: sName,
          name: sName,
        });
      }
    });

    return list;
  }, [bishiConfigs, requests, language]);

  const getRequestSchemeDisplay = (req: MemberRequest) => {
    const rawId = (req.schemeId || (req as any).bishiType || (req as any).payload?.schemeId || '').trim();
    const rawName = (req.schemeName || (req as any).payload?.schemeName || (req as any).bishiName || '').trim();

    const matched = bishiConfigs.find(
      (b) => (rawId && b.id === rawId) || (rawName && (b.name === rawName || b.id === rawName))
    );

    const schemeName =
      matched
        ? (language === 'EN' ? matched.name : (getBishiNameMarathi(matched.id as any, language, bishiConfigs) || matched.name))
        : (rawName || (rawId ? getBishiNameMarathi(rawId as any, language, bishiConfigs) || rawId : (language === 'EN' ? 'General Bishi' : '१५ ऑगस्ट भिशी')));

    const modality: Modality = req.modality || (req as any).payload?.modality || matched?.modality || 'W';
    const modalityLabel = modality === 'W'
      ? (language === 'EN' ? 'Weekly' : 'साप्ताहिक')
      : (language === 'EN' ? 'Monthly' : 'मासिक');

    const totalInstallments = Number(req.totalInstallments || (req as any).payload?.totalInstallments || matched?.totalInstallments) || (modality === 'W' ? 40 : 10);

    return {
      schemeId: matched?.id || rawId || (bishiConfigs[0]?.id || '15_AUGUST'),
      schemeName,
      modality,
      modalityLabel,
      totalInstallments,
    };
  };

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle className="w-3.5 h-3.5" />
            {language === 'EN' ? 'Approved' : 'मंजूर'}
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3.5 h-3.5" />
            {language === 'EN' ? 'Rejected' : 'नाकारले'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            {language === 'EN' ? 'Pending' : 'प्रलंबित'}
          </span>
        );
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;

    if (schemeFilter !== 'ALL') {
      const sInfo = getRequestSchemeDisplay(r);
      const target = schemeFilter.trim().toLowerCase();
      const matches =
        sInfo.schemeId.toLowerCase() === target ||
        sInfo.schemeName.toLowerCase() === target ||
        (r.schemeId && r.schemeId.toLowerCase() === target) ||
        (r.schemeName && r.schemeName.toLowerCase() === target) ||
        ((r as any).bishiType && String((r as any).bishiType).toLowerCase() === target);
      if (!matches) return false;
    }

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      const nameMatch = r.customerName?.toLowerCase().includes(term);
      const mobileMatch = (r.mobile || (r as any).customerPhone)?.includes(term);
      const accMatch = r.accountNumber?.toLowerCase().includes(term);
      const msgMatch = r.message?.toLowerCase().includes(term);
      const schemeInfo = getRequestSchemeDisplay(r);
      const schemeMatch = schemeInfo.schemeName.toLowerCase().includes(term);
      if (!nameMatch && !mobileMatch && !accMatch && !msgMatch && !schemeMatch) return false;
    }
    return true;
  });

  const openReviewModal = (req: MemberRequest, action: 'APPROVE' | 'REJECT') => {
    setSelectedRequest(req);
    setReviewAction(action);
    setRejectionNote('');
    setValidationError('');
    const defaultAmt = req.amount && req.amount > 0 ? req.amount : 1000;
    setApprovalAmount(String(defaultAmt));

    const schemeInfo = getRequestSchemeDisplay(req);
    setSelectedSchemeId(schemeInfo.schemeId);
  };

  const closeReviewModal = () => {
    setSelectedRequest(null);
    setReviewAction(null);
    setRejectionNote('');
    setValidationError('');
    setApprovalAmount('1000');
    setSelectedSchemeId('');
    setIsSubmitting(false);
  };

  const handleConfirmReview = async () => {
    if (!selectedRequest || !reviewAction) return;

    if (reviewAction === 'REJECT' && !rejectionNote.trim()) {
      setValidationError(
        language === 'EN'
          ? 'Rejection reason note is required.'
          : 'अर्ज नाकारताना कारण (Note) लिहिणे बंधनकारक आहे.'
      );
      return;
    }

    const parsedApprovalAmt = Number(approvalAmount) > 0 ? Number(approvalAmount) : (selectedRequest.amount || 1000);
    if (reviewAction === 'APPROVE' && parsedApprovalAmt <= 0) {
      setValidationError(
        language === 'EN'
          ? 'Please enter a valid installment amount.'
          : 'कृपया वैध हप्ता रक्कम प्रविष्ट करा.'
      );
      return;
    }

    setIsSubmitting(true);
    setValidationError('');

    try {
      const adminName = currentAdmin?.name || 'Administrator';
      await StorageService.reviewRequest(
        selectedRequest.id,
        reviewAction === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        rejectionNote.trim(),
        adminName,
        parsedApprovalAmt,
        selectedSchemeId
      );

      showToast(
        reviewAction === 'APPROVE'
          ? language === 'EN'
            ? 'Scheme joining request approved! Customer enrolled in scheme.'
            : 'भिशी नोंदणी अर्ज मंजूर केला गेला आणि खातेदार जोडला गेला!'
          : language === 'EN'
          ? 'Request rejected with reason note.'
          : 'अर्ज नाकारला गेला आणि सभासदाला नोंद पाठवली.',
        reviewAction === 'APPROVE' ? 'success' : 'info'
      );

      refreshData();
      closeReviewModal();
    } catch (err: any) {
      setValidationError(err?.message || 'Error reviewing request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
              <Inbox className="w-5 h-5 text-[#2563EB]" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                {language === 'EN' ? 'Member Requests & Approvals' : 'सदस्य अर्ज व मान्यता'}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 font-medium">
                {language === 'EN'
                  ? 'Review, verify and approve member requests from the Narayan Member App'
                  : 'नारायण सदस्य ॲपमधून आलेले नवीन अर्ज, कर्ज विनंत्या आणि जमा पावत्यांची तपासणी व मान्यता'}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => handleCloudRefresh(false)}
          disabled={isRefreshingCloud}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl text-xs sm:text-sm font-bold border border-gray-200 transition-colors self-start md:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-gray-600 ${isRefreshingCloud ? 'animate-spin' : ''}`} />
          {isRefreshingCloud
            ? language === 'EN' ? 'Syncing...' : 'सिंक होत आहे...'
            : language === 'EN' ? 'Refresh' : 'रिफ्रेश करा'}
        </button>
      </div>

      {/* 4 Overview Metric Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {language === 'EN' ? 'Total Requests' : 'एकूण अर्ज'}
            </span>
            <Inbox className="w-4 h-4 text-gray-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-gray-900">{totalCount}</div>
        </div>

        <div className="bg-amber-50/50 rounded-2xl p-4 sm:p-5 border border-amber-200/60 shadow-sm relative overflow-hidden">
          {pendingCount > 0 && (
            <span className="absolute top-3 right-3 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
          )}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
              {language === 'EN' ? 'Pending Approval' : 'प्रलंबित अर्ज'}
            </span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-900">{pendingCount}</div>
        </div>

        <div className="bg-emerald-50/50 rounded-2xl p-4 sm:p-5 border border-emerald-200/60 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
              {language === 'EN' ? 'Approved' : 'मंजूर अर्ज'}
            </span>
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-900">{approvedCount}</div>
        </div>

        <div className="bg-rose-50/50 rounded-2xl p-4 sm:p-5 border border-rose-200/60 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-rose-800 uppercase tracking-wider">
              {language === 'EN' ? 'Rejected' : 'नाकारलेले अर्ज'}
            </span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-900">{rejectedCount}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Tabs */}
          <div className="inline-flex p-1 bg-gray-100 rounded-xl text-xs font-bold">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {language === 'EN' ? 'All' : 'सर्व'} ({totalCount})
            </button>
            <button
              onClick={() => setStatusFilter('PENDING')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                statusFilter === 'PENDING'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-amber-700 hover:text-amber-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {language === 'EN' ? 'Pending' : 'प्रलंबित'} ({pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter('APPROVED')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'APPROVED' ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {language === 'EN' ? 'Approved' : 'मंजूर'} ({approvedCount})
            </button>
            <button
              onClick={() => setStatusFilter('REJECTED')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'REJECTED' ? 'bg-white text-rose-800 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {language === 'EN' ? 'Rejected' : 'नाकारलेले'} ({rejectedCount})
            </button>
          </div>

          {/* Bhishi Scheme Dropdown Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-gray-500 hidden sm:inline">
              {language === 'EN' ? 'Scheme:' : 'भिशी योजना:'}
            </span>
            <select
              value={schemeFilter}
              onChange={(e) => setSchemeFilter(e.target.value)}
              className="text-xs font-black bg-blue-50 text-blue-950 border-2 border-blue-600 hover:border-blue-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2563EB] shadow-xs cursor-pointer transition-colors"
            >
              <option value="ALL">{language === 'EN' ? 'All Bhishi Schemes' : 'सर्व भिशी योजना'}</option>
              {availableSchemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={language === 'EN' ? 'Search by name, mobile, account...' : 'नाव, मोबाईल, खाते क्र. शोधा...'}
            className="w-full text-xs sm:text-sm pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
        </div>
      </div>

      {/* Requests List / Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {filteredRequests.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-16 h-16 mx-auto mb-3 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400">
              <Inbox className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">
              {language === 'EN' ? 'No member requests found' : 'कोणतेही सदस्य अर्ज उपलब्ध नाहीत'}
            </h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              {language === 'EN'
                ? 'When members submit applications to join a Bhishi scheme through the Member App, they will appear here for review.'
                : 'सदस्य ॲपद्वारे भिशी योजनेत सहभागासाठी अर्ज पाठवल्यावर ते येथे मंजुरीसाठी दिसतील.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">{language === 'EN' ? 'Date & Time' : 'दिनांक व वेळ'}</th>
                  <th className="py-3 px-4">{language === 'EN' ? 'Member Name' : 'सभासदाचे नाव व मोबाईल'}</th>
                  <th className="py-3 px-4">{language === 'EN' ? 'Target Bhishi Scheme' : 'इच्छित भिशी योजना'}</th>
                  <th className="py-3 px-4">{language === 'EN' ? 'Installment Amount' : 'हप्ता रक्कम'}</th>
                  <th className="py-3 px-4">{language === 'EN' ? 'Message' : 'सभासदाचा संदेश'}</th>
                  <th className="py-3 px-4">{language === 'EN' ? 'Status' : 'स्थिती'}</th>
                  <th className="py-3 px-4 text-right">{language === 'EN' ? 'Actions' : 'कृती'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRequests.map((req) => {
                  const schemeInfo = getRequestSchemeDisplay(req);
                  return (
                    <tr key={req.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap text-gray-600 font-medium text-xs">
                        {formatDateMarathi(req.createdAt.split('T')[0], language)}
                        <span className="block text-[10px] text-gray-400">
                          {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-900">{req.customerName || 'सभासद'}</div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                          <span className="font-semibold text-slate-600">{req.mobile}</span>
                          {req.accountNumber && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono text-[10px]">
                              #{req.accountNumber}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-50 text-emerald-900 border border-emerald-300 shadow-2xs">
                          <Landmark className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span>{schemeInfo.schemeName}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-semibold mt-1 flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold text-[10px]">
                            {schemeInfo.modalityLabel}
                          </span>
                          <span>•</span>
                          <span>{schemeInfo.totalInstallments} {language === 'EN' ? 'Installments' : 'हप्ते'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-black text-emerald-900 text-sm">
                          {formatCurrency(req.amount || 1000, language)}
                        </div>
                        <span className="text-[10px] text-gray-500 font-bold block">
                          {language === 'EN' ? 'Per Installment' : 'प्रति हप्ता'}
                        </span>
                      </td>

                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-xs text-gray-700 truncate" title={req.message}>
                          {req.message || <span className="text-gray-400 italic">काही संदेश नाही</span>}
                        </div>
                        {req.reviewNote && (
                          <div className="text-[11px] text-rose-700 mt-1 bg-rose-50 p-1.5 rounded border border-rose-100">
                            <strong>{language === 'EN' ? 'Admin Note:' : 'प्रशासक नोंद:'}</strong> {req.reviewNote}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">{getStatusBadge(req.status)}</td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {req.status === 'PENDING' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => openReviewModal(req, 'APPROVE')}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
                            >
                              {language === 'EN' ? 'Approve' : 'मान्यता द्या'}
                            </button>
                            <button
                              onClick={() => openReviewModal(req, 'REJECT')}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-all"
                            >
                              {language === 'EN' ? 'Reject' : 'नाकारा'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">
                            {req.reviewedBy ? `${language === 'EN' ? 'By' : 'द्वारा'}: ${req.reviewedBy}` : 'Processed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Modal Portal */}
      {selectedRequest && reviewAction && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div
                className={`p-5 flex items-center justify-between text-white ${
                  reviewAction === 'APPROVE' ? 'bg-[#1E3A8A]' : 'bg-rose-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  {reviewAction === 'APPROVE' ? (
                    <CheckCircle className="w-6 h-6 text-blue-300" />
                  ) : (
                    <XCircle className="w-6 h-6 text-rose-300" />
                  )}
                  <div>
                    <h3 className="font-bold text-lg">
                      {reviewAction === 'APPROVE'
                        ? language === 'EN'
                          ? 'Approve Scheme Joining Request'
                          : 'भिशी नोंदणी अर्जाला मान्यता द्या'
                        : language === 'EN'
                        ? 'Reject Scheme Request'
                        : 'भिशी नोंदणी अर्ज नाकारा'}
                    </h3>
                    <p className="text-xs text-white/80">
                      {selectedRequest.customerName} ({selectedRequest.mobile})
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                {/* Details summary */}
                {(() => {
                  const sInfo = getRequestSchemeDisplay(selectedRequest);
                  return (
                    <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-200 text-xs space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 font-medium">{language === 'EN' ? 'Member Name:' : 'सभासदाचे नाव:'}</span>
                        <span className="font-bold text-gray-900">{selectedRequest.customerName}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 font-medium">{language === 'EN' ? 'Mobile:' : 'मोबाईल:'}</span>
                        <span className="font-bold text-gray-900">{selectedRequest.mobile}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-gray-200/60">
                        <span className="text-gray-500 font-medium">{language === 'EN' ? 'Requested Scheme:' : 'इच्छित भिशी योजना:'}</span>
                        <span className="font-black text-emerald-900 bg-emerald-100/80 px-2.5 py-1 rounded-lg border border-emerald-300">
                          {sInfo.schemeName}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 font-medium">{language === 'EN' ? 'Frequency & Schedule:' : 'वारंवारता व हप्ते:'}</span>
                        <span className="font-bold text-gray-700">
                          {sInfo.modalityLabel} ({sInfo.totalInstallments} {language === 'EN' ? 'Installments' : 'हप्ते'})
                        </span>
                      </div>
                      {selectedRequest.message && (
                        <div className="pt-1.5 border-t border-gray-200/60">
                          <span className="text-gray-500 block mb-0.5 font-medium">{language === 'EN' ? 'Member Message:' : 'सभासदाचा संदेश:'}</span>
                          <p className="text-gray-800 italic bg-white p-2 rounded-lg border border-gray-200">"{selectedRequest.message}"</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {reviewAction === 'APPROVE' ? (
                  <div className="space-y-3">
                    {/* Confirm Bhishi Scheme */}
                    <div className="space-y-1.5 bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-200">
                      <label className="block text-xs font-black text-emerald-950">
                        {language === 'EN' ? 'Confirm Bhishi Scheme *' : 'भिशी योजना निवडा / निश्चित करा *'}
                      </label>
                      <select
                        value={selectedSchemeId}
                        onChange={(e) => {
                          setSelectedSchemeId(e.target.value);
                          const chosen = bishiConfigs.find((b) => b.id === e.target.value);
                          if (chosen && (chosen as any).amount) {
                            setApprovalAmount(String((chosen as any).amount));
                          }
                          setValidationError('');
                        }}
                        className="w-full text-xs sm:text-sm font-black p-2.5 bg-white border border-emerald-300 rounded-xl text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                      >
                        {bishiConfigs.map((cfg) => (
                          <option key={cfg.id} value={cfg.id}>
                            {getBishiNameMarathi(cfg.id as any, language, bishiConfigs) || cfg.name} ({cfg.modality === 'W' ? (language === 'EN' ? 'Weekly' : 'साप्ताहिक') : (language === 'EN' ? 'Monthly' : 'मासिक')})
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-500">
                        {language === 'EN'
                          ? 'Member will be enrolled into this selected Bhishi scheme.'
                          : 'सभासदाला या भिशी योजनेमध्ये सभासद म्हणून नोंदवले जाईल.'}
                      </p>
                    </div>

                    {/* Installment Amount Input */}
                    <div className="space-y-1.5 bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-200">
                      <label className="block text-xs font-black text-emerald-950">
                        {language === 'EN' ? 'Installment Amount (₹) *' : 'हप्ता रक्कम (₹) *'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-gray-500 font-bold text-sm">₹</span>
                        <input
                          type="number"
                          value={approvalAmount}
                          onChange={(e) => {
                            setApprovalAmount(e.target.value);
                            setValidationError('');
                          }}
                          className="w-full text-sm font-bold pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="1000"
                          min={100}
                          step={100}
                        />
                      </div>
                      <p className="text-[11px] text-gray-500">
                        {language === 'EN'
                          ? `Customer will be enrolled with this installment amount.`
                          : `खातेदाराला या हप्ता रकमेसह भिशी योजनेत नोंदवले जाईल.`}
                      </p>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 space-y-1">
                      <p className="font-bold">
                        {language === 'EN' ? 'Side-effects upon approval:' : 'मान्यता दिल्यानंतर होणारे बदल:'}
                      </p>
                      <ul className="list-disc list-inside text-emerald-800 space-y-0.5">
                        <li>{language === 'EN' ? 'Customer record will be enrolled in the scheme with full installments schedule' : 'खातेदाराची नवीन नोंदणी व सर्व हप्त्यांचे वेळापत्रक आपोआप तयार केले जाईल.'}</li>
                        <li>{language === 'EN' ? 'In-app and push notification will be sent to the member' : 'सभासदाच्या मोबाईलवर त्वरित मंजुरी सूचना पाठवली जाईल.'}</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-800">
                      {language === 'EN' ? 'Rejection Reason Note * (Required)' : 'अर्ज नाकारण्याचे कारण * (बंधनकारक)'}
                    </label>
                    <textarea
                      rows={3}
                      value={rejectionNote}
                      onChange={(e) => {
                        setRejectionNote(e.target.value);
                        setValidationError('');
                      }}
                      placeholder={
                        language === 'EN'
                          ? 'Explain to the member why this request cannot be processed...'
                          : 'सभासदाला हा अर्ज का नाकारला याचे स्पष्टीकरण लिहा...'
                      }
                      className="w-full text-xs sm:text-sm p-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    <p className="text-[11px] text-gray-500">
                      {language === 'EN'
                        ? 'This explanation will be delivered directly to the member in their mobile app.'
                        : 'ही नोंद सभासदाला त्यांच्या सदस्य ॲपमध्ये स्पष्टपणे दिसेल.'}
                    </p>
                  </div>
                )}

                {validationError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={closeReviewModal}
                  className="px-4 py-2 text-xs font-bold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  {language === 'EN' ? 'Cancel' : 'रद्द करा'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleConfirmReview}
                  className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-md transition-all flex items-center gap-1.5 ${
                    reviewAction === 'APPROVE'
                      ? 'bg-[#1E3A8A] hover:bg-[#2563EB]'
                      : 'bg-rose-600 hover:bg-rose-700'
                  } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : reviewAction === 'APPROVE' ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  {reviewAction === 'APPROVE'
                    ? language === 'EN'
                      ? 'Confirm Approval'
                      : 'मान्यता निश्चित करा'
                    : language === 'EN'
                    ? 'Reject Request'
                    : 'अर्ज नाकारा'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { MemberRequest } from '../types';
import { Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, MessageSquare, ShieldAlert } from 'lucide-react';

export const MyRequestsScreen: React.FC = () => {
  const { customer } = useAuth();
  const { language } = useLanguage();

  const [requestsList, setRequestsList] = useState<MemberRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.id && !customer?.mobile) return;
    const phone = customer?.mobile || '';

    let listMemberReq: MemberRequest[] = [];
    let listReq: MemberRequest[] = [];

    const updateCombined = () => {
      const map = new Map<string, MemberRequest>();
      listMemberReq.forEach((r) => map.set(r.id, r));
      listReq.forEach((r) => {
        if (!map.has(r.id)) map.set(r.id, r);
      });
      const sorted = Array.from(map.values()).sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || '')
      );
      setRequestsList(sorted);
      setLoading(false);
    };

    // 1. Listen on member_requests
    const q1 = query(
      collection(db, 'member_requests'),
      where('customerPhone', '==', phone),
      orderBy('createdAt', 'desc')
    );
    const unsub1 = onSnapshot(
      q1,
      (snapshot) => {
        listMemberReq = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as MemberRequest));
        updateCombined();
      },
      (err) => {
        console.warn('member_requests listener error:', err?.message || err);
        setLoading(false);
      }
    );

    // 2. Listen on requests as fallback
    const q2 = query(
      collection(db, 'requests'),
      where('customerPhone', '==', phone),
      orderBy('createdAt', 'desc')
    );
    const unsub2 = onSnapshot(
      q2,
      (snapshot) => {
        listReq = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as MemberRequest));
        updateCombined();
      },
      (err) => {
        console.warn('requests listener error:', err?.message || err);
        setLoading(false);
      }
    );

    return () => {
      unsub1();
      unsub2();
    };
  }, [customer?.id, customer?.mobile]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
            <span>{language === 'EN' ? 'Approved' : 'मंजूर'}</span>
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-700" />
            <span>{language === 'EN' ? 'Rejected' : 'नाकारले'}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-700 animate-spin" />
            <span>{language === 'EN' ? 'Pending Review' : 'प्रतीक्षेत'}</span>
          </span>
        );
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case 'PAYMENT': return language === 'EN' ? 'Payment Slip' : 'हप्ता भरणा पावती';
      case 'LOAN': return language === 'EN' ? 'Loan Application' : 'कर्ज अर्ज';
      case 'JOIN_SCHEME': return language === 'EN' ? 'Join Scheme' : 'योजना सहभाग';
      case 'PROFILE_CHANGE': return language === 'EN' ? 'Profile Change' : 'माहिती बदल';
      default: return language === 'EN' ? 'Inquiry / Other' : 'इतर अर्ज';
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-2 pt-2">
        <div className="w-9 h-9 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">
            {language === 'EN' ? 'My Applications' : 'माझे अर्ज व स्थिती'}
          </h1>
          <p className="text-[11px] font-bold text-slate-500">
            {language === 'EN' ? 'Live status and admin decisions' : 'सादर केलेल्या सर्व अर्जांची सद्यस्थिती'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-2">
          <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
          <span className="text-xs font-bold">{language === 'EN' ? 'Loading applications...' : 'अर्ज लोड होत आहेत...'}</span>
        </div>
      ) : requestsList.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2 shadow-xs">
          <AlertCircle className="w-8 h-8 mx-auto text-slate-300" />
          <div className="text-xs font-black text-slate-700">
            {language === 'EN' ? 'No applications submitted yet' : 'अद्याप कोणताही अर्ज सादर केलेला नाही'}
          </div>
          <p className="text-[11px] text-slate-400">
            {language === 'EN' ? 'You can submit payment slips or loan requests anytime.' : 'तुम्ही नवीन अर्ज पर्यायातून अर्ज पाठवू शकता.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requestsList.map((req) => (
            <div
              key={req.id}
              className={`p-4 rounded-3xl bg-white border shadow-xs space-y-3 transition-all ${
                req.status === 'REJECTED'
                  ? 'border-rose-300/80'
                  : req.status === 'APPROVED'
                  ? 'border-emerald-300/80'
                  : 'border-slate-200'
              }`}
            >
              {/* Card Top */}
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 tracking-wider uppercase block">
                    {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '---'}
                  </span>
                  <div className="text-sm font-black text-slate-900">
                    {getTypeName(req.type)}
                  </div>
                </div>
                {getStatusBadge(req.status)}
              </div>

              {/* Amount if available */}
              {req.amount !== undefined && req.amount > 0 && (
                <div className="text-xs font-black text-slate-800 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{language === 'EN' ? 'Amount' : 'रक्कम'}:</span>
                  <span className="text-emerald-700">₹{req.amount.toLocaleString('en-IN')}</span>
                </div>
              )}

              {/* Message from member */}
              <div className="text-xs font-medium text-slate-600 bg-slate-50/50 p-3 rounded-2xl border border-slate-100">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-0.5">{language === 'EN' ? 'Your Note' : 'तुमचा संदेश'}:</div>
                {req.message}
              </div>

              {/* REJECTION NOTE: High prominence as required by prompt! */}
              {req.status === 'REJECTED' && req.reviewNote && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1">
                  <div className="flex items-center space-x-1 text-rose-800 font-black">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                    <span>{language === 'EN' ? 'Admin Rejection Reason' : 'प्रशासकीय नाकारण्याचे कारण'}:</span>
                  </div>
                  <p className="text-[11px] font-bold leading-relaxed pl-4">{req.reviewNote}</p>
                </div>
              )}

              {/* APPROVED NOTE if provided */}
              {req.status === 'APPROVED' && (
                <div className="p-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    {req.reviewNote
                      ? `${language === 'EN' ? 'Admin note: ' : 'प्रशासक शेरा: '} ${req.reviewNote}`
                      : language === 'EN'
                      ? 'Approved by admin and updated in records.'
                      : 'प्रशासकाकडून मंजूर झाले असून रेकॉर्डमध्ये नोंद झाली आहे.'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

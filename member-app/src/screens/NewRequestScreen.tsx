import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { RequestType } from '../types';
import { PlusCircle, Send, CheckCircle2, HelpCircle, ArrowRight, Calendar, Sparkles } from 'lucide-react';

interface NewRequestScreenProps {
  onSuccess: () => void;
}

interface SchemeOption {
  id: string;
  name: string;
  modality: 'W' | 'M';
  totalInstallments: number;
  startDate?: string;
}

const DEFAULT_SCHEMES: SchemeOption[] = [
  { id: '15_AUGUST', name: '१५ ऑगस्ट भिशी', modality: 'W', totalInstallments: 40 },
  { id: '26_JANUARY', name: '२६ जानेवारी भिशी', modality: 'M', totalInstallments: 10 },
  { id: 'DASARA', name: 'दसरा भिशी', modality: 'W', totalInstallments: 40 },
];

export const NewRequestScreen: React.FC<NewRequestScreenProps> = ({ onSuccess }) => {
  const { user, customer, fcmToken } = useAuth();
  const { language } = useLanguage();

  const [type, setType] = useState<RequestType>('JOIN_SCHEME');
  const [amount, setAmount] = useState('1000');
  const [selectedSchemeId, setSelectedSchemeId] = useState<string>('15_AUGUST');
  const [selectedModality, setSelectedModality] = useState<'W' | 'M'>('W');
  const [availableSchemes, setAvailableSchemes] = useState<SchemeOption[]>(DEFAULT_SCHEMES);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const requestTypes: { id: RequestType; labelMr: string; labelEn: string; descMr: string }[] = [
    {
      id: 'JOIN_SCHEME',
      labelMr: 'नवीन भिशी योजना अर्ज',
      labelEn: 'Join New Scheme',
      descMr: 'नवीन सुरू होणाऱ्या भिशीमध्ये सहभाग',
    },
    {
      id: 'PAYMENT',
      labelMr: 'हप्ता भरणा पावती अर्ज',
      labelEn: 'Installment Payment Slip',
      descMr: 'ऑनलाईन किंवा रोख भरणा केल्याची नोंद',
    },
    {
      id: 'LOAN',
      labelMr: 'नवीन कर्ज अर्ज',
      labelEn: 'Loan Application',
      descMr: 'भिशीवर तातडीचे कर्ज मिळवण्यासाठी',
    },
    {
      id: 'PROFILE_CHANGE',
      labelMr: 'माहिती बदल अर्ज',
      labelEn: 'Profile Update Request',
      descMr: 'नाव, पत्ता किंवा मोबाईल बदलण्यासाठी',
    },
    {
      id: 'OTHER',
      labelMr: 'इतर तक्रार / विचारणा',
      labelEn: 'Other Inquiry / Help',
      descMr: 'व्यवस्थापकाशी संपर्क किंवा विचारणा',
    },
  ];

  // Real-time synchronization of active Bishi schemes from Firestore
  useEffect(() => {
    try {
      const unsub = onSnapshot(collection(db, 'bishi'), (snap) => {
        if (!snap.empty) {
          const list: SchemeOption[] = [];
          snap.forEach((d) => {
            const data = d.data();
            list.push({
              id: data.id || d.id,
              name: data.name || data.schemeName || d.id,
              modality: data.modality || (data.id === '26_JANUARY' ? 'M' : 'W'),
              totalInstallments: Number(data.totalInstallments) || (data.modality === 'M' ? 10 : 40),
              startDate: data.startDate,
            });
          });
          if (list.length > 0) {
            setAvailableSchemes(list);
            setSelectedSchemeId((prev) => {
              if (list.some((s) => s.id === prev)) return prev;
              return list[0].id;
            });
            setSelectedModality((prev) => {
              const matched = list.find((s) => s.id === selectedSchemeId) || list[0];
              return matched ? matched.modality : prev;
            });
          }
        } else {
          setAvailableSchemes(DEFAULT_SCHEMES);
        }
      }, (err) => {
        console.warn('Schemes snapshot listener error:', err);
      });

      return () => unsub();
    } catch (e) {
      console.warn('Failed to bind schemes listener:', e);
    }
  }, []);

  const handleSchemeChange = (schemeId: string) => {
    setSelectedSchemeId(schemeId);
    const found = availableSchemes.find((s) => s.id === schemeId);
    if (found) {
      setSelectedModality(found.modality);
      if (found.modality === 'M') {
        if (!amount || amount === '500' || amount === '1000') {
          setAmount('2000');
        }
      }
    }
  };

  const selectedScheme = availableSchemes.find((s) => s.id === selectedSchemeId) || availableSchemes[0];
  const totalInstallmentsCount = selectedModality === 'W' ? 40 : 10;
  const numericAmount = Number(amount) || 0;
  const projectedTotalSavings = numericAmount * totalInstallmentsCount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const targetAmount = Number(amount) || 0;
    if (type === 'JOIN_SCHEME' && targetAmount <= 0) {
      setError(language === 'EN' ? 'Please enter a valid installment amount' : 'कृपया वैध हप्ता रक्कम प्रविष्ट करा');
      return;
    }

    if ((type === 'LOAN' || type === 'PAYMENT') && targetAmount <= 0) {
      setError(language === 'EN' ? 'Please enter an amount' : 'कृपया रक्कम प्रविष्ट करा');
      return;
    }

    setLoading(true);
    try {
      const now = new Date().toISOString();
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const memberReqDocRef = doc(db, 'member_requests', requestId);
      const requestDocRef = doc(db, 'requests', requestId);

      const resolvedPhone = (customer?.mobile || user?.phoneNumber?.replace('+91', '').trim() || '').replace(/\D/g, '');
      const defaultMessage = type === 'JOIN_SCHEME'
        ? `${selectedScheme?.name || selectedSchemeId} (${selectedModality === 'W' ? 'साप्ताहिक' : 'मासिक'} - ₹${targetAmount}) मध्ये सहभाग अर्ज.`
        : message.trim() || 'अर्ज सादर केला.';

      const newRequestData: Record<string, any> = {
        id: requestId,
        customerId: customer?.id || '',
        customerPhone: resolvedPhone,
        mobile: resolvedPhone,
        customerName: customer?.name || 'खातेदार',
        accountNumber: customer?.accountNumber || '',
        type,
        message: message.trim() || defaultMessage,
        status: 'PENDING',
        officeId: customer?.officeId || 'MAIN',
        createdAt: now,
        updatedAt: now,
      };

      if (type === 'JOIN_SCHEME') {
        newRequestData.schemeId = selectedSchemeId;
        newRequestData.schemeName = selectedScheme?.name || selectedSchemeId;
        newRequestData.modality = selectedModality;
        newRequestData.amount = targetAmount;
        newRequestData.totalInstallments = totalInstallmentsCount;
        newRequestData.payload = {
          schemeId: selectedSchemeId,
          schemeName: selectedScheme?.name || selectedSchemeId,
          modality: selectedModality,
          amount: targetAmount,
          totalInstallments: totalInstallmentsCount,
          startDate: selectedScheme?.startDate || now.split('T')[0],
        };
      } else if (targetAmount > 0) {
        newRequestData.amount = targetAmount;
      }

      if (fcmToken && fcmToken.trim().length > 0) {
        newRequestData.fcmToken = fcmToken.trim();
      }

      await setDoc(memberReqDocRef, newRequestData);
      setDoc(requestDocRef, newRequestData).catch(() => {});
      setSuccess(true);
    } catch (err: any) {
      console.error('Request submission error:', err);
      setError(err.message || (language === 'EN' ? 'Failed to submit request' : 'अर्ज सादर करताना त्रुटी आली'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="p-6 text-center space-y-4 my-auto max-w-md mx-auto pt-16">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-900">
          {language === 'EN' ? 'Request Submitted!' : 'अर्ज यशस्वीपणे सादर झाला!'}
        </h2>
        <p className="text-xs font-bold text-slate-500 max-w-xs mx-auto leading-relaxed">
          {language === 'EN'
            ? 'Your application has been delivered to the Narayan Bhishi admin portal. You will receive an alert once accepted.'
            : 'तुमचा अर्ज नारायण भिशी प्रशासकाकडे पाठवला आहे. प्रशासकाने मान्यता दिल्यावर तुम्हाला थेट सूचना मिळेल.'}
        </p>

        <div className="pt-4">
          <button
            onClick={onSuccess}
            className="w-full py-3.5 rounded-2xl bg-brand-700 hover:bg-brand-800 text-white font-extrabold text-xs shadow-lg shadow-brand-900/20 flex items-center justify-center space-x-2 cursor-pointer"
          >
            <span>{language === 'EN' ? 'Track My Requests' : 'माझे अर्ज पहा'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-2 pt-2">
        <div className="w-9 h-9 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center">
          <PlusCircle className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">
            {language === 'EN' ? 'New Request' : 'नवीन अर्ज (New Request)'}
          </h1>
          <p className="text-[11px] font-bold text-slate-500">
            {language === 'EN' ? 'Select scheme, modality, and amount' : 'भिशी योजना, हप्ता रक्कम व प्रकार निवडून अर्ज करा'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5 space-y-4">
        {/* Type Selector */}
        <div>
          <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
            {language === 'EN' ? 'Select Request Type' : 'अर्जाचा प्रकार निवडा'} <span className="text-rose-500">*</span>
          </label>
          <div className="space-y-2">
            {requestTypes.map((t) => (
              <label
                key={t.id}
                onClick={() => setType(t.id)}
                className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                  type === t.id
                    ? 'border-brand-600 bg-emerald-50/50 shadow-xs'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="requestType"
                    checked={type === t.id}
                    onChange={() => setType(t.id)}
                    className="text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <div className="text-xs font-black text-slate-900">
                      {language === 'EN' ? t.labelEn : t.labelMr}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium">{t.descMr}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* ── Scheme Selection (When JOIN_SCHEME selected) ── */}
        {type === 'JOIN_SCHEME' && (
          <div className="space-y-4 pt-1">
            {/* 1. Bhishi Scheme Dropdown */}
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                {language === 'EN' ? 'Select Bhishi Scheme' : 'भिशी योजना निवडा'} <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedSchemeId}
                onChange={(e) => handleSchemeChange(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 font-extrabold text-sm text-slate-900 focus:border-brand-600 focus:outline-none bg-slate-50/50"
              >
                {availableSchemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.modality === 'W' ? 'साप्ताहिक' : 'मासिक'})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Modality / Frequency Selection */}
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                {language === 'EN' ? 'Payment Frequency' : 'हप्ता वारंवारता / कालावधी'} <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedModality('W')}
                  className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    selectedModality === 'W'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-black shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 font-bold'
                  }`}
                >
                  <div className="text-xs">{language === 'EN' ? 'Weekly' : 'साप्ताहिक'}</div>
                  <div className="text-[10px] text-slate-500 font-medium">४० आठवडे (40 Weeks)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedModality('M')}
                  className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    selectedModality === 'M'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-black shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 font-bold'
                  }`}
                >
                  <div className="text-xs">{language === 'EN' ? 'Monthly' : 'मासिक'}</div>
                  <div className="text-[10px] text-slate-500 font-medium">१० महिने (10 Months)</div>
                </button>
              </div>
            </div>

            {/* 3. Installment Amount Selection */}
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                {language === 'EN' ? 'Installment Amount (₹)' : 'हप्ता रक्कम (₹)'} <span className="text-rose-500">*</span>
              </label>

              {/* Quick Amount Chips */}
              <div className="flex gap-2 mb-2 flex-wrap">
                {(selectedModality === 'W' ? ['500', '1000', '2000', '5000'] : ['1000', '2000', '5000', '10000']).map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmount(amt)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      amount === amt
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    ₹{Number(amt).toLocaleString('en-IN')}
                  </button>
                ))}
              </div>

              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="उदा. १०००"
                required
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 font-black text-base text-slate-900 focus:border-brand-600 focus:outline-none bg-slate-50/50"
              />
            </div>

            {/* Summary Preview Box */}
            {numericAmount > 0 && (
              <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 text-xs space-y-1">
                <div className="flex justify-between items-center text-slate-600 font-medium">
                  <span>{language === 'EN' ? 'Total Installments:' : 'एकूण हप्ते:'}</span>
                  <span className="font-extrabold text-slate-900">
                    {totalInstallmentsCount} {selectedModality === 'W' ? (language === 'EN' ? 'Weeks' : 'आठवडे') : (language === 'EN' ? 'Months' : 'महिने')}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-emerald-200/60 font-black">
                  <span className="text-emerald-800">{language === 'EN' ? 'Total Scheme Deposit:' : 'एकूण भिशी बचत रक्कम:'}</span>
                  <span className="text-base text-emerald-900">
                    ₹{projectedTotalSavings.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Amount for Loan or Payment */}
        {(type === 'LOAN' || type === 'PAYMENT') && (
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              {type === 'LOAN'
                ? language === 'EN' ? 'Requested Loan Amount (₹)' : 'अपेक्षित कर्ज रक्कम (₹)'
                : language === 'EN' ? 'Payment Amount (₹)' : 'भरणा केलेली रक्कम (₹)'}{' '}
              <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="उदा. ५०००"
              required
              className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 font-black text-base text-slate-900 focus:border-brand-600 focus:outline-none bg-slate-50/50"
            />
          </div>
        )}

        {/* Message */}
        <div>
          <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
            {language === 'EN' ? 'Details / Note' : 'अर्जाचा तपशील व संदेश'}
          </label>
          <textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              type === 'JOIN_SCHEME'
                ? language === 'EN'
                  ? 'Add any preference or note for admin (optional)...'
                  : 'प्रशासकासाठी काही विशेष सूचना किंवा नोंद असल्यास लिहा (ऐच्छिक)...'
                : language === 'EN'
                ? 'Explain your request with any transaction id, reason, etc.'
                : 'उदा. UPI द्वारे हप्ता भरला आहे / तातडीने कर्ज हवे आहे...'
            }
            className="w-full p-3.5 rounded-2xl border-2 border-slate-200 text-xs font-bold text-slate-900 focus:border-brand-600 focus:outline-none bg-slate-50/50"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-extrabold text-xs shadow-lg shadow-brand-900/20 flex items-center justify-center space-x-2 transition-all cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span>{loading ? (language === 'EN' ? 'Submitting...' : 'पाठवत आहे...') : (language === 'EN' ? 'Submit Application' : 'अर्ज सादर करा')}</span>
        </button>
      </form>
    </div>
  );
};

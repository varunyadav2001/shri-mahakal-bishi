import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Collection } from '../types';
import { BookOpen, CheckCircle2, ArrowDownLeft, Calendar, FileText, RefreshCw } from 'lucide-react';

export const PassbookScreen: React.FC = () => {
  const { customer } = useAuth();
  const { language } = useLanguage();

  const [collectionsList, setCollectionsList] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.id) return;

    const fetchCollections = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'collections'),
          where('customerId', '==', customer.id),
          orderBy('date', 'desc')
        );
        const snap = await getDocs(q).catch(() => ({ docs: [] } as any));
        if (snap.docs) {
          setCollectionsList(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Collection)));
        }
      } catch (err) {
        console.error('Passbook fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCollections();
  }, [customer?.id]);

  const totalDeposited = collectionsList.reduce((sum, c) => sum + (c.collectedAmount || 0), 0);

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-2 pt-2">
        <div className="w-9 h-9 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center">
          <BookOpen className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">
            {language === 'EN' ? 'Passbook' : 'पासबुक (Passbook)'}
          </h1>
          <p className="text-[11px] font-bold text-slate-500">
            {language === 'EN' ? 'All installment deposit receipts' : 'सर्व जमा हप्त्यांची नोंद व पावत्या'}
          </p>
        </div>
      </div>

      {/* Overview Totals Card */}
      <div className="bg-gradient-to-br from-emerald-800 to-brand-950 p-5 rounded-3xl text-white shadow-lg space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="text-emerald-300 font-bold uppercase tracking-wider">
            {language === 'EN' ? 'Total Deposited' : 'आतापर्यंत एकूण जमा'}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-black">
            {collectionsList.length} {language === 'EN' ? 'Receipts' : 'पावत्या'}
          </span>
        </div>
        <div className="text-3xl font-black text-white tracking-tight">
          ₹{totalDeposited.toLocaleString('en-IN')}
        </div>
        <div className="text-[11px] text-emerald-200 font-medium pt-1 border-t border-emerald-700/50 flex justify-between">
          <span>{language === 'EN' ? 'Account No: ' : 'खाते क्र: '}<strong>#{customer?.accountNumber}</strong></span>
          <span>{customer?.bishiType}</span>
        </div>
      </div>

      {/* Receipts List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-4 space-y-3">
        <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider">
          {language === 'EN' ? 'Deposit History' : 'जमा पावत्यांची यादी'}
        </h2>

        {loading ? (
          <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
            <span className="text-xs font-bold">{language === 'EN' ? 'Loading receipts...' : 'पावत्या लोड होत आहेत...'}</span>
          </div>
        ) : collectionsList.length === 0 ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <FileText className="w-8 h-8 mx-auto text-slate-300" />
            <div className="text-xs font-bold text-slate-500">
              {language === 'EN' ? 'No deposit receipts found yet.' : 'कोणतीही जमा पावती आढळली नाही.'}
            </div>
            <p className="text-[10px] text-slate-400">
              {language === 'EN' ? 'Payments will appear here once recorded by the admin.' : 'प्रशासकाने हप्ता नोंदवल्यावर येथे दिसेल.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {collectionsList.map((c, index) => (
              <div
                key={c.id || index}
                className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-200/80 hover:border-emerald-300 transition-all flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs shrink-0">
                    #{c.periodIndex || index + 1}
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900">
                      {language === 'EN' ? `Installment #${c.periodIndex || index + 1}` : `हप्ता क्र. ${c.periodIndex || index + 1}`}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 flex items-center space-x-1 mt-0.5">
                      <Calendar className="w-3 h-3" />
                      <span>{c.date}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-black text-emerald-700">
                    +₹{(c.collectedAmount || 0).toLocaleString('en-IN')}
                  </div>
                  <span className="inline-flex items-center space-x-0.5 text-[9px] font-extrabold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    <span>{language === 'EN' ? 'Received' : 'पावती पूर्ण'}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

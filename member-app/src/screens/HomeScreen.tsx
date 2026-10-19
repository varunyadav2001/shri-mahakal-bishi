import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { TabType } from '../components/BottomNav';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Installment, Loan, Collection } from '../types';
import {
  CreditCard,
  Calendar,
  Wallet,
  ArrowUpRight,
  ShieldCheck,
  Languages,
  LogOut,
  ChevronRight,
  TrendingUp,
  Receipt,
  Clock,
  Sparkles,
} from 'lucide-react';

interface HomeScreenProps {
  onNavigate: (tab: TabType) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate }) => {
  const { customer, logout } = useAuth();
  const { language, toggleLanguage } = useLanguage();

  const [nextDue, setNextDue] = useState<Installment | null>(null);
  const [activeLoans, setActiveLoans] = useState<Loan[]>([]);
  const [recentCollections, setRecentCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.id || customer?.status === 'CLOSED' || customer?.status === 'DELETED') {
      setNextDue(null);
      setActiveLoans([]);
      setRecentCollections([]);
      setLoading(false);
      return;
    }

    const fetchHomeData = async () => {
      setLoading(true);
      try {
        // 1. Fetch next pending installment
        const instQuery = query(
          collection(db, 'installments'),
          where('customerId', '==', customer.id),
          where('status', '==', 'pending'),
          orderBy('dueDate', 'asc'),
          limit(1)
        );
        const instSnap = await getDocs(instQuery).catch(() => ({ docs: [] } as any));
        if (instSnap.docs && instSnap.docs.length > 0) {
          setNextDue({ id: instSnap.docs[0].id, ...instSnap.docs[0].data() } as Installment);
        } else {
          setNextDue(null);
        }

        // 2. Fetch active loans
        const loanQuery = query(
          collection(db, 'loans'),
          where('customerId', '==', customer.id),
          where('status', '==', 'ACTIVE')
        );
        const loanSnap = await getDocs(loanQuery).catch(() => ({ docs: [] } as any));
        if (loanSnap.docs) {
          setActiveLoans(loanSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Loan)));
        } else {
          setActiveLoans([]);
        }

        // 3. Fetch recent collections
        const collQuery = query(
          collection(db, 'collections'),
          where('customerId', '==', customer.id),
          orderBy('date', 'desc'),
          limit(3)
        );
        const collSnap = await getDocs(collQuery).catch(() => ({ docs: [] } as any));
        if (collSnap.docs) {
          setRecentCollections(collSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Collection)));
        } else {
          setRecentCollections([]);
        }
      } catch (err) {
        console.error('Error fetching home screen data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHomeData();
  }, [customer?.id, customer?.status]);

  const hasActiveBishi = customer && customer.status !== 'CLOSED' && customer.status !== 'DELETED' && customer.accountNumber;
  const totalLoanBalance = activeLoans.reduce((sum, l) => sum + (l.balancePrincipal || 0), 0);

  return (
    <div className="space-y-4 pb-20">
      {/* Top Header */}
      <div className="bg-brand-900 text-white pt-6 pb-8 px-5 rounded-b-[2.5rem] shadow-xl relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center p-1">
              <img src="/logo.svg" alt="Narayan" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="text-[10px] font-bold tracking-wider text-emerald-300 uppercase">श्री महाकाल फायनान्स</div>
              <div className="text-xs font-black">{customer?.name || 'खातेदार'}</div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={toggleLanguage}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold transition-all flex items-center space-x-1"
              title="Change Language"
            >
              <Languages className="w-3.5 h-3.5 text-emerald-300" />
              <span className="text-[11px]">{language === 'MR' ? 'EN' : 'मराठी'}</span>
            </button>
            <button
              onClick={logout}
              className="p-2 rounded-xl bg-white/10 hover:bg-rose-500/30 text-rose-200 transition-all"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Member Master Card */}
        {hasActiveBishi ? (
          <div className="bg-gradient-to-br from-emerald-800 to-brand-950 p-5 rounded-3xl border border-emerald-700/50 shadow-inner relative">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider block">
                  {language === 'EN' ? 'Account Number' : 'खाते क्रमांक'}
                </span>
                <span className="text-2xl font-black text-white tracking-tight">
                  #{customer?.accountNumber}
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-400/20 text-emerald-200 font-black text-[10px] border border-emerald-400/30">
                {customer?.officeId || 'MAIN'} {language === 'EN' ? 'Office' : 'शाखा'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-emerald-700/40 text-xs">
              <div>
                <span className="text-[10px] text-emerald-300 font-bold block">
                  {language === 'EN' ? 'Active Scheme' : 'सुरू भिशी'}
                </span>
                <span className="font-extrabold text-white truncate block">
                  {customer?.bishiType || 'भिशी योजना'}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-emerald-300 font-bold block">
                  {language === 'EN' ? 'Installment' : 'हप्ता रक्कम'}
                </span>
                <span className="font-extrabold text-emerald-100 text-sm">
                  ₹{customer?.amount || 0}{' '}
                  <span className="text-[10px] font-medium text-emerald-300">
                    ({customer?.modality === 'W' ? (language === 'EN' ? 'Wk' : 'साप्ता') : (language === 'EN' ? 'Mo' : 'मासि')})
                  </span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-emerald-950 to-slate-900 p-5 rounded-3xl border border-emerald-800/40 shadow-inner text-center space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-300 flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-white">
                {language === 'EN' ? 'No Active Bishi Scheme' : 'सध्या कोणतीही सक्रिय भिशी योजना नाही'}
              </div>
              <p className="text-[11px] text-emerald-200/80 mt-1">
                {language === 'EN' 
                  ? 'Your account has no active running bishi. You can apply for a new scheme below.'
                  : 'तुमच्या खात्यावर सध्या सुरू असलेली भिशी नाही. नवीन भिशी योजनेसाठी खाली अर्ज करा.'}
              </p>
            </div>
            <button
              onClick={() => onNavigate('NEW_REQUEST')}
              className="px-4 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-brand-950 text-xs font-black transition-all inline-flex items-center space-x-1.5 shadow-md"
            >
              <span>{language === 'EN' ? 'Apply for Bishi' : 'नवीन भिशीसाठी अर्ज करा'}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="px-4 space-y-4 -mt-3">
        {/* Next Due & Loan Balance Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Card 1: Next Due */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-1">
            <div className="w-8 h-8 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-2">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">
              {language === 'EN' ? 'Next Due' : 'पुढील हप्ता'}
            </span>
            <div className="text-lg font-black text-slate-900">
              ₹{nextDue?.amount || customer?.amount || 0}
            </div>
            <div className="text-[10px] font-bold text-amber-700 flex items-center space-x-1">
              <Clock className="w-3 h-3" />
              <span>{nextDue?.dueDate || (language === 'EN' ? 'Upcoming' : 'लवकरच')}</span>
            </div>
          </div>

          {/* Card 2: Loan Balance */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-1">
            <div className="w-8 h-8 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-2">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">
              {language === 'EN' ? 'Loan Balance' : 'कर्ज बाकी'}
            </span>
            <div className="text-lg font-black text-rose-600">
              ₹{totalLoanBalance.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] font-bold text-slate-500">
              {activeLoans.length > 0
                ? `${activeLoans.length} ${language === 'EN' ? 'Active Loans' : 'सुरू कर्जे'}`
                : language === 'EN' ? 'No active loan' : 'कोणतेही कर्ज नाही'}
            </div>
          </div>
        </div>

        {/* Action Shortcuts */}
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs">
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-3">
            {language === 'EN' ? 'Quick Actions' : 'जलद पर्याय'}
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <button
              onClick={() => onNavigate('PASSBOOK')}
              className="p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-brand-800 border border-slate-100 flex flex-col items-center justify-center space-y-1.5 transition-all"
            >
              <Receipt className="w-5 h-5 text-brand-700" />
              <span className="text-[11px] font-extrabold">{language === 'EN' ? 'Passbook' : 'पासबुक'}</span>
            </button>

            <button
              onClick={() => onNavigate('NEW_REQUEST')}
              className="p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-brand-800 border border-slate-100 flex flex-col items-center justify-center space-y-1.5 transition-all"
            >
              <ArrowUpRight className="w-5 h-5 text-emerald-600" />
              <span className="text-[11px] font-extrabold">{language === 'EN' ? 'New Request' : 'नवीन अर्ज'}</span>
            </button>

            <button
              onClick={() => onNavigate('MY_REQUESTS')}
              className="p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-brand-800 border border-slate-100 flex flex-col items-center justify-center space-y-1.5 transition-all"
            >
              <Clock className="w-5 h-5 text-amber-600" />
              <span className="text-[11px] font-extrabold">{language === 'EN' ? 'My Status' : 'अर्जाची स्थिती'}</span>
            </button>
          </div>
        </div>

        {/* Recent Transactions Snippet */}
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
              {language === 'EN' ? 'Recent Payments' : 'नुकतेच जमा हप्ते'}
            </h3>
            <button
              onClick={() => onNavigate('PASSBOOK')}
              className="text-[11px] font-extrabold text-brand-700 hover:underline flex items-center space-x-0.5"
            >
              <span>{language === 'EN' ? 'View All' : 'सर्व पहा'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentCollections.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-xs font-medium">
              {language === 'EN' ? 'No collection receipts found.' : 'कोणतीही पावती उपलब्ध नाही.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentCollections.map((c) => (
                <div key={c.id} className="py-2.5 flex justify-between items-center text-xs">
                  <div>
                    <div className="font-black text-slate-900">
                      {language === 'EN' ? `Installment #${c.periodIndex || 1}` : `हप्ता क्र. ${c.periodIndex || 1}`}
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold">{c.date}</div>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-emerald-700 text-sm">+₹{c.collectedAmount}</span>
                    <div className="text-[9px] font-bold text-slate-400 uppercase">{c.notes || 'जमा'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

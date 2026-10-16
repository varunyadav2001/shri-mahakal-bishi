import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { InAppNotification } from '../types';
import { Bell, CheckCheck, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';

export const NotificationsScreen: React.FC = () => {
  const { customer } = useAuth();
  const { language } = useLanguage();

  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.mobile) return;

    const q = query(
      collection(db, 'notifications'),
      where('recipientPhone', '==', customer.mobile),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as InAppNotification));
        setNotifications(list);
        setLoading(false);
      },
      (err) => {
        console.error('Notifications listener error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [customer?.mobile]);

  const handleMarkAsRead = async (notifId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notifId), {
        read: true,
      });
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const unreadList = notifications.filter((n) => !n.read);
      for (const n of unreadList) {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      }
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center space-x-2">
          <div className="w-9 h-9 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              {language === 'EN' ? 'Notifications' : 'सूचना (Alerts)'}
            </h1>
            <p className="text-[11px] font-bold text-slate-500">
              {unreadCount > 0
                ? `${unreadCount} ${language === 'EN' ? 'new alerts' : 'नवीन सूचना उपलब्ध'}`
                : language === 'EN' ? 'All caught up' : 'सर्व सूचना वाचल्या आहेत'}
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="text-[11px] font-extrabold text-brand-700 hover:text-brand-800 bg-brand-50 px-3 py-1.5 rounded-xl border border-brand-200 transition-all flex items-center space-x-1"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{language === 'EN' ? 'Mark All Read' : 'सर्व वाचले'}</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-2">
          <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
          <span className="text-xs font-bold">{language === 'EN' ? 'Loading alerts...' : 'सूचना लोड होत आहेत...'}</span>
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2 shadow-xs">
          <Sparkles className="w-8 h-8 mx-auto text-emerald-400" />
          <div className="text-xs font-black text-slate-700">
            {language === 'EN' ? 'No notifications yet' : 'कोणतीही सूचना नाही'}
          </div>
          <p className="text-[11px] text-slate-400">
            {language === 'EN' ? 'When the admin reviews your requests, alerts will appear here.' : 'प्रशासनाकडून आलेले संदेश आणि निर्णय येथे दिसतील.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifications.map((notif) => {
            const isUnread = !notif.read;
            const title = language === 'MR' ? (notif.titleMr || notif.title) : notif.title;
            const msg = language === 'MR' ? (notif.messageMr || notif.message) : notif.message;

            return (
              <div
                key={notif.id}
                onClick={() => isUnread && handleMarkAsRead(notif.id)}
                className={`p-4 rounded-3xl border transition-all cursor-pointer ${
                  isUnread
                    ? 'bg-emerald-50/60 border-emerald-300 shadow-xs'
                    : 'bg-white border-slate-200 opacity-80'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center space-x-1.5">
                    {isUnread && (
                      <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block animate-ping" />
                    )}
                    <h3 className="text-xs font-black text-slate-900">{title}</h3>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400">
                    {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString() : ''}
                  </span>
                </div>

                <p className="text-[11px] font-medium text-slate-600 leading-relaxed mt-1">
                  {msg}
                </p>

                {isUnread && (
                  <div className="mt-2 text-right">
                    <span className="text-[10px] font-extrabold text-brand-700 hover:underline">
                      {language === 'EN' ? 'Tap to mark as read' : 'वाचल्याचे चिन्हांकित करा'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

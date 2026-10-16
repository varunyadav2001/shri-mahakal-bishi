import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import { BottomNav, TabType } from './components/BottomNav';
import { LoginScreen } from './screens/LoginScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PassbookScreen } from './screens/PassbookScreen';
import { NewRequestScreen } from './screens/NewRequestScreen';
import { MyRequestsScreen } from './screens/MyRequestsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase/config';
import { RefreshCw } from 'lucide-react';

export const MainApp: React.FC = () => {
  const { user, loading, customer } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabType>('HOME');
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Real-time unread notification badge listener
  useEffect(() => {
    if (!customer?.mobile) return;

    const q = query(
      collection(db, 'notifications'),
      where('recipientPhone', '==', customer.mobile),
      where('read', '==', false)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setUnreadCount(snap.size);
    });

    return () => unsubscribe();
  }, [customer?.mobile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-3">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
        <span className="text-xs font-bold text-emerald-200">नारायण भिशी लोड होत आहे...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 max-w-md mx-auto relative shadow-2xl">
      {/* Screen Render */}
      <main className="min-h-[calc(100vh-64px)]">
        {currentTab === 'HOME' && <HomeScreen onNavigate={(tab) => setCurrentTab(tab)} />}
        {currentTab === 'PASSBOOK' && <PassbookScreen />}
        {currentTab === 'NEW_REQUEST' && (
          <NewRequestScreen onSuccess={() => setCurrentTab('MY_REQUESTS')} />
        )}
        {currentTab === 'MY_REQUESTS' && <MyRequestsScreen />}
        {currentTab === 'NOTIFICATIONS' && <NotificationsScreen />}
      </main>

      {/* Persistent Bottom Nav Bar */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        unreadCount={unreadCount}
      />
    </div>
  );
};

export default MainApp;

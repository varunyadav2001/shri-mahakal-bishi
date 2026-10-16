import React from 'react';
import { Home, BookOpen, PlusCircle, Clock, Bell } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type TabType = 'HOME' | 'PASSBOOK' | 'NEW_REQUEST' | 'MY_REQUESTS' | 'NOTIFICATIONS';

interface BottomNavProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  unreadCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab, unreadCount = 0 }) => {
  const { language } = useLanguage();

  const navItems = [
    {
      id: 'HOME' as TabType,
      label: language === 'EN' ? 'Home' : 'मुख्य पान',
      icon: Home,
    },
    {
      id: 'PASSBOOK' as TabType,
      label: language === 'EN' ? 'Passbook' : 'पासबुक',
      icon: BookOpen,
    },
    {
      id: 'NEW_REQUEST' as TabType,
      label: language === 'EN' ? 'New Request' : 'नवीन अर्ज',
      icon: PlusCircle,
    },
    {
      id: 'MY_REQUESTS' as TabType,
      label: language === 'EN' ? 'Requests' : 'माझे अर्ज',
      icon: Clock,
    },
    {
      id: 'NOTIFICATIONS' as TabType,
      label: language === 'EN' ? 'Alerts' : 'सूचना',
      icon: Bell,
      badge: unreadCount,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-2 py-2 flex justify-around items-center z-50">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = currentTab === item.id;

        return (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            className={`relative flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all rounded-xl ${
              isActive ? 'text-brand-700 font-extrabold scale-105' : 'text-slate-400 font-medium hover:text-slate-600'
            }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 bg-rose-600 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-white animate-pulse">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] tracking-tight mt-1 truncate max-w-[64px]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

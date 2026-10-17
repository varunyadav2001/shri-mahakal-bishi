import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  Users,
  Wallet,
  Calendar,
  Landmark,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  HardDrive,
  UserCheck,
  Settings,
  LogOut,
  Inbox,
  X,
  ClipboardList,
  Gift,
  Share2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLogoutClick: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onLogoutClick }) => {
  const { currentAdmin } = useAuth();
  const { t, language, pendingRequestsCount } = useApp();

  const menuItems = [
    { label: t.navDashboard, icon: Home, path: '/dashboard' },
    { label: t.navCustomers, icon: Users, path: '/customers' },
    { label: t.navCollections, icon: Wallet, path: '/collections' },
    { label: t.navBishi, icon: Calendar, path: '/bishi' },
    { label: t.navPayouts || (language === 'EN' ? 'Payouts (20% Return)' : 'पेआउट्स (२०% परतावा)'), icon: Gift, path: '/payouts' },
    { label: t.navReferrals || (language === 'EN' ? 'Referrals (10% Comm.)' : 'रेफरल (१०% कमिशन)'), icon: Share2, path: '/referrals' },
    { label: t.navLoans, icon: Landmark, path: '/loans' },
    { label: t.navInterest, icon: TrendingUp, path: '/interest' },
    { label: t.navPenalty, icon: AlertTriangle, path: '/penalty' },
    {
      label: t.navRequests || (language === 'EN' ? 'Member Requests' : 'सदस्य अर्ज'),
      icon: Inbox,
      path: '/requests',
      badge: pendingRequestsCount,
    },
    { label: t.navThakbaki, icon: ClipboardList, path: '/thakbaki' },
    { label: t.navReports, icon: BarChart3, path: '/reports' },
    { label: t.navBackup, icon: HardDrive, path: '/backup' },
    { label: t.navProfile, icon: UserCheck, path: '/profile' },
    { label: t.navSettings, icon: Settings, path: '/settings' },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden no-print backdrop-blur-xs"
          onClick={onClose}
        />
      )}

      {/* Slate 900 Fintech Sidebar (#0F172A) */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-64 bg-[#0F172A] text-white z-40 transition-transform duration-300 ease-in-out flex flex-col no-print border-r border-slate-800 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header Branding - Official Brand Emblem */}
        <div className="h-16 lg:h-18 px-5 flex items-center justify-between border-b border-white/10 shrink-0">
          <div className="flex items-center space-x-3 group cursor-pointer">
            <img
              src="/logo.png"
              alt="Narayan Bhishi Logo"
              className="w-10 h-10 rounded-xl object-cover shadow-md border border-amber-400/40 flex-shrink-0 group-hover:scale-105 transition-transform duration-200"
            />
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-[#ffffff] !text-white tracking-tight leading-tight group-hover:text-cyan-200 transition-colors">
                {t.appName}
              </h1>
              <span className="text-[9px] tracking-widest text-[#06B6D4] font-bold block uppercase">
                {t.trustSecurity}
              </span>
            </div>
          </div>

          {/* Mobile Drawer Close Button (< 1024px) */}
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors lg:hidden cursor-pointer touch-target"
            aria-label={language === 'EN' ? 'Close menu' : 'मेनू बंद करा'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 space-y-0.5 sm:space-y-1 overflow-y-auto no-scrollbar">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) =>
                  `group flex items-center justify-between px-3.5 py-2 min-h-[44px] lg:min-h-[38px] rounded-[10px] text-sm font-bold transition-all duration-200 ease-out ${
                    isActive
                      ? 'bg-blue-600/30 text-white font-extrabold shadow-sm border-l-4 border-[#06B6D4] pl-2.5'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white hover:translate-x-1.5 hover:shadow-xs'
                  }`
                }
              >
                <div className="flex items-center space-x-3">
                  <Icon className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 group-hover:text-cyan-300" />
                  <span className="transition-colors duration-200">{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-500 text-white shadow-xs animate-pulse">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Logout Button */}
        <div className="p-3 sm:p-4 border-t border-white/10 shrink-0">
          <button
            onClick={() => {
              onClose();
              onLogoutClick();
            }}
            className="group w-full flex items-center space-x-3 px-3.5 py-2 min-h-[44px] lg:min-h-[38px] rounded-[10px] text-sm font-bold text-rose-300 hover:bg-rose-900/40 hover:text-white hover:translate-x-1.5 transition-all duration-200 ease-out cursor-pointer"
          >
            <LogOut className="w-5 h-5 flex-shrink-0 text-rose-300 group-hover:text-rose-200 group-hover:scale-110 group-hover:-rotate-6 transition-transform duration-200" />
            <span>{t.navLogout}</span>
          </button>
        </div>
      </aside>
    </>
  );
};

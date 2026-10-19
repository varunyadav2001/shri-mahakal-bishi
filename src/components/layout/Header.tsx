import React, { useState } from 'react';
import { Menu, Calendar as CalendarIcon, User, Globe, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { formatDateMarathi } from '../../utils/formatters';
import { Language } from '../../utils/translations';
import { useNavigate } from 'react-router-dom';
import { QuickAddModal } from '../common/QuickAddModal';
import { CustomDropdown } from '../common/CustomDropdown';

interface HeaderProps {
  onMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const { currentAdmin, logout } = useAuth();
  const { language, setLanguage, t } = useApp();
  const navigate = useNavigate();

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];

  const rawAdminName = currentAdmin?.name || t.adminDefault;
  const isDefaultOrOldName =
    !rawAdminName ||
    rawAdminName.includes('नारायण') ||
    rawAdminName.includes('भिषी') ||
    rawAdminName.includes('भिशी') ||
    rawAdminName.toLowerCase().includes('narayan');
  const adminDisplayName = isDefaultOrOldName
    ? (language === 'EN' ? 'Shri Mahakal Finance Admin' : 'श्री महाकाल फायनान्स व्यवस्थापक')
    : rawAdminName;

  return (
    <header className="h-16 sm:h-20 bg-white border-b border-[#E2E8F0] sticky top-0 z-30 px-3 sm:px-8 flex items-center justify-between no-print gap-2 shadow-2xs">
      <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
        <button
          onClick={onMenuToggle}
          className="p-2 min-w-[44px] min-h-[44px] rounded-xl text-[#0F172A] hover:bg-blue-50 hover:text-[#2563EB] hover:scale-105 active:scale-95 transition-all duration-150 lg:hidden flex-shrink-0 cursor-pointer flex items-center justify-center touch-target"
          aria-label={language === 'EN' ? 'Open menu' : 'मेनू उघडा'}
        >
          <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        <img
          src="/logo.png"
          alt="Shri Mahakal Finance"
          className="w-8 h-8 rounded-lg object-cover border border-amber-400/40 lg:hidden flex-shrink-0 shadow-2xs"
        />

        {/* Welcome Greeting with Accent Blue Vertical Bar */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <div className="w-1.5 h-5 sm:h-8 bg-[#2563EB] rounded-full flex-shrink-0"></div>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-xl font-black text-[#0F172A] tracking-tight truncate">
              <span className="sm:hidden">{adminDisplayName || t.appName}</span>
              <span className="hidden sm:inline">{t.welcomeGreeting} {adminDisplayName}</span>
            </h2>
            <div className="hidden sm:flex items-center space-x-1 text-xs text-[#64748B] font-bold">
              <CalendarIcon className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />
              <span className="truncate">{formatDateMarathi(todayStr, language)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Controls: Language Selector + Profile */}
      <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
        {/* Language Selector Switcher Pill - Compact on mobile screens */}
        <div className="hidden min-[440px]:block w-24 sm:w-36">
          <CustomDropdown<Language>
            value={language}
            onChange={(val) => setLanguage(val)}
            options={[
              { value: 'MR', label: 'मराठी' },
              { value: 'EN', label: 'English' },
            ]}
            prefixIcon={<Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#2563EB]" />}
            size="sm"
            triggerClassName="h-9 sm:h-10 bg-[#F8FAFC]"
          />
        </div>

        {/* User Profile Avatar Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="h-9 sm:h-10 min-h-[44px] min-w-[44px] px-2 sm:px-2.5 rounded-xl bg-white text-[#2563EB] flex items-center justify-center space-x-1 border border-[#E2E8F0] shadow-2xs hover:border-[#2563EB] hover:bg-blue-50 hover:scale-[1.02] active:scale-[0.98] transition-all flex-shrink-0 cursor-pointer touch-target"
          >
            {currentAdmin?.photoURL ? (
              <img
                src={currentAdmin.photoURL}
                alt={currentAdmin.name}
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-full object-cover"
              />
            ) : (
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-blue-100 flex items-center justify-center text-[#2563EB]">
                <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#2563EB]" />
              </div>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {isProfileMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-[#E2E8F0] p-2 z-50 animate-in fade-in zoom-in duration-100">
              {/* Language Switcher for compact screens */}
              <div className="min-[440px]:hidden p-2 mb-1 bg-slate-50 rounded-xl border border-[#E2E8F0] flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600">भाषा:</span>
                <button
                  onClick={() => setLanguage(language === 'MR' ? 'EN' : 'MR')}
                  className="px-2 py-1 rounded-lg bg-blue-100 text-blue-900 text-xs font-black"
                >
                  {language === 'MR' ? 'मराठी (Switch EN)' : 'English (मराठी)'}
                </button>
              </div>
              <button
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  navigate('/profile');
                }}
                className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-extrabold text-[#0F172A] hover:bg-blue-50 hover:text-[#2563EB] hover:translate-x-1 transition-all cursor-pointer"
              >
                {t.profileMenu}
              </button>
              <button
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  logout();
                }}
                className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-extrabold text-[#C4525B] hover:bg-rose-50 hover:translate-x-1 transition-all cursor-pointer"
              >
                {t.logoutMenu}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

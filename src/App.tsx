import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import { AutoBackupService } from './services/backup';
import { brandConfig } from './config/brand';

import { SplashScreen } from './components/common/SplashScreen';
import { LoginRegister } from './pages/Auth/LoginRegister';
import { Dashboard } from './pages/Dashboard';
import { CustomerList } from './pages/Customers/CustomerList';
import { CustomerDetail } from './pages/Customers/CustomerDetail';
import { CollectionManager } from './pages/Collections/CollectionManager';
import { BishiManager } from './pages/Bishi/BishiManager';
import { LoanManager } from './pages/Loans/LoanManager';
import { InterestManager } from './pages/Interest/InterestManager';
import { PenaltyManager } from './pages/Penalty/PenaltyManager';
import { ReportManager } from './pages/Reports/ReportManager';
import { RequestsManager } from './pages/Requests/RequestsManager';
import { PayoutManager } from './pages/Payouts/PayoutManager';
import { ReferralManager } from './pages/Referrals/ReferralManager';
import { BackupManager } from './pages/Backup/BackupManager';
import { ProfileManager } from './pages/Profile/ProfileManager';
import { SettingsManager } from './pages/Settings/SettingsManager';
import { ThakbakiManager } from './pages/Thakbaki/ThakbakiManager';

import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { BottomNav } from './components/layout/BottomNav';
import { ToastContainer } from './components/common/ToastContainer';
import { ConfirmModal } from './components/common/ConfirmModal';

const ProtectedLayout: React.FC = () => {
  const { currentAdmin, logout } = useAuth();
  const { showToast, language } = useApp();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const location = useLocation();

  // Automatic Daily Website-Opening & 11:00 PM Backup Runner (Local + Google Drive Cloud)
  useEffect(() => {
    if (!currentAdmin) return;

    const performScheduledCheck = async () => {
      try {
        // 1. Sync latest cloud backup metadata from Firestore first
        await AutoBackupService.fetchCloudBackupMetadata().catch((err) => {
          console.warn('[App] fetchCloudBackupMetadata error:', err);
        });

        // 2. Check and run Opening backup of the day
        const ranFirstOpen = await AutoBackupService.checkAndRunFirstOpenBackup((snapshot, filename) => {
          showToast(
            language === 'EN'
              ? `Daily website-opening backup saved: ${filename}`
              : `वेबसाइट उघडतानाचा दैनंदिन बॅकअप सेव्ह झाला: ${filename}`,
            'success'
          );
        });

        // 3. Run scheduled 11 PM check if first-open didn't just run
        if (!ranFirstOpen) {
          AutoBackupService.checkAndRunAutoBackup((snapshot, filename) => {
            showToast(
              language === 'EN'
                ? `Daily 11:00 PM backup saved: ${filename}`
                : `दररोज रात्री ११:०० वा. चा स्वयंचलित बॅकअप सेव्ह झाला: ${filename}`,
              'success'
            );
          });
        }
      } catch (err) {
        console.error('[App] performScheduledCheck failed:', err);
      }
    };

    const timeoutId = setTimeout(performScheduledCheck, 1800);
    const intervalId = setInterval(performScheduledCheck, 60 * 1000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [currentAdmin, language, showToast]);

  if (!currentAdmin) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-[#F4F6F5] flex flex-col lg:flex-row">
      {/* Dark Forest Green Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLogoutClick={() => setIsLogoutModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0 bg-[#F4F6F5]">
        <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} />
        <main className="flex-1 p-3 sm:p-6 pb-20 lg:pb-6 max-w-[1600px] w-full mx-auto bg-[#F4F6F5] min-w-0 overflow-x-hidden">
          <div key={location.pathname} className="animate-page-enter">
            <Routes location={location}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/customers" element={<CustomerList />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/collections" element={<CollectionManager />} />
              <Route path="/bishi" element={<BishiManager />} />
              <Route path="/payouts" element={<PayoutManager />} />
              <Route path="/referrals" element={<ReferralManager />} />
              <Route path="/loans" element={<LoanManager />} />
              <Route path="/interest" element={<InterestManager />} />
              <Route path="/penalty" element={<PenaltyManager />} />
              <Route path="/requests" element={<RequestsManager />} />
              <Route path="/thakbaki" element={<ThakbakiManager />} />
              <Route path="/reports" element={<ReportManager />} />
              <Route path="/backup" element={<BackupManager />} />
              <Route path="/profile" element={<ProfileManager />} />
              <Route path="/settings" element={<SettingsManager />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Visible only on <1024px) */}
      <BottomNav onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} />

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Logout Confirmation Modal */}
      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title={language === 'EN' ? 'Logout' : 'बाहेर पडा'}
        message={language === 'EN' ? 'Are you sure you want to log out?' : 'तुम्हाला बाहेर पडायचे आहे का?'}
        confirmText={language === 'EN' ? 'Logout' : 'बाहेर पडा'}
        cancelText={language === 'EN' ? 'Cancel' : 'रद्द करा'}
        isDanger={true}
        onConfirm={() => {
          logout();
          setIsLogoutModalOpen(false);
        }}
        onCancel={() => setIsLogoutModalOpen(false)}
      />
    </div>
  );
};

export const AppContent: React.FC = () => {
  const { currentAdmin, loading } = useAuth();
  const { language } = useApp();
  const [showSplash, setShowSplash] = useState(true);

  const brandName = brandConfig.name[language] || brandConfig.name.MR;
  const brandTagline = brandConfig.tagline[language] || brandConfig.tagline.MR;

  if (showSplash) {
    return (
      <SplashScreen
        appName={brandName}
        tagline={brandTagline}
        onFinish={() => setShowSplash(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center font-bold text-base gap-3">
        <div className="w-10 h-10 border-2 border-amber-500/30 border-t-amber-400 rounded-full animate-spin" />
        <span className="text-sm tracking-wide text-amber-200/90 font-medium">
          {language === 'EN' ? `Loading ${brandName}...` : `${brandName} लोड होत आहे...`}
        </span>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={currentAdmin ? <Navigate to="/dashboard" replace /> : <LoginRegister />}
      />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

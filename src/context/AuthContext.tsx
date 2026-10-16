import React, { createContext, useContext, useState, useEffect } from 'react';
import { Admin } from '../types';
import { StorageService } from '../services/db';
import { AuditService } from '../services/audit';

interface AuthContextType {
  currentAdmin: Admin | null;
  hasAdminRegistered: boolean;
  login: (identifier: string, pass: string) => Promise<boolean>;
  registerAdmin: (data: Omit<Admin, 'id' | 'createdAt'> & { password: string }) => Promise<Admin>;
  updateAdminProfile: (updates: Partial<Admin>) => Promise<Admin>;
  changePassword: (newPassword: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentAdmin, setCurrentAdmin] = useState<Admin | null>(null);
  const [hasAdminRegistered, setHasAdminRegistered] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkAdminState = () => {
      setHasAdminRegistered(true);

      const savedAdminSession = localStorage.getItem('nb_active_session');
      if (savedAdminSession) {
        try {
          const adminObj = JSON.parse(savedAdminSession);
          setCurrentAdmin(adminObj);
        } catch {
          localStorage.removeItem('nb_active_session');
        }
      }
      setLoading(false);
    };

    checkAdminState();
  }, []);

  const login = async (identifier: string, pass: string): Promise<boolean> => {
    const admins = StorageService.getAdmins();
    const cleanInput = identifier.trim().toLowerCase();
    const cleanPass = pass.trim();

    const primaryAdmin = admins[0] || {
      id: 'admin_primary',
      name: 'नारायण भिशी व्यवस्थापक',
      mobile: '9876543210',
      email: 'admin@narayanbishi.com',
      role: 'SUPER_ADMIN',
    };

    // Match identifier against mobile, email, or shorthand identifiers
    const isMatchedIdentifier =
      cleanInput === 'admin' ||
      cleanInput === 'admin_primary' ||
      cleanInput === 'narayan' ||
      cleanInput === '9876543210' ||
      cleanInput === 'admin@narayanbishi.com' ||
      cleanInput === 'narayan@gmail.com' ||
      admins.some(
        (a) =>
          String(a.mobile || '').trim() === identifier.trim() ||
          (a.email && a.email.trim().toLowerCase() === cleanInput)
      );

    const storedPass = localStorage.getItem('nb_admin_pass') || (admins[0] as any)?.password || 'admin';

    // Password matches if it equals storedPass OR either default password ('admin' or '123456')
    const isPasswordValid =
      cleanPass === storedPass ||
      cleanPass === 'admin' ||
      cleanPass === '123456';

    if (isMatchedIdentifier && isPasswordValid) {
      const matched = admins.find(
        (a) =>
          String(a.mobile || '').trim() === identifier.trim() ||
          (a.email && a.email.trim().toLowerCase() === cleanInput)
      ) || primaryAdmin;

      setCurrentAdmin(matched);
      localStorage.setItem('nb_active_session', JSON.stringify(matched));
      localStorage.setItem('nb_admin_pass', cleanPass);

      AuditService.record({
        action: 'LOGIN',
        entityType: 'SETTINGS',
        entityId: matched.id,
        adminName: matched.name,
        details: `Admin ${matched.name} (${matched.mobile}) logged in successfully`,
      });

      return true;
    }
    return false;
  };

  const registerAdmin = async (
    _data: Omit<Admin, 'id' | 'createdAt'> & { password: string }
  ): Promise<Admin> => {
    throw new Error('नवीन प्रशासक नोंदणी बंद करण्यात आलेली आहे. कृपया थेट लॉगिन करा.');
  };

  const updateAdminProfile = async (updates: Partial<Admin>): Promise<Admin> => {
    if (!currentAdmin) throw new Error('कोणताही प्रशासक लॉगिन नाही.');
    const updated = StorageService.updateAdmin(currentAdmin.id, updates);
    setCurrentAdmin(updated);
    localStorage.setItem('nb_active_session', JSON.stringify(updated));

    AuditService.record({
      action: 'UPDATE',
      entityType: 'SETTINGS',
      entityId: currentAdmin.id,
      adminName: currentAdmin.name,
      details: `Admin updated profile: ${JSON.stringify(updates)}`,
    });

    return updated;
  };

  const changePassword = async (newPassword: string): Promise<boolean> => {
    if (!newPassword || newPassword.trim().length < 4) {
      throw new Error('नवीन पासवर्ड किमान ४ अक्षरांचा असावा.');
    }
    await StorageService.updateAdminPassword(newPassword.trim());

    if (currentAdmin) {
      AuditService.record({
        action: 'UPDATE',
        entityType: 'SETTINGS',
        entityId: currentAdmin.id,
        adminName: currentAdmin.name,
        details: 'Admin changed password',
      });
    }

    return true;
  };

  const logout = () => {
    if (currentAdmin) {
      AuditService.record({
        action: 'UPDATE',
        entityType: 'SETTINGS',
        entityId: currentAdmin.id,
        adminName: currentAdmin.name,
        details: `Admin ${currentAdmin.name} logged out`,
      });
    }
    setCurrentAdmin(null);
    localStorage.removeItem('nb_active_session');
  };

  return (
    <AuthContext.Provider
      value={{
        currentAdmin,
        hasAdminRegistered,
        login,
        registerAdmin,
        updateAdminProfile,
        changePassword,
        logout,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

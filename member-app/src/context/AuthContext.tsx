import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  User,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { auth, db, requestFCMToken } from '../firebase/config';
import { Customer } from '../types';

interface AuthContextType {
  user: User | null;
  customer: Customer | null;
  loading: boolean;
  fcmToken?: string;
  sendOTP: (phone10: string) => Promise<boolean>;
  verifyOTP: (otp: string) => Promise<boolean>;
  logout: () => Promise<void>;
  resetOTP: () => void;
  confirmationResult: ConfirmationResult | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  customer: null,
  loading: true,
  sendOTP: async () => false,
  verifyOTP: async () => false,
  resetOTP: () => {},
  logout: async () => {},
  confirmationResult: null,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [recaptchaVerifier, setRecaptchaVerifier] = useState<RecaptchaVerifier | null>(null);
  const [fcmToken, setFcmToken] = useState<string | undefined>(undefined);

  // Initialize Recaptcha
  useEffect(() => {
    try {
      if (!recaptchaVerifier) {
        const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
          callback: () => {
            // reCAPTCHA solved
          },
        });
        setRecaptchaVerifier(verifier);
      }
    } catch (e) {
      console.warn('Recaptcha init note:', e);
    }
  }, []);

  // Request FCM token on login
  useEffect(() => {
    if (user) {
      requestFCMToken().then((token) => {
        if (token) setFcmToken(token);
      });
    }
  }, [user]);

  // Auth State Listener & Customer Binding
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser && currentUser.phoneNumber) {
        const rawPhone = currentUser.phoneNumber.replace('+91', '').trim();
        await fetchCustomerForPhone(rawPhone, currentUser.phoneNumber);
      } else {
        setCustomer(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const fetchCustomerForPhone = async (phone10: string, fullPhone: string) => {
    try {
      const q1 = query(collection(db, 'customers'), where('mobile', '==', phone10));
      let snap = await getDocs(q1);

      if (snap.empty) {
        const q2 = query(collection(db, 'customers'), where('mobile', '==', fullPhone));
        snap = await getDocs(q2);
      }

      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const custData = { id: docSnap.id, ...docSnap.data() } as Customer;
        setCustomer(custData);

        // Realtime sync for customer doc
        onSnapshot(doc(db, 'customers', docSnap.id), (updatedSnap) => {
          if (updatedSnap.exists()) {
            setCustomer({ id: updatedSnap.id, ...updatedSnap.data() } as Customer);
          }
        });
      } else {
        // Fallback placeholder record if user just joined and not yet assigned an account
        setCustomer({
          id: 'cust_' + phone10,
          accountNumber: 'नवीन',
          name: 'खातेदार',
          mobile: phone10,
          officeId: 'MAIN',
          bishiType: 'GENERAL',
          amount: 0,
          modality: 'M',
          status: 'PENDING_REGISTRATION',
        });
      }
    } catch (err) {
      console.error('Error fetching customer record:', err);
    }
  };

  const sendOTP = async (phone10: string): Promise<boolean> => {
    try {
      const formatted = `+91${phone10.trim()}`;
      let verifier = recaptchaVerifier;
      if (!verifier) {
        verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
        });
        setRecaptchaVerifier(verifier);
      }

      const confirmation = await signInWithPhoneNumber(auth, formatted, verifier);
      setConfirmationResult(confirmation);
      return true;
    } catch (err: any) {
      console.error('Phone auth error:', err);
      // Reset reCAPTCHA on error
      if (recaptchaVerifier) {
        recaptchaVerifier.clear();
      }
      throw err;
    }
  };

  const verifyOTP = async (otp: string): Promise<boolean> => {
    if (!confirmationResult) return false;
    try {
      const credential = await confirmationResult.confirm(otp);
      setUser(credential.user);
      return true;
    } catch (err) {
      console.error('OTP verification error:', err);
      throw err;
    }
  };

  const resetOTP = () => {
    setConfirmationResult(null);
  };

  const logout = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setCustomer(null);
    setConfirmationResult(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        customer,
        loading,
        fcmToken,
        sendOTP,
        verifyOTP,
        resetOTP,
        logout,
        confirmationResult,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

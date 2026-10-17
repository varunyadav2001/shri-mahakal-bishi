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
    let customerUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (customerUnsub) {
        customerUnsub();
        customerUnsub = null;
      }

      if (currentUser && currentUser.phoneNumber) {
        const rawPhone = currentUser.phoneNumber.replace('+91', '').trim();
        customerUnsub = bindCustomerRealtime(rawPhone, currentUser.phoneNumber);
      } else {
        setCustomer(null);
      }
      setLoading(false);
    });

    return () => {
      if (customerUnsub) customerUnsub();
      unsubscribe();
    };
  }, []);

  const bindCustomerRealtime = (phone10: string, fullPhone: string) => {
    try {
      const q1 = query(collection(db, 'customers'), where('mobile', '==', phone10));
      return onSnapshot(
        q1,
        (snap) => {
          if (!snap.empty) {
            // Find active customer doc if multiple exist
            const activeDocs = snap.docs.filter((d) => {
              const data = d.data();
              return data.status !== 'CLOSED' && data.status !== 'DELETED';
            });

            if (activeDocs.length > 0) {
              const docSnap = activeDocs[0];
              setCustomer({ id: docSnap.id, ...docSnap.data() } as Customer);
            } else {
              // All matching docs were closed or marked deleted
              setCustomer(null);
            }
          } else {
            // Query 2: Try full phone number with country code
            const q2 = query(collection(db, 'customers'), where('mobile', '==', fullPhone));
            getDocs(q2).then((snap2) => {
              if (!snap2.empty) {
                const activeDocs2 = snap2.docs.filter((d) => {
                  const data = d.data();
                  return data.status !== 'CLOSED' && data.status !== 'DELETED';
                });
                if (activeDocs2.length > 0) {
                  const docSnap2 = activeDocs2[0];
                  setCustomer({ id: docSnap2.id, ...docSnap2.data() } as Customer);
                  return;
                }
              }
              // Completely deleted by admin!
              setCustomer(null);
            }).catch(() => {
              setCustomer(null);
            });
          }
        },
        (err) => {
          console.warn('Realtime customer listener error:', err);
          setCustomer(null);
        }
      );
    } catch (err) {
      console.error('Error binding customer listener:', err);
      setCustomer(null);
      return () => {};
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

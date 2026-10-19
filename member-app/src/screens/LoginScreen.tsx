import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Phone, Lock, ArrowRight, ShieldCheck, RefreshCw, Languages } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { sendOTP, verifyOTP, confirmationResult, resetOTP } = useAuth();
  const { language, toggleLanguage } = useLanguage();

  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mobile.length !== 10 || !/^\d{10}$/.test(mobile)) {
      setError(language === 'EN' ? 'Please enter a valid 10-digit mobile number' : 'कृपया १० अंकी वैध मोबाईल नंबर प्रविष्ट करा');
      return;
    }

    setLoading(true);
    try {
      await sendOTP(mobile);
    } catch (err: any) {
      console.error(err);
      setError(err.message || (language === 'EN' ? 'Failed to send OTP. Please try again.' : 'OTP पाठवण्यात त्रुटी आली. कृपया पुन्हा प्रयत्न करा.'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (otp.length < 6) {
      setError(language === 'EN' ? 'Please enter 6-digit OTP' : 'कृपया ६ अंकी OTP टाका');
      return;
    }

    setLoading(true);
    try {
      await verifyOTP(otp);
    } catch (err: any) {
      console.error(err);
      setError(language === 'EN' ? 'Invalid OTP. Please check and try again.' : 'चुकीचा OTP. कृपया पुन्हा तपासा.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-900 via-brand-950 to-slate-950 flex flex-col justify-between p-4 sm:p-6 text-white max-w-md mx-auto">
      {/* Top Bar with Language Toggle */}
      <div className="flex justify-between items-center pt-2">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <span className="text-xs font-black tracking-wider text-emerald-200">SHRI MAHAKAL FINANCE</span>
        </div>
        <button
          onClick={toggleLanguage}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold transition-all border border-white/10"
        >
          <Languages className="w-3.5 h-3.5 text-emerald-300" />
          <span>{language === 'MR' ? 'English' : 'मराठी'}</span>
        </button>
      </div>

      {/* Main Container */}
      <div className="my-auto py-8">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-emerald-500/20 border-2 border-emerald-400/40 rounded-3xl mx-auto flex items-center justify-center mb-4 shadow-xl shadow-emerald-950/50 backdrop-blur-sm p-3">
            <img src="/logo.svg" alt="Shri Mahakal Finance" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-1.5">श्री महाकाल फायनान्स</h1>
          <p className="text-xs font-bold text-emerald-300 tracking-wide uppercase">
            {language === 'EN' ? 'Member Portal & Passbook' : 'खातेदार सदस्य पोर्टल व पासबुक'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-7 text-slate-900 shadow-2xl">
          {error && (
            <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700 leading-snug">
              {error}
            </div>
          )}

          {!confirmationResult ? (
            /* Step 1: Mobile Form */
            <form onSubmit={handleSendOTP} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-2">
                  {language === 'EN' ? 'Enter Mobile Number' : 'मोबाईल क्रमांक प्रविष्ट करा'}
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center space-x-1 text-slate-400">
                    <Phone className="w-4 h-4 text-emerald-700" />
                    <span className="text-xs font-bold text-slate-500 pl-1 border-r border-slate-300 pr-2">+91</span>
                  </div>
                  <input
                    type="tel"
                    maxLength={10}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                    placeholder="9876543210"
                    required
                    className="w-full pl-24 pr-4 py-3.5 rounded-2xl border-2 border-slate-200 font-extrabold text-slate-900 focus:border-brand-600 focus:outline-none text-base tracking-wider bg-slate-50/50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || mobile.length !== 10}
                className="w-full py-3.5 rounded-2xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center space-x-2 transition-all shadow-lg shadow-brand-900/20 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{language === 'EN' ? 'Sending OTP...' : 'OTP पाठवत आहे...'}</span>
                  </>
                ) : (
                  <>
                    <span>{language === 'EN' ? 'Send OTP' : 'OTP मिळवा'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            /* Step 2: OTP Verification */
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-extrabold text-slate-700">
                    {language === 'EN' ? 'Enter 6-Digit OTP' : '६ अंकी OTP प्रविष्ट करा'}
                  </label>
                  <span className="text-[11px] font-bold text-emerald-700">+91 {mobile}</span>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-emerald-700 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    required
                    autoFocus
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl border-2 border-slate-200 font-black text-slate-900 focus:border-brand-600 focus:outline-none text-xl tracking-[0.3em] text-center bg-slate-50/50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full py-3.5 rounded-2xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center space-x-2 transition-all shadow-lg shadow-brand-900/20 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{language === 'EN' ? 'Verifying...' : 'तपासत आहे...'}</span>
                  </>
                ) : (
                  <>
                    <span>{language === 'EN' ? 'Verify & Login' : 'सत्यापित करून प्रवेश करा'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={resetOTP}
                className="w-full text-center text-xs font-bold text-slate-500 hover:text-slate-800 pt-2"
              >
                {language === 'EN' ? 'Change Phone Number' : 'मोबाईल नंबर बदला'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] font-bold text-emerald-300/60 pb-2">
        {language === 'EN' ? 'Secured by Shri Mahakal Finance Core System' : 'श्री महाकाल फायनान्स व्यवस्थापन प्रणाली द्वारे सुरक्षित'}
      </div>
    </div>
  );
};

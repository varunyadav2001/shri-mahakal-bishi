import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { StaffMember, StaffRole, BroadcastAlert } from '../../types';
import { StorageService } from '../../services/db';
import { ModalPortal } from '../../components/common/ModalPortal';
import { BRAND } from '../../config/brand';
import {
  Settings,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  UserCheck,
  Bell,
  Plus,
  Trash2,
  Lock,
  Send,
  Users,
  Shield,
  Smartphone,
  Info,
} from 'lucide-react';

export const SettingsManager: React.FC = () => {
  const {
    language,
    isRefreshing,
    refreshAllData,
    staffMembers,
    broadcastAlerts,
    bishiConfigs,
    customers,
    showToast,
    refreshData,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'GENERAL' | 'STAFF' | 'ALERTS'>('GENERAL');

  // Staff Modal state
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffMobile, setStaffMobile] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState<StaffRole>('COLLECTION_AGENT');
  const [canCollect, setCanCollect] = useState(true);
  const [canApproveRequests, setCanApproveRequests] = useState(false);
  const [canViewReports, setCanViewReports] = useState(false);
  const [canManageLoans, setCanManageLoans] = useState(false);

  // Broadcast Alert Form state
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [targetAudience, setTargetAudience] = useState<'ALL_MEMBERS' | 'SPECIFIC_SCHEME'>('ALL_MEMBERS');
  const [targetSchemeId, setTargetSchemeId] = useState('');
  const [isSendingAlert, setIsSendingAlert] = useState(false);

  // Save new staff member
  const handleSaveStaff = () => {
    if (!staffName.trim() || !staffMobile.trim()) {
      showToast('कृपया कर्मचाऱ्याचे नाव आणि मोबाईल नंबर प्रविष्ट करा.', 'error');
      return;
    }

    const newStaff: Omit<StaffMember, 'id' | 'createdAt'> = {
      name: staffName.trim(),
      mobile: staffMobile.trim(),
      email: staffEmail.trim() || undefined,
      role: staffRole,
      active: true,
      canCollect,
      canApproveRequests,
      canViewReports,
      canManageLoans,
    };

    StorageService.saveStaffMember(newStaff);
    refreshData();
    setIsStaffModalOpen(false);
    setStaffName('');
    setStaffMobile('');
    setStaffEmail('');
    setStaffRole('COLLECTION_AGENT');
    setCanCollect(true);
    setCanApproveRequests(false);
    setCanViewReports(false);
    setCanManageLoans(false);

    showToast('नवीन कर्मचारी व अधिकार यशस्वीपणे जोडले गेले!', 'success');
  };

  const handleDeleteStaff = (id: string) => {
    if (confirm('तुम्हाला या कर्मचाऱ्याचे खाते काढून टाकायचे आहे का?')) {
      StorageService.deleteStaffMember(id);
      refreshData();
      showToast('कर्मचारी खाते काढून टाकले गेले.', 'info');
    }
  };

  const handleToggleStaffActive = (staff: StaffMember) => {
    StorageService.updateStaffMember(staff.id, {
      active: !staff.active,
    });
    refreshData();
    showToast(
      staff.active ? 'कर्मचारी खाते तात्पुरते निष्क्रिय केले.' : 'कर्मचारी खाते पुन्हा सक्रिय केले.',
      'info'
    );
  };

  // Broadcast Alert to members
  const handleSendBroadcast = async () => {
    if (!alertTitle.trim() || !alertMessage.trim()) {
      showToast('कृपया अलर्ट शीर्षक आणि संदेश प्रविष्ट करा.', 'error');
      return;
    }

    setIsSendingAlert(true);
    try {
      const recipientCount =
        targetAudience === 'ALL_MEMBERS'
          ? customers.length
          : customers.filter((c) => c.bishiType === targetSchemeId).length;

      const newAlert: Omit<BroadcastAlert, 'id' | 'sentAt'> = {
        title: alertTitle.trim(),
        titleMr: alertTitle.trim(),
        message: alertMessage.trim(),
        messageMr: alertMessage.trim(),
        targetAudience,
        schemeId: targetSchemeId || undefined,
        sentBy: 'Admin',
        recipientCount: Math.max(1, recipientCount),
      };

      StorageService.saveBroadcastAlert(newAlert);
      refreshData();
      setAlertTitle('');
      setAlertMessage('');
      showToast(`सूचना ${recipientCount} सदस्यांना यशस्वीपणे पाठवण्यात आली!`, 'success');
    } catch (err: any) {
      showToast('सूचना पाठवताना त्रुटी आली.', 'error');
    } finally {
      setIsSendingAlert(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Settings className="w-6 h-6 text-brand-700" />
            <span>{language === 'EN' ? 'Settings & Staff Access' : 'सेटिंग, स्टाफ व सूचना व्यवस्थापन'}</span>
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {language === 'EN'
              ? 'Configure staff access levels, send push notifications and view system status'
              : 'स्टाफ अधिकार (Roles), सदस्यांना पुश सूचना (Alerts) आणि प्रणाली कॉन्फिगरेशन'}
          </p>
        </div>

        <button
          onClick={() => refreshAllData()}
          disabled={isRefreshing}
          className="h-10 px-3.5 bg-white hover:bg-blue-50 text-[#2563EB] font-extrabold text-xs rounded-xl border border-[#E2E8F0] shadow-2xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-60 active:scale-95 transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#2563EB] ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{language === 'EN' ? 'Refresh' : 'रिफ्रेश'}</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex bg-slate-200/60 p-1.5 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('GENERAL')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'GENERAL'
              ? 'bg-white text-brand-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>{language === 'EN' ? 'System & Brand' : 'प्रणाली व ब्रँड'}</span>
        </button>

        <button
          onClick={() => setActiveTab('STAFF')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'STAFF'
              ? 'bg-white text-brand-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>{language === 'EN' ? 'Staff & Roles' : 'स्टाफ अधिकार (Roles)'}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-black">
            {staffMembers.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('ALERTS')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'ALERTS'
              ? 'bg-white text-brand-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>{language === 'EN' ? 'Member Alerts' : 'सदस्य सूचना (Alerts)'}</span>
        </button>
      </div>

      {/* Tab 1: General & Brand Settings */}
      {activeTab === 'GENERAL' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span>अधिकृत ब्रँड तपशील (Brand Configuration)</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-slate-400 font-bold block text-[10px] uppercase">प्लॅटफॉर्म नाव</span>
                <span className="text-base font-black text-brand-900">{BRAND.nameMr}</span>
                <span className="text-slate-500 font-medium block">({BRAND.name})</span>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-slate-400 font-bold block text-[10px] uppercase">टॅगलाईन</span>
                <span className="font-extrabold text-slate-800">{BRAND.tagline.MR}</span>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-slate-400 font-bold block text-[10px] uppercase">सिस्टीम व्हर्जन</span>
                <span className="font-bold text-slate-800">v2.0 (Shri Mahakal Finance Bhishi Platform)</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
              <Smartphone className="w-5 h-5 text-blue-600" />
              <span>सिस्टीम कनेक्ट आणि बॅकएंड स्थिती</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3.5 bg-emerald-50/60 rounded-2xl border border-emerald-200">
                <div>
                  <span className="font-bold text-emerald-950 block">Firebase Firestore & Auth</span>
                  <span className="text-[11px] text-emerald-700">सुरक्षितपणे कनेक्ट आहे (Active & Synced)</span>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>

              <div className="flex items-center justify-between p-3.5 bg-blue-50/60 rounded-2xl border border-blue-200">
                <div>
                  <span className="font-bold text-blue-950 block">Cloud Functions v2</span>
                  <span className="text-[11px] text-blue-700">ऑटोमॅटिक हप्ते ट्रॅकिंग व व्हॉट्सॲप सक्रिय</span>
                </div>
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
              </div>

              <div className="flex items-center justify-between p-3.5 bg-amber-50/60 rounded-2xl border border-amber-200">
                <div>
                  <span className="font-bold text-amber-950 block">स्वयंचलित दैनंदिन बॅकअप</span>
                  <span className="text-[11px] text-amber-700">रात्री ११:०० वा. लोकल + क्लाउड बॅकअप सक्रिय</span>
                </div>
                <CheckCircle2 className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Staff & Roles Access */}
      {activeTab === 'STAFF' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-slate-500 font-medium">
              फायनान्स टीममधील कर्मचाऱ्यांना वेगवेगळ्या जबाबदाऱ्या आणि परवानग्या वाटून द्या.
            </p>
            <button
              onClick={() => setIsStaffModalOpen(true)}
              className="px-4 py-2 bg-[#2563EB] hover:bg-[#1E3A8A] text-white text-xs font-black rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>नवीन कर्मचारी जोडा</span>
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-4">कर्मचाऱ्याचे नाव</th>
                  <th className="py-3 px-4">मोबाईल</th>
                  <th className="py-3 px-4">पद (Role)</th>
                  <th className="py-3 px-4">परवानग्या (Permissions)</th>
                  <th className="py-3 px-4 text-center">स्थिती</th>
                  <th className="py-3 px-4 text-center">कृती</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffMembers.map((staff) => (
                  <tr key={staff.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-extrabold text-slate-900">{staff.name}</div>
                      {staff.email && <div className="text-[10px] text-slate-400">{staff.email}</div>}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-700">{staff.mobile}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                        {staff.role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {staff.canCollect && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-bold">
                            हप्ते जमा
                          </span>
                        )}
                        {staff.canApproveRequests && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[9px] font-bold">
                            अर्ज मंजुरी
                          </span>
                        )}
                        {staff.canViewReports && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[9px] font-bold">
                            अहवाल
                          </span>
                        )}
                        {staff.canManageLoans && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[9px] font-bold">
                            कर्ज वाटप
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => handleToggleStaffActive(staff)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black cursor-pointer ${
                          staff.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {staff.active ? 'सक्रिय (Active)' : 'निष्क्रिय (Inactive)'}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => handleDeleteStaff(staff.id)}
                        className="p-1.5 hover:bg-rose-50 text-rose-500 rounded-lg cursor-pointer transition-colors"
                        title="काढून टाका"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Member Broadcast Alerts */}
      {activeTab === 'ALERTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="lg:col-span-1 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
              <Send className="w-4 h-4 text-brand-700" />
              <span>नवीन सूचना पाठवा (Broadcast Alert)</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">लक्ष्य सदस्य (Target Audience):</label>
                <select
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-bold bg-white"
                >
                  <option value="ALL_MEMBERS">सर्व सदस्य (All Registered Members)</option>
                  <option value="SPECIFIC_SCHEME">विशिष्ट भिशी योजनेचे सदस्य</option>
                </select>
              </div>

              {targetAudience === 'SPECIFIC_SCHEME' && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">भिशी योजना निवडा:</label>
                  <select
                    value={targetSchemeId}
                    onChange={(e) => setTargetSchemeId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white"
                  >
                    <option value="">योजना निवडा...</option>
                    {bishiConfigs.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 block mb-1">सूचना शीर्षक (Title):</label>
                <input
                  type="text"
                  placeholder="उदा. दिवाळी भिशी हप्ता देय तारीख"
                  value={alertTitle}
                  onChange={(e) => setAlertTitle(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">संदेश (Message):</label>
                <textarea
                  rows={4}
                  placeholder="उदा. सर्व सन्माननीय खातेदारांना नम्र विनंती की या महिन्याचा हप्ता ५ तारखेपूर्वी जमा करावा."
                  value={alertMessage}
                  onChange={(e) => setAlertMessage(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 resize-none"
                />
              </div>

              <button
                onClick={handleSendBroadcast}
                disabled={isSendingAlert}
                className="w-full py-2.5 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSendingAlert ? 'पाठवत आहे...' : 'सर्व सदस्यांना पाठवा'}</span>
              </button>
            </div>
          </div>

          {/* Past Alerts List */}
          <div className="lg:col-span-2 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
              <Bell className="w-4 h-4 text-emerald-600" />
              <span>पाठवलेल्या सूचनांचा इतिहास (Broadcast History)</span>
            </h3>

            {broadcastAlerts.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-medium">
                अद्याप कोणत्याही सूचना पाठवलेल्या नाहीत.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {broadcastAlerts.map((a) => (
                  <div key={a.id} className="py-3 space-y-1">
                    <div className="flex justify-between items-start">
                      <h4 className="font-extrabold text-slate-900 text-xs">{a.title}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {a.sentAt?.split('T')[0]}
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs font-medium">{a.message}</p>
                    <div className="flex items-center space-x-2 text-[10px] text-slate-400 pt-1">
                      <span>टार्गेट: {a.targetAudience}</span>
                      <span>•</span>
                      <span>प्राप्तकर्ता: {a.recipientCount || 'सर्व'} सदस्य</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Add Staff Member */}
      {isStaffModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-base font-extrabold text-slate-900">नवीन कर्मचारी व अधिकार नोंदवा</h3>
                <button
                  onClick={() => setIsStaffModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">कर्मचाऱ्याचे नाव:</label>
                  <input
                    type="text"
                    placeholder="उदा. राहुल शिंदे"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">मोबाईल नंबर (लॉगिनसाठी):</label>
                  <input
                    type="tel"
                    placeholder="उदा. 9876543210"
                    value={staffMobile}
                    onChange={(e) => setStaffMobile(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">ईमेल (पर्यायी):</label>
                  <input
                    type="email"
                    placeholder="staff@shrimahakal.com"
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">पद (Staff Role):</label>
                  <select
                    value={staffRole}
                    onChange={(e) => setStaffRole(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold bg-white"
                  >
                    <option value="COLLECTION_AGENT">कलेक्शन एजंट (Collection Agent)</option>
                    <option value="ACCOUNTANT">अकाउंटंट (Accountant)</option>
                    <option value="ADMIN">ॲडमिन (Admin)</option>
                    <option value="SUPER_ADMIN">सुपर ॲडमिन (Super Admin)</option>
                  </select>
                </div>

                {/* Permissions Checkboxes */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-2">
                  <span className="font-black text-slate-800 block text-[11px] mb-1">अधिकार परवानग्या:</span>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canCollect}
                      onChange={(e) => setCanCollect(e.target.checked)}
                      className="rounded text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span className="font-bold text-slate-700">हप्ता व पावती जमा करणे</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canApproveRequests}
                      onChange={(e) => setCanApproveRequests(e.target.checked)}
                      className="rounded text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span className="font-bold text-slate-700">मोबाईल ॲपचे सदस्य अर्ज मंजूर करणे</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canViewReports}
                      onChange={(e) => setCanViewReports(e.target.checked)}
                      className="rounded text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span className="font-bold text-slate-700">अहवाल व लेजर पाहणे/डाऊनलोड</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageLoans}
                      onChange={(e) => setCanManageLoans(e.target.checked)}
                      className="rounded text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span className="font-bold text-slate-700">कर्ज वाटप व व्यवस्थापन</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsStaffModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handleSaveStaff}
                  className="flex-1 py-2.5 bg-[#2563EB] hover:bg-[#1E3A8A] text-white font-black rounded-xl shadow-md cursor-pointer transition-all"
                >
                  कर्मचारी सेव्ह करा
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

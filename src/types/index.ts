export type OfficeId = 'ALL' | 'MAIN' | 'HOME';

export type BishiType = '15_AUGUST' | '26_JANUARY' | 'DASARA' | 'LOAN_ONLY' | (string & {});

export type Modality = 'W' | 'M';

export interface Admin {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  photoURL?: string;
  password?: string;
  role?: 'SUPER_ADMIN' | 'ADMIN';
  createdAt: string;
  updatedAt?: string;
}

export interface BishiConfig {
  id: BishiType;
  name: string;
  startDate: string;
  endDate: string;
  totalInstallments: number;
  modality?: Modality;
  officeId: OfficeId;
  color?: string;
  bgPastel?: string;
  startAccountNumber?: number;
  status?: 'ACTIVE' | 'COMPLETED' | 'CLOSED';
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Customer {
  id: string;
  accountNumber: string; // Unique
  accountNo?: string; // Denormalized alias for fast prefix / equality queries
  name: string;
  customerName?: string;
  nameLower?: string; // Denormalized lowercase name for efficient prefix range queries
  mobile: string;
  bishiType: BishiType;
  bishiName?: string;
  bishiDate: string;
  modality: Modality;
  amount: number;
  totalInstallments?: number;
  interestRate: number;
  penaltyRate: number;
  officeId: OfficeId;
  address: string;
  photoURL?: string;
  hasLoan: boolean;
  status: 'ACTIVE' | 'COMPLETED';
  createdAt: string;
  updatedAt?: string;
  summary?: {
    totalExpected: number;
    totalCollected: number;
    totalExtraAmount?: number;
    totalRemaining: number;
    completedInstallments: number;
    pendingInstallments: number;
  };
  installments?: any[];
  loanDetails?: any;
}

// ── Installments (Due-Schedule) Schema ──────────────────────────────────────
export interface Installment {
  id: string; // e.g. inst_bishi_${customerId}_${periodIndex} or inst_loan_${loanId}_${periodIndex}
  customerId: string;
  customerName: string; // Denormalized to avoid re-fetching customer doc
  accountNumber: string;
  accountNo?: string;
  type: 'bishi' | 'loan';
  sourceId: string; // bishiType or loanId this belongs to
  dueDate: string; // YYYY-MM-DD (start of day)
  amount: number;
  status: 'pending' | 'paid' | 'overdue';
  paidAt: string | null;
  periodIndex?: number;
  periodLabel?: string;
  officeId?: OfficeId;
  createdAt?: string;
  updatedAt?: string;
}

// ── Stats Summary Singleton Schema (stats/summary) ─────────────────────────
export interface StatsSummary {
  totalCustomers: number;
  todaysCollection: number;
  totalBishiCollected: number;
  totalPrincipalLoans: number;
  loanBalanceDue: number;
  todaysPenalty: number;
  todaysDueAmount: number;
  todaysDueInstallments: number;
  pendingRequestsCount?: number;
  lastUpdated: string;
}

export interface CollectionEntry {
  id: string;
  customerId: string;
  customerName?: string;
  accountNumber: string;
  officeId: OfficeId;
  bishiType: BishiType;
  bishiName?: string;
  periodIndex: number;
  periodLabel: string;
  dueDate: string;
  paymentDate?: string;
  expectedAmount: number;
  collectedAmount: number;
  extraAmount?: number;
  remainingAmount: number;
  interestAmount: number;
  historicalInterestRate: number;
  penaltyAmount: number;
  historicalPenaltyRate: number;
  totalPaid: number;
  totalWithPenalty?: number;
  status: 'PAID' | 'PARTIAL' | 'PENDING';
  paymentTime?: string;
  paymentMode?: 'CASH' | 'ONLINE' | 'BANK';
  note?: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  customerId: string;
  customerName?: string;
  accountNumber: string;
  officeId: OfficeId;
  bishiType?: BishiType;
  customerMobile?: string;
  principalAmount: number;
  issueDate: string;
  interestRate: number; // Snapshotted at creation
  totalInterest: number;
  totalInterestPaid?: number;
  totalPayable: number;
  paidAmount: number;
  discountAmount?: number;
  remainingAmount: number;
  penaltyAmount: number;
  status: 'ACTIVE' | 'CLOSED' | 'COMPLETED';
  purposeNote?: string;
  previousLoanId?: string; // If consolidated via rollover
  rolledOverAt?: string;
  updatedAt: string;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  customerId: string;
  customerName?: string;
  accountNumber?: string;
  officeId?: OfficeId;
  bishiType?: BishiType;
  customerMobile?: string;
  paymentDate: string;
  paidAmount: number;
  interestPaid: number;
  totalInterest?: number;
  totalInterestPaid?: number;
  penaltyPaid: number;
  discountAmount?: number;
  remainingLoan: number;
  totalPaid?: number;
  paymentMode?: 'CASH' | 'ONLINE';
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InterestRateConfig {
  id: string;
  rate: number;
  rateType?: 'MONTHLY' | 'WEEKLY';
  effectiveDate: string;
  note?: string;
}

export interface PenaltySetting {
  id: string;
  weeklyPenalty: number;
  monthlyPenalty: number;
  graceDays: number;
}

export interface SmsLog {
  id: string;
  customerId: string;
  customerName: string;
  mobile: string;
  message: string;
  type: 'DUE_REMINDER_2_DAYS' | 'DUE_TODAY' | 'PENDING' | 'PENALTY' | 'COLLECTION' | 'LOAN_BALANCE';
  sentAt: string;
  status: 'SENT' | 'FAILED';
}

// ── Thakbaki (थकबाकी) Types ──────────────────────────────────────────────────
export interface ThakbakiPayment {
  id: string;
  paymentDate: string;
  paidAmount: number;
  paymentMode: 'CASH' | 'ONLINE' | 'BANK';
  note?: string;
  createdAt: string;
}

export interface ThakbakiEntry {
  id: string;
  customerId?: string; // Optional link to an existing registered customer
  accountNumber: string;
  name: string;
  mobile: string;
  officeId: OfficeId;
  initialAmount: number;   // Original arrears / dues amount
  paidAmount: number;      // Total paid so far
  remainingAmount: number; // Current balance due
  status: 'PENDING' | 'CLEARED';
  startDate: string;
  lastPaymentDate?: string;
  note?: string;
  payments: ThakbakiPayment[];
  createdAt: string;
  updatedAt: string;
}

// ── Member App & Approvals Section Types ─────────────────────────────────────
export type RequestType = 'join_scheme' | 'loan' | 'payment' | 'profile_change' | 'other' | 'JOIN_SCHEME' | 'LOAN' | 'PAYMENT' | 'PROFILE_CHANGE' | 'OTHER';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface MemberRequest {
  id: string;
  memberUid?: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  accountNumber?: string;
  mobile: string;
  type: RequestType;
  amount?: number;
  message?: string;
  schemeId?: string;
  schemeName?: string;
  modality?: Modality;
  totalInstallments?: number;
  officeId?: OfficeId;
  fcmToken?: string;
  status: RequestStatus;
  reviewNote?: string; // Mandatory when rejected
  reviewedBy?: string; // Admin ID / name
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  payload?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface InAppNotification {
  id: string;
  memberUid?: string;
  customerId?: string;
  mobile: string;
  title: string;
  body: string;
  type: 'REQUEST_APPROVED' | 'REQUEST_REJECTED' | 'PAYMENT_RECEIVED' | 'DUE_REMINDER' | 'GENERAL';
  requestId?: string;
  read: boolean;
  createdAt: string;
}

// ── Audit Log Schema ────────────────────────────────────────────────────────
export interface AuditLog {
  id: string;
  adminId?: string;
  adminName?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'LOGIN' | 'SETTLE' | 'ROLLOVER';
  entityType: 'CUSTOMER' | 'COLLECTION' | 'LOAN' | 'LOAN_PAYMENT' | 'BISHI_CONFIG' | 'THAKBAKI' | 'REQUEST' | 'SETTINGS';
  entityId: string;
  details?: string;
  previousData?: any;
  newData?: any;
  timestamp: string;
}

// ── System Backup Types ─────────────────────────────────────────────────────
export interface SystemBackupData {
  version: string;
  exportedAt: string;
  brand: string;
  admins: Admin[];
  customers: Customer[];
  bishiConfigs: BishiConfig[];
  collections: CollectionEntry[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  interestRates: InterestRateConfig[];
  penaltySettings: PenaltySetting[];
  smsLogs: SmsLog[];
  thakbaki?: ThakbakiEntry[];
  requests?: MemberRequest[];
  auditLogs?: AuditLog[];
}

export interface LocalBackupSnapshot {
  id: string;
  createdAt: string;
  filename: string;
  customerCount: number;
  collectionCount: number;
  loanCount: number;
  loanPaymentCount?: number;
  sizeKb: number;
  data: SystemBackupData;
  slotDate?: string;
  backupType?: '11PM' | 'OPEN' | 'MANUAL' | 'DRIVE';
}

export interface AutoBackupConfig {
  enabled: boolean;
  intervalDays: number;
  backupHour: number; // e.g. 23 for 11 PM
  backupMinute?: number;
  lastBackupTimestamp: number;
  lastBackupDate?: string;
  lastBackupFilename?: string;
  driveWebhookUrl?: string;
  driveBackupEnabled?: boolean;
  lastDriveBackupTimestamp?: number;
  lastDriveBackupDate?: string;
  lastDriveBackupFilename?: string;
  lastDriveBackupStatus?: 'success' | 'error';
  lastDaily11pmDate?: string;
  lastDaily11pmTimestamp?: number;
  lastDaily11pmFilename?: string;
  lastDailyFirstOpenDate?: string;
  lastDailyFirstOpenTimestamp?: number;
  lastDailyFirstOpenFilename?: string;
}

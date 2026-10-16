export type Language = 'MR' | 'EN';

export interface Customer {
  id: string;
  accountNumber: string;
  name: string;
  mobile: string;
  address?: string;
  officeId: string;
  bishiType: string;
  amount: number;
  modality: 'W' | 'M';
  status: string;
  totalCollectedBishi?: number;
  totalRemainingBishi?: number;
  totalInterest?: number;
  totalPenalty?: number;
}

export interface Collection {
  id: string;
  customerId: string;
  customerName?: string;
  accountNumber?: string;
  date: string;
  collectedAmount: number;
  totalPaid?: number;
  remainingAmount?: number;
  periodIndex?: number;
  officeId?: string;
  notes?: string;
}

export interface Loan {
  id: string;
  customerId: string;
  principalAmount: number;
  interestRate: number;
  balancePrincipal: number;
  issueDate: string;
  status: string;
  totalInterestPaid: number;
}

export interface Installment {
  id: string;
  customerId: string;
  type: 'bishi' | 'loan';
  dueDate: string;
  amount: number;
  status: 'pending' | 'paid' | 'overdue';
  periodIndex: number;
  periodLabel: string;
}

export type RequestType = 'JOIN_SCHEME' | 'LOAN' | 'PAYMENT' | 'PROFILE_CHANGE' | 'OTHER';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface MemberRequest {
  id: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  accountNumber?: string;
  type: RequestType;
  schemeId?: string;
  schemeName?: string;
  modality?: 'W' | 'M';
  totalInstallments?: number;
  amount?: number;
  message: string;
  status: RequestStatus;
  fcmToken?: string;
  officeId?: string;
  payload?: any;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InAppNotification {
  id: string;
  recipientPhone: string;
  recipientCustomerId?: string;
  requestId?: string;
  title: string;
  titleMr: string;
  message: string;
  messageMr: string;
  type: string;
  status?: string;
  read: boolean;
  createdAt: string;
}

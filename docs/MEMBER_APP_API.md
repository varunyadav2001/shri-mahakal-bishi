# Narayan Bhishi – Member App API & Architecture Documentation

## 1. Overview & Architecture
The **Narayan Bhishi Member App** is a standalone, mobile-first Progressive Web Application (PWA) built specifically for bishi members (खातेदार). It enables members to view their savings schemes, installments passbook, active loans, submit operational requests (joining schemes, requesting loans, submitting payments, updating profile details), and receive live push notifications upon admin review.

```
┌───────────────────────────────────────┐         ┌─────────────────────────────────────┐
│          Member Web App (PWA)         │         │        Admin Web App (Portal)       │
│  - Firebase Phone OTP Auth            │         │  - Scheme & Loan Management         │
│  - Passbook & Scheme Balances         │         │  - Approvals Hub (/requests)        │
│  - Submit Requests & Live Status      │         │  - Audit Logs & Daily Backups       │
└──────────────────┬────────────────────┘         └──────────────────┬──────────────────┘
                   │                                                 │
                   ▼                                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                           Google Cloud Firebase Platform                              │
│                                                                                       │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌──────────────────────────────┐ │
│  │ Firebase Phone Auth   │ │ Cloud Firestore DB    │ │ Cloud Functions (v2)         │ │
│  │ Member OTP login      │ │ Locked Rules (No 'if')│ │ reviewRequest (idempotent)   │ │
│  └───────────────────────┘ └───────────────────────┘ └──────────────────────────────┘ │
│                                  │                                                    │
│                                  ▼                                                    │
│                       ┌───────────────────────┐                                       │
│                       │ Firebase Cloud        │                                       │
│                       │ Messaging (FCM Push)  │                                       │
│                       └───────────────────────┘                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication Flow (Phone OTP)
Members authenticate exclusively via **Firebase Phone Authentication**:
1. User enters 10-digit Indian mobile number (e.g., `9876543210`).
2. Firebase sends a 6-digit SMS OTP via reCAPTCHA verification.
3. Upon entering OTP, Firebase Auth issues a JWT token containing `request.auth.token.phone_number` in `+91XXXXXXXXXX` format.
4. The member app queries `customers` where `mobile` matches the member's 10-digit number (or formatted with +91) to bind the session to their `customerId` and account details.

---

## 3. Data Model & Firestore Collections

### A. Customers (`customers/{customerId}`)
Read-only for the member (enforced by rules matching `request.auth.token.phone_number == resource.data.mobile`).
```typescript
interface Customer {
  id: string;               // e.g., "cust_101"
  accountNumber: string;    // e.g., "101"
  name: string;             // Member Name (Marathi / English)
  mobile: string;           // 10-digit mobile number
  address?: string;         // Address / Village
  officeId: 'MAIN' | 'HOME';
  bishiType: string;        // Active Scheme ID
  amount: number;           // Installment amount (₹)
  modality: 'W' | 'M';      // W = Weekly (40 inst), M = Monthly (10 inst)
  status: 'ACTIVE' | 'SETTLED' | 'CLOSED';
}
```

### B. Collections / Passbook (`collections/{collectionId}`)
Every recorded payment for the customer. Read-only for the member.
```typescript
interface Collection {
  id: string;
  customerId: string;
  customerName: string;
  accountNumber: string;
  date: string;             // "YYYY-MM-DD"
  collectedAmount: number;  // Amount paid
  periodIndex: number;      // Installment number
  remainingAmount: number;  // Remaining balance
  officeId: string;
  paymentMethod: 'CASH' | 'ONLINE' | 'UPI';
}
```

### C. Loans (`loans/{loanId}`)
Loans granted to the member. Read-only for the member.
```typescript
interface Loan {
  id: string;
  customerId: string;
  principalAmount: number;
  interestRate: number;     // Snapshotted monthly % rate (e.g. 2)
  balancePrincipal: number;
  issueDate: string;        // "YYYY-MM-DD"
  status: 'ACTIVE' | 'SETTLED' | 'ROLLOVER';
  totalInterestPaid: number;
  officeId: string;
}
```

### D. Installments Schedule (`installments/{installmentId}`)
Scheduled due dates and status. Read-only for the member.
```typescript
interface Installment {
  id: string;
  customerId: string;
  type: 'bishi' | 'loan';
  dueDate: string;          // "YYYY-MM-DD"
  amount: number;
  status: 'pending' | 'paid' | 'overdue';
  periodIndex: number;
  periodLabel: string;
}
```

### E. Member Requests (`requests/{requestId}`)
Operational requests created by the member for admin approval.
```typescript
interface MemberRequest {
  id: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  accountNumber?: string;
  type: 'JOIN_SCHEME' | 'LOAN' | 'PAYMENT' | 'PROFILE_CHANGE' | 'OTHER';
  amount?: number;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fcmToken?: string;        // Device push token
  payload?: {
    interestRate?: number;
    issueDate?: string;
    paymentMethod?: string;
    address?: string;
    name?: string;
    mobile?: string;
  };
  reviewedBy?: string;
  reviewedById?: string;
  reviewedAt?: string;
  reviewNote?: string;      // Mandatory on rejection!
  createdAt: string;
  updatedAt: string;
}
```

### F. In-App Notifications (`notifications/{notificationId}`)
Notifications sent to the member upon request review.
```typescript
interface InAppNotification {
  id: string;
  recipientPhone: string;
  recipientCustomerId: string;
  requestId: string;
  title: string;
  titleMr: string;
  message: string;
  messageMr: string;
  type: 'REQUEST_STATUS' | 'REMINDER';
  status?: 'APPROVED' | 'REJECTED';
  read: boolean;
  createdAt: string;
}
```

---

## 4. Server-Side Idempotent Callable Function: `reviewRequest`
Admins approve or reject member requests through the secure HTTPS callable Cloud Function `reviewRequest`.

### Invocation Parameters:
```json
{
  "requestId": "req_1729001234_abc",
  "action": "APPROVE" | "REJECT",
  "reviewNote": "String (Required if action == 'REJECT')"
}
```

### Idempotency Guarantee:
- If the request document's status in Firestore is not `PENDING` (e.g., already `APPROVED` or `REJECTED`), the function immediately halts side effects and returns `{ success: true, idempotent: true, status: existingStatus }`.
- Concurrent or duplicate admin clicks will never generate duplicate loans or double collections!

### Automated Side Effects on `APPROVE`:
1. `LOAN`: Automatically generates active loan record in `loans/` with snapshotted interest rate.
2. `PAYMENT`: Automatically inserts collection receipt in `collections/` and updates installments.
3. `PROFILE_CHANGE`: Automatically patches verified customer fields in `customers/{id}`.
4. Dispatches FCM push notification directly to the member's registered device.
5. Emits an immutable audit log record to `audit_logs/`.

---

## 5. FCM Push Notifications Setup
1. Member app prompts for notification permission on initial sign-in.
2. The FCM registration token is acquired via `@firebase/messaging` (`getToken`).
3. The token is attached to every new `MemberRequest` (`fcmToken` property).
4. When `reviewRequest` executes on Cloud Functions, `admin.messaging().send()` pushes an instant alert to the member:
   - **Title**: `नारायण भिशी: अर्ज मंजूर झाला` or `नारायण भिशी: अर्ज नाकारला गेला`
   - **Body**: Custom Marathi message with the admin note.
   - **Data**: `{ requestId, status, type }`.

import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const STATS_REF = db.doc('stats/summary');

/**
 * 1. onCustomerCreated (customers/{id} onCreate)
 * Increment stats/summary.totalCustomers by 1 atomically using FieldValue.increment()
 */
export const onCustomerCreated = onDocumentCreated('customers/{customerId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  await STATS_REF.set(
    {
      totalCustomers: admin.firestore.FieldValue.increment(1),
      lastUpdated: new Date().toISOString(),
    },
    { merge: true }
  );
});

/**
 * 1b. onCustomerDeleted (customers/{id} onDelete)
 * Decrement stats/summary.totalCustomers by 1 atomically
 */
export const onCustomerDeleted = onDocumentDeleted('customers/{customerId}', async (event) => {
  await STATS_REF.set(
    {
      totalCustomers: admin.firestore.FieldValue.increment(-1),
      lastUpdated: new Date().toISOString(),
    },
    { merge: true }
  );
});

/**
 * 2. onCollectionCreated (collections/{id} onCreate — a bishi payment)
 * → stats/summary.todaysCollection += amount
 * → stats/summary.totalBishiCollected += amount
 * → mark matching installments/{id}.status = "paid", paidAt = now
 */
export const onCollectionCreated = onDocumentCreated('collections/{collectionId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  const amount = Number(data.collectedAmount) || 0;
  const customerId = data.customerId || '';
  const periodIndex = data.periodIndex ?? 1;

  // Atomically increment stats
  if (amount > 0) {
    await STATS_REF.set(
      {
        todaysCollection: admin.firestore.FieldValue.increment(amount),
        totalBishiCollected: admin.firestore.FieldValue.increment(amount),
        lastUpdated: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  // Update matching installment status to "paid"
  if (customerId && periodIndex) {
    const installmentId = `inst_bishi_${customerId}_${periodIndex}`;
    const instRef = db.doc(`installments/${installmentId}`);
    try {
      await instRef.set(
        {
          status: 'paid',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Installment status update note:', e);
    }
  }

  // WhatsApp Integration: Send Confirmation
  if (customerId) {
    try {
      const { sendCollectionConfirmation } = await import('./whatsapp.js');
      let customerData: any = null;
      const customerSnap = await db.doc(`customers/${customerId}`).get();
      if (customerSnap.exists) {
        customerData = customerSnap.data();
      } else if (data.accountNumber) {
        const qSnap = await db.collection('customers').where('accountNumber', '==', String(data.accountNumber)).limit(1).get();
        if (!qSnap.empty) {
          customerData = qSnap.docs[0].data();
        }
      }

      if (customerData) {
        const phone = customerData?.mobile;
        const name = customerData?.name || data.customerName || '';
        
        if (phone) {
          await sendCollectionConfirmation(
            phone,
            name,
            Number(data.totalPaid) || amount,
            Number(data.remainingAmount) || 0,
            Number(data.expectedAmount) || 0
          );
        }
      }
    } catch (err) {
      console.error('Failed to send WhatsApp confirmation:', err);
    }
  }
});

/**
 * 3. onLoanCreated (loans/{id} onCreate)
 * → stats/summary.totalPrincipalLoans += principal
 * → stats/summary.loanBalanceDue += principal
 * → generate the full installments schedule for this loan
 */
export const onLoanCreated = onDocumentCreated('loans/{loanId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  const principal = Number(data.principalAmount) || 0;
  const loanId = event.params.loanId;
  const customerId = data.customerId || '';
  const customerName = data.customerName || '';
  const accountNumber = data.accountNumber || '';
  const issueDate = data.issueDate || new Date().toISOString().split('T')[0];

  // Atomically update stats
  await STATS_REF.set(
    {
      totalPrincipalLoans: admin.firestore.FieldValue.increment(principal),
      loanBalanceDue: admin.firestore.FieldValue.increment(principal),
      lastUpdated: new Date().toISOString(),
    },
    { merge: true }
  );

  // Generate loan installment record upfront
  const installmentId = `inst_loan_${loanId}_1`;
  const instRef = db.doc(`installments/${installmentId}`);
  await instRef.set(
    {
      id: installmentId,
      customerId,
      customerName,
      accountNumber,
      accountNo: accountNumber,
      type: 'loan',
      sourceId: loanId,
      dueDate: issueDate,
      amount: principal,
      status: data.status === 'COMPLETED' ? 'paid' : 'pending',
      paidAt: data.status === 'COMPLETED' ? admin.firestore.FieldValue.serverTimestamp() : null,
      periodIndex: 1,
      periodLabel: 'कर्ज हप्ता',
      officeId: data.officeId || 'MAIN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
});

/**
 * 4. onLoanPaymentCreated (loanPayments/{id} onCreate)
 * → stats/summary.loanBalanceDue -= paymentAmount
 * → mark matching installments/{id}.status = "paid"
 * → if a penalty/late-fee field exists, stats/summary.todaysPenalty += it
 */
export const onLoanPaymentCreated = onDocumentCreated('loanPayments/{paymentId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  const paymentAmount = Number(data.paidAmount) || 0;
  const penalty = Number(data.penaltyPaid) || 0;
  const loanId = data.loanId;

  const updates: Record<string, any> = {
    lastUpdated: new Date().toISOString(),
  };

  if (paymentAmount > 0) {
    updates.loanBalanceDue = admin.firestore.FieldValue.increment(-paymentAmount);
  }
  if (penalty > 0) {
    updates.todaysPenalty = admin.firestore.FieldValue.increment(penalty);
  }

  await STATS_REF.set(updates, { merge: true });

  // Mark loan installment paid if fully settled
  if (loanId) {
    const instRef = db.doc(`installments/inst_loan_${loanId}_1`);
    try {
      await instRef.set(
        {
          status: 'paid',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Loan installment update note:', e);
    }
  }
});

/**
 * 5. refreshTodaysDue (scheduled, every 30 min)
 * → query installments where dueDate == today && status == "pending"
 * → compute sum(amount) and count
 * → write into stats/summary.todaysDueAmount / .todaysDueInstallments
 */
export const refreshTodaysDue = onSchedule('every 30 minutes', async () => {
  const todayStr = new Date().toISOString().split('T')[0];

  const snap = await db
    .collection('installments')
    .where('dueDate', '==', todayStr)
    .where('status', '==', 'pending')
    .get();

  let totalDue = 0;
  let count = 0;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    totalDue += Number(data.amount) || 0;
    count += 1;
  });

  await STATS_REF.set(
    {
      todaysDueAmount: totalDue,
      todaysDueInstallments: count,
      lastUpdated: new Date().toISOString(),
    },
    { merge: true }
  );

  console.log(`[refreshTodaysDue] today: ${todayStr}, due: ₹${totalDue}, count: ${count}`);
});

/**
 * 6. markOverdueInstallments (scheduled, once daily, early morning at 4 AM)
 * → batch-update installments where status == "pending" && dueDate < today to status "overdue"
 */
export const markOverdueInstallments = onSchedule('0 4 * * *', async () => {
  const todayStr = new Date().toISOString().split('T')[0];

  const snap = await db
    .collection('installments')
    .where('status', '==', 'pending')
    .where('dueDate', '<', todayStr)
    .limit(500)
    .get();

  if (snap.empty) {
    console.log('[markOverdueInstallments] No overdue installments to update.');
    return;
  }

  const batch = db.batch();
  snap.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      status: 'overdue',
      updatedAt: new Date().toISOString(),
    });
  });

  await batch.commit();
  console.log(`[markOverdueInstallments] Marked ${snap.size} installments as overdue.`);
});

/**
 * 7. resetDailyStats (scheduled, midnight 00:00)
 * → stats/summary.todaysCollection = 0, todaysPenalty = 0
 */
export const resetDailyStats = onSchedule('0 0 * * *', async () => {
  await STATS_REF.set(
    {
      todaysCollection: 0,
      todaysPenalty: 0,
      lastUpdated: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log('[resetDailyStats] Daily stats reset to zero for new day.');
});

/**
 * 8. sendAutomatedReminders (scheduled, daily at 9:00 AM)
 * → Weekly (Friday, Saturday)
 * → Monthly (8th, 9th)
 * → Thakbaki (Sunday)
 */
export const sendAutomatedReminders = onSchedule('0 9 * * *', async () => {
  // Use IST timezone
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dayOfWeek = istNow.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const dayOfMonth = istNow.getDate();

  const isWeeklyDay = dayOfWeek === 5 || dayOfWeek === 6;
  const isMonthlyDay = dayOfMonth === 8 || dayOfMonth === 9;
  const isThakbakiDay = dayOfWeek === 0;

  if (!isWeeklyDay && !isMonthlyDay && !isThakbakiDay) {
    console.log('[sendAutomatedReminders] Not a scheduled reminder day (Weekly: Fri/Sat, Monthly: 8th/9th, Thakbaki: Sun).');
    return;
  }

  const { sendCollectionReminder, sendThakbakiReminder } = await import('./whatsapp.js');

  // 1. Process Weekly & Monthly Installments
  if (isWeeklyDay || isMonthlyDay) {
    const pendingInstallments = await db.collection('installments').where('status', '==', 'pending').get();
    
    // Group pending amounts by customer
    const customersToRemind = new Map<string, { amount: number, dueDates: Set<string>, name: string }>();

    pendingInstallments.forEach((docSnap: any) => {
      const inst = docSnap.data();
      if (!inst.customerId || !inst.amount) return;

      if (!customersToRemind.has(inst.customerId)) {
        customersToRemind.set(inst.customerId, {
          amount: 0,
          dueDates: new Set<string>(),
          name: inst.customerName || ''
        });
      }
      const data = customersToRemind.get(inst.customerId)!;
      data.amount += Number(inst.amount);
      if (inst.dueDate) data.dueDates.add(inst.dueDate);
    });

    console.log(`[sendAutomatedReminders] Processing ${customersToRemind.size} customers with pending installments.`);

    for (const [customerId, data] of customersToRemind.entries()) {
      try {
        const customerSnap = await db.doc(`customers/${customerId}`).get();
        if (!customerSnap.exists) continue;
        
        const customer = customerSnap.data();
        if (!customer || !customer.mobile || customer.status !== 'ACTIVE') continue;

        const modality = customer.modality; // 'WEEKLY' or 'MONTHLY'
        
        let shouldSend = false;
        if (isWeeklyDay && modality === 'WEEKLY') shouldSend = true;
        if (isMonthlyDay && modality === 'MONTHLY') shouldSend = true;
        
        if (shouldSend) {
          const dueDateStr = Array.from(data.dueDates).join(', ');
          await sendCollectionReminder(
            customer.mobile,
            customer.name || data.name,
            data.amount,
            dueDateStr
          );
        }
      } catch (err) {
        console.error(`Failed to send WhatsApp reminder for customer ${customerId}:`, err);
      }
    }
  }

  // 2. Process Thakbaki (Arrears) on Sundays
  if (isThakbakiDay) {
    const pendingThakbaki = await db.collection('thakbaki').where('status', '==', 'PENDING').get();
    console.log(`[sendAutomatedReminders] Processing ${pendingThakbaki.size} pending Thakbaki entries.`);

    for (const docSnap of pendingThakbaki.docs) {
      try {
        const thak = docSnap.data();
        if (!thak.remainingAmount || thak.remainingAmount <= 0 || !thak.mobile) continue;
        
        await sendThakbakiReminder(
          thak.mobile,
          thak.name,
          Number(thak.remainingAmount)
        );
      } catch (err) {
        console.error(`Failed to send Thakbaki reminder for ${docSnap.id}:`, err);
      }
    }
  }
});

/**
 * 9. reviewRequest (HTTPS Callable)
 * Idempotent review of customer/member requests from member app.
 * Applies side effects on APPROVE, generates in-app notifications, FCM push, and audit logs.
 */
interface ReviewRequestPayload {
  requestId: string;
  action: 'APPROVE' | 'REJECT';
  reviewNote?: string;
}

export const reviewRequest = onCall<ReviewRequestPayload>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in to review requests.');
  }

  const { requestId, action, reviewNote } = request.data;
  if (!requestId || !action) {
    throw new HttpsError('invalid-argument', 'requestId and action are required.');
  }

  if (action === 'REJECT' && (!reviewNote || !reviewNote.trim())) {
    throw new HttpsError('invalid-argument', 'Rejection note is required when rejecting a request.');
  }

  const reviewerName = request.auth.token.name || request.auth.token.email || 'Admin';
  const reviewerId = request.auth.uid;

  // Idempotency: fetch request
  const requestRef = db.doc(`requests/${requestId}`);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError('not-found', 'Request not found.');
  }

  const reqData = requestSnap.data()!;
  if (reqData.status !== 'PENDING') {
    return {
      success: true,
      idempotent: true,
      status: reqData.status,
      message: `Request was already reviewed as ${reqData.status}.`,
    };
  }

  const now = new Date().toISOString();
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  // Apply side effects on approval
  if (action === 'APPROVE') {
    const type = reqData.type;
    const customerId = reqData.customerId;
    const amount = Number(reqData.amount) || 0;

    if (type === 'LOAN') {
      const newLoanId = `loan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const interestRate = Number(reqData.payload?.interestRate) || 2;
      const issueDate = reqData.payload?.issueDate || now.split('T')[0];

      await db.doc(`loans/${newLoanId}`).set({
        id: newLoanId,
        customerId: customerId || '',
        customerName: reqData.customerName || '',
        accountNumber: reqData.accountNumber || '',
        principalAmount: amount,
        interestRate,
        issueDate,
        status: 'ACTIVE',
        balancePrincipal: amount,
        totalInterestPaid: 0,
        officeId: reqData.officeId || 'MAIN',
        createdAt: now,
        updatedAt: now,
        notes: `Approved from request #${requestId}: ${reqData.message || ''}`,
      });
    } else if (type === 'PAYMENT') {
      const collectionId = `coll_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.doc(`collections/${collectionId}`).set({
        id: collectionId,
        customerId: customerId || '',
        customerName: reqData.customerName || '',
        accountNumber: reqData.accountNumber || '',
        date: now.split('T')[0],
        collectedAmount: amount,
        totalPaid: amount,
        remainingAmount: 0,
        officeId: reqData.officeId || 'MAIN',
        paymentMethod: reqData.payload?.paymentMethod || 'ONLINE',
        notes: `Approved payment request #${requestId}: ${reqData.message || ''}`,
        createdAt: now,
        updatedAt: now,
      });
    } else if (type === 'PROFILE_CHANGE') {
      if (customerId && reqData.payload) {
        const updateFields: Record<string, any> = { updatedAt: now };
        if (reqData.payload.name) updateFields.name = reqData.payload.name;
        if (reqData.payload.mobile) updateFields.mobile = reqData.payload.mobile;
        if (reqData.payload.address) updateFields.address = reqData.payload.address;
        await db.doc(`customers/${customerId}`).update(updateFields);
      }
    }
  }

  // Update request record
  await requestRef.update({
    status: newStatus,
    reviewedBy: reviewerName,
    reviewedById: reviewerId,
    reviewedAt: now,
    reviewNote: reviewNote?.trim() || '',
    updatedAt: now,
  });

  // Create In-App Notification
  const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const title = action === 'APPROVE' ? 'Request Approved' : 'Request Rejected';
  const titleMr = action === 'APPROVE' ? 'अर्ज मंजूर झाला' : 'अर्ज नाकारला गेला';
  const message = action === 'APPROVE'
    ? `Your request (${reqData.type}) has been approved by admin.`
    : `Your request (${reqData.type}) was rejected. Reason: ${reviewNote}`;
  const messageMr = action === 'APPROVE'
    ? `तुमचा अर्ज (${reqData.type}) प्रशासकाकडून मंजूर करण्यात आला आहे.`
    : `तुमचा अर्ज (${reqData.type}) नाकारण्यात आला आहे. कारण: ${reviewNote}`;

  await db.doc(`notifications/${notifId}`).set({
    id: notifId,
    recipientPhone: reqData.customerPhone || '',
    recipientCustomerId: reqData.customerId || '',
    requestId,
    title,
    titleMr,
    message,
    messageMr,
    type: 'REQUEST_STATUS',
    status: newStatus,
    read: false,
    createdAt: now,
  });

  // Send FCM Push Notification
  if (reqData.fcmToken) {
    try {
      await admin.messaging().send({
        token: reqData.fcmToken,
        notification: {
          title: `नारायण भिशी: ${titleMr}`,
          body: messageMr,
        },
        data: {
          requestId,
          status: newStatus,
          type: reqData.type || '',
        },
      });
      console.log(`[reviewRequest] FCM push sent for request ${requestId}`);
    } catch (fcmErr) {
      console.warn(`[reviewRequest] FCM push notification failed:`, fcmErr);
    }
  }

  // Audit Log
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await db.doc(`audit_logs/${auditId}`).set({
    id: auditId,
    action: action === 'APPROVE' ? 'APPROVE_REQUEST' : 'REJECT_REQUEST',
    collection: 'requests',
    documentId: requestId,
    performedBy: reviewerName,
    performedById: reviewerId,
    details: {
      type: reqData.type,
      customerId: reqData.customerId,
      reviewNote: reviewNote || '',
    },
    timestamp: now,
  });

  return {
    success: true,
    status: newStatus,
    requestId,
    reviewedAt: now,
  };
});

import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { AuditLog } from '../types';

const AUDIT_STORAGE_KEY = 'nb_audit_logs';

export class AuditService {
  /**
   * Log any entity creation, modification, deletion, approval, rejection, or financial settlement.
   */
  static async record(entry: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> {
    const timestamp = new Date().toISOString();
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullLog: AuditLog = {
      ...entry,
      id,
      timestamp,
    };

    // 1. Save to local storage for fast immediate offline access
    try {
      const existing: AuditLog[] = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || '[]');
      existing.unshift(fullLog);
      // Keep last 500 audit entries locally
      if (existing.length > 500) existing.length = 500;
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
      console.warn('[AuditService] Local write note:', e);
    }

    // 2. Persist asynchronously to Cloud Firestore auditLogs collection
    try {
      await addDoc(collection(db, 'auditLogs'), fullLog);
    } catch (err) {
      console.warn('[AuditService] Cloud audit logging note:', err);
    }
  }

  static getRecentLogs(maxCount: number = 50): AuditLog[] {
    try {
      const existing: AuditLog[] = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || '[]');
      return existing.slice(0, maxCount);
    } catch {
      return [];
    }
  }

  static async fetchCloudLogs(maxCount: number = 100): Promise<AuditLog[]> {
    try {
      const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(maxCount));
      const snap = await getDocs(q);
      const items: AuditLog[] = [];
      snap.forEach((d: any) => items.push({ id: d.id, ...d.data() } as AuditLog));
      return items;
    } catch (err) {
      console.warn('[AuditService] Cloud fetch note:', err);
      return this.getRecentLogs(maxCount);
    }
  }
}

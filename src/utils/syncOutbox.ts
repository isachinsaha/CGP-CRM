import { Lead } from '../types.ts';

export interface LeadDraft {
  leadId: string;
  leadName: string;
  fields: Record<string, any>;
  tags?: string[];
  dirtyFields: string[];
  updatedAt: string;
}

export interface OutboxItem {
  id: string;
  leadId: string;
  leadName: string;
  phone?: string;
  payload: Record<string, any>;
  headers: {
    role: string;
    agentId: string;
    sourceView: string;
  };
  attempts: number;
  lastError: string;
  createdAt: string;
  lastAttemptAt?: string;
}

const DRAFTS_STORAGE_KEY = 'cgp_lead_drafts_v1';
const OUTBOX_STORAGE_KEY = 'cgp_sync_outbox_v1';
export const OUTBOX_CHANGED_EVENT = 'cgp-outbox-changed';
export const DRAFTS_CHANGED_EVENT = 'cgp-drafts-changed';

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function notifyOutboxChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
  }
}

function notifyDraftsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DRAFTS_CHANGED_EVENT));
  }
}

// ==========================================
// 1. LOCAL DRAFT AUTO-SAVE STORE
// ==========================================

export function getAllLeadDrafts(): Record<string, LeadDraft> {
  if (typeof localStorage === 'undefined') return {};
  return safeJsonParse<Record<string, LeadDraft>>(localStorage.getItem(DRAFTS_STORAGE_KEY), {});
}

export function loadLeadDraft(leadId: string): LeadDraft | null {
  if (!leadId) return null;
  const all = getAllLeadDrafts();
  return all[leadId] || null;
}

export function saveLeadDraft(draft: LeadDraft): void {
  if (typeof localStorage === 'undefined' || !draft?.leadId) return;
  try {
    const all = getAllLeadDrafts();
    all[draft.leadId] = {
      ...draft,
      updatedAt: draft.updatedAt || new Date().toISOString()
    };
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(all));
    notifyDraftsChanged();
  } catch (err) {
    console.warn('[DraftStore] Unable to persist lead draft locally:', err);
  }
}

export function clearLeadDraft(leadId: string): void {
  if (typeof localStorage === 'undefined' || !leadId) return;
  try {
    const all = getAllLeadDrafts();
    if (all[leadId]) {
      delete all[leadId];
      localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(all));
      notifyDraftsChanged();
    }
  } catch {
    // ignore storage errors
  }
}

export function hasAnyLeadDrafts(): boolean {
  const all = getAllLeadDrafts();
  return Object.keys(all).length > 0;
}

// ==========================================
// 2. PERSISTENT CLOUD RETRY OUTBOX
// ==========================================

export function getOutboxItems(): OutboxItem[] {
  if (typeof localStorage === 'undefined') return [];
  const parsed = safeJsonParse<OutboxItem[]>(localStorage.getItem(OUTBOX_STORAGE_KEY), []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveOutboxItems(items: OutboxItem[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
    notifyOutboxChanged();
  } catch (err) {
    console.warn('[SyncOutbox] Failed to save retry outbox to localStorage:', err);
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function enqueueOutboxSave(params: {
  leadId: string;
  leadName: string;
  phone?: string;
  payload: Record<string, any>;
  headers: { role: string; agentId: string; sourceView: string };
  lastError: string;
}): OutboxItem {
  const items = getOutboxItems();
  const existingIdx = items.findIndex(item => item.leadId === params.leadId);
  const nowIso = new Date().toISOString();

  if (existingIdx !== -1) {
    const existing = items[existingIdx];
    const mergedCleared = Array.from(
      new Set([
        ...(Array.isArray(existing.payload?.clearedRemarks) ? existing.payload.clearedRemarks : []),
        ...(Array.isArray(params.payload?.clearedRemarks) ? params.payload.clearedRemarks : [])
      ])
    );
    const updatedItem: OutboxItem = {
      ...existing,
      leadName: params.leadName || existing.leadName,
      phone: params.phone || existing.phone,
      payload: {
        ...existing.payload,
        ...params.payload,
        ...(mergedCleared.length > 0 ? { clearedRemarks: mergedCleared, allowClearRemarks: true } : {})
      },
      headers: params.headers,
      lastError: params.lastError,
      lastAttemptAt: nowIso
    };
    items[existingIdx] = updatedItem;
    saveOutboxItems(items);
    return updatedItem;
  }

  const newItem: OutboxItem = {
    id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    leadId: params.leadId,
    leadName: params.leadName || 'Candidate',
    phone: params.phone,
    payload: params.payload,
    headers: params.headers,
    attempts: 1,
    lastError: params.lastError,
    createdAt: nowIso,
    lastAttemptAt: nowIso
  };

  items.push(newItem);
  saveOutboxItems(items);
  return newItem;
}

export function removeOutboxItem(id: string): void {
  const items = getOutboxItems();
  const filtered = items.filter(item => item.id !== id);
  if (filtered.length !== items.length) {
    saveOutboxItems(filtered);
  }
}

let isFlushingOutbox = false;

export async function flushOutbox(
  onLeadSynced?: (lead: Lead) => void
): Promise<{ syncedCount: number; remainingCount: number; lastError?: string }> {
  if (isFlushingOutbox) {
    return { syncedCount: 0, remainingCount: getOutboxItems().length };
  }
  const initialItems = getOutboxItems();
  if (initialItems.length === 0) {
    return { syncedCount: 0, remainingCount: 0 };
  }

  isFlushingOutbox = true;
  let syncedCount = 0;
  let lastError: string | undefined;

  try {
    const remaining: OutboxItem[] = [];

    for (const item of initialItems) {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(item.leadId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-role': item.headers?.role || 'user',
            'x-agent-id': item.headers?.agentId || 'System',
            'x-source-view': `${item.headers?.sourceView || 'crm'}_outbox_retry`
          },
          body: JSON.stringify(item.payload)
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          syncedCount++;
          clearLeadDraft(item.leadId);
          if (onLeadSynced && data && data.id) {
            onLeadSynced(data as Lead);
          }
        } else if (!isRetryableHttpStatus(res.status)) {
          // Permanent 4xx rejection (e.g. validation error / duplicate phone / 404)
          // Keep outbox clean after surfacing error or drop if 404; for 400 keep with error? No, drop 404, keep others with clear error? Actually 400 will never succeed automatically, so keep visible error once or drop if 404.
          lastError = data?.error || `HTTP ${res.status}`;
          if (res.status !== 404) {
            remaining.push({
              ...item,
              attempts: (item.attempts || 0) + 1,
              lastError,
              lastAttemptAt: new Date().toISOString()
            });
          }
        } else {
          lastError = data?.error || `Cloud busy (HTTP ${res.status})`;
          remaining.push({
            ...item,
            attempts: (item.attempts || 0) + 1,
            lastError,
            lastAttemptAt: new Date().toISOString()
          });
        }
      } catch (err: any) {
        lastError = err?.message || 'Network offline';
        remaining.push({
          ...item,
          attempts: (item.attempts || 0) + 1,
          lastError,
          lastAttemptAt: new Date().toISOString()
        });
      }
    }

    // Re-read current storage in case new items were added mid-flush
    const latestItems = getOutboxItems();
    const initialIds = new Set(initialItems.map(i => i.id));
    const newlyAdded = latestItems.filter(i => !initialIds.has(i.id));
    const nextList = [...remaining, ...newlyAdded];
    saveOutboxItems(nextList);

    return {
      syncedCount,
      remainingCount: nextList.length,
      lastError
    };
  } finally {
    isFlushingOutbox = false;
  }
}

export function subscribeOutbox(callback: (items: OutboxItem[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback(getOutboxItems());
  window.addEventListener(OUTBOX_CHANGED_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(OUTBOX_CHANGED_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function hasUnsavedWork(): boolean {
  return getOutboxItems().length > 0 || hasAnyLeadDrafts();
}

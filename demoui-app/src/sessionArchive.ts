/**
 * Persistent session-history archive backed by browser localStorage.
 *
 * The chat library keeps the *live* conversation state in memory; this
 * module is where we snapshot a finished conversation so it survives
 * page reloads and can be replayed later by the upcoming session-history
 * UI.
 *
 * Schema notes:
 *  - We pin a `v1` suffix on the storage key so that future schema
 *    changes can migrate by version-bumping the key, not by rewriting
 *    in place.
 *  - Messages are serialised as plain objects (not ChatMessage class
 *    instances) so JSON.stringify works without losing data.
 *  - Blob URLs created by URL.createObjectURL (used for image / audio /
 *    file attachments) WILL go stale on reload; the URL string survives
 *    but no longer resolves. That's a known limitation until we upload
 *    file bytes to a real backend. Text, multiple-choice, and Lottie
 *    content survive round-trips perfectly.
 */

import type { ChatMessage } from '@chatscope/use-chat';
import type {
  MessageContentType,
  MessageDirection,
  MessageStatus,
} from '@chatscope/use-chat';

const STORAGE_KEY = 'pioneo:chat-sessions:v1';

export interface ArchivedMessage {
  id: string;
  contentType: MessageContentType;
  direction: MessageDirection;
  status: MessageStatus;
  senderId: string;
  createdTime: string; // ISO-8601
  updatedTime?: string; // ISO-8601
  content: unknown;
}

export interface ArchivedSession {
  /** Per-archive unique id. Independent from conversationId so the same
   *  conversation can be archived multiple times (one per finish). */
  id: string;
  conversationId: string;
  /** ISO timestamp the snapshot was taken. */
  archivedAt: string;
  /** Whatever was on Conversation.data at archive time (e.g. { done: true }). */
  data: Record<string, unknown>;
  messages: ArchivedMessage[];
}

function generateId(): string {
  return `arc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function serialiseMessage(m: ChatMessage<MessageContentType>): ArchivedMessage {
  return {
    id: m.id,
    contentType: m.contentType,
    direction: m.direction,
    status: m.status,
    senderId: m.senderId,
    createdTime:
      m.createdTime instanceof Date
        ? m.createdTime.toISOString()
        : new Date().toISOString(),
    updatedTime:
      m.updatedTime instanceof Date ? m.updatedTime.toISOString() : undefined,
    content: m.content,
  };
}

/**
 * Read all archived sessions in insertion order (oldest first).
 * Returns [] on any parse / storage error.
 */
export function loadArchivedSessions(): ArchivedSession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArchivedSession[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append a snapshot of a finished conversation to the archive.
 * Returns the newly stored record, or null if persistence failed
 * (quota, private-browsing, etc.).
 */
export function archiveSession(input: {
  conversationId: string;
  data?: Record<string, unknown>;
  messages: ChatMessage<MessageContentType>[];
}): ArchivedSession | null {
  const snapshot: ArchivedSession = {
    id: generateId(),
    conversationId: input.conversationId,
    archivedAt: new Date().toISOString(),
    data: input.data ?? {},
    messages: input.messages.map(serialiseMessage),
  };

  try {
    const existing = loadArchivedSessions();
    existing.push(snapshot);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    return snapshot;
  } catch {
    return null;
  }
}

/** Wipe the entire archive. Mostly useful for tests / a "clear history" UI. */
export function clearArchivedSessions(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

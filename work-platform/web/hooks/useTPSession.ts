"use client";

/**
 * useTPSession - Hook for managing Thinking Partner sessions
 *
 * Provides:
 * - Session CRUD operations
 * - Active session tracking
 * - Session list for basket
 *
 * See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  TPSession,
  TPSessionWithMessages,
  TPSessionCreateRequest,
} from "@/lib/types/thinking-partner";

// ============================================================================
// useTPSessions - List sessions for a basket
// ============================================================================

export interface UseTPSessionsOptions {
  /** Filter by status (default: 'active') */
  status?: 'active' | 'archived' | 'expired';
  /** Max sessions to return (default: 20) */
  limit?: number;
  /** Auto-fetch on mount (default: true) */
  autoFetch?: boolean;
}

export function useTPSessions(basketId: string, options: UseTPSessionsOptions = {}) {
  const { status = 'active', limit = 20, autoFetch = true } = options;

  const [sessions, setSessions] = useState<TPSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!basketId) return;

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        basket_id: basketId,
        status,
        limit: String(limit),
      });

      const response = await fetch(`/api/tp/sessions?${params}`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to view sessions');
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch sessions');
      }

      const data = await response.json();
      setSessions(data || []);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useTPSessions] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [basketId, status, limit]);

  useEffect(() => {
    if (autoFetch) {
      fetchSessions();
    }
  }, [fetchSessions, autoFetch]);

  // Create a new session
  const createSession = useCallback(async (title?: string) => {
    try {
      const body: TPSessionCreateRequest = {
        basket_id: basketId,
        title,
      };

      const response = await fetch('/api/tp/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create session');
      }

      const newSession = await response.json();

      // Add to local state
      setSessions(prev => [newSession, ...prev]);

      return newSession as TPSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    }
  }, [basketId]);

  // Archive a session
  const archiveSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/tp/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to archive session');
      }

      // Remove from local state
      setSessions(prev => prev.filter(s => s.id !== sessionId));

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    }
  }, []);

  return {
    sessions,
    loading,
    error,
    refetch: fetchSessions,
    createSession,
    archiveSession,
  };
}

// ============================================================================
// useTPSession - Get single session with messages
// ============================================================================

export function useTPSession(sessionId: string | null) {
  const [session, setSession] = useState<TPSessionWithMessages | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/tp/sessions/${sessionId}`);

      if (!response.ok) {
        if (response.status === 404) {
          setSession(null);
          return null;
        }
        if (response.status === 401) {
          throw new Error('Please sign in to view session');
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch session');
      }

      const data = await response.json();
      setSession(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useTPSession] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  return {
    session,
    messages: session?.messages || [],
    loading,
    error,
    refetch: fetchSession,
  };
}

// ============================================================================
// useActiveTPSession - Manages the active session for a basket
// ============================================================================

export function useActiveTPSession(basketId: string) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { sessions, loading: sessionsLoading, createSession, archiveSession } = useTPSessions(basketId);
  const { session, messages, loading: sessionLoading, refetch: refetchSession } = useTPSession(activeSessionId);

  // Auto-select most recent active session
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  // Start a new session
  const startNewSession = useCallback(async (title?: string) => {
    const newSession = await createSession(title);
    setActiveSessionId(newSession.id);
    return newSession;
  }, [createSession]);

  // Switch to a different session
  const switchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  // Archive current session and switch to another
  const archiveCurrentSession = useCallback(async () => {
    if (!activeSessionId) return;

    await archiveSession(activeSessionId);

    // Switch to next available session
    const remaining = sessions.filter(s => s.id !== activeSessionId);
    if (remaining.length > 0) {
      setActiveSessionId(remaining[0].id);
    } else {
      setActiveSessionId(null);
    }
  }, [activeSessionId, archiveSession, sessions]);

  return {
    // Current session
    sessionId: activeSessionId,
    session,
    messages,

    // All sessions
    sessions,

    // Loading states
    loading: sessionsLoading || sessionLoading,

    // Actions
    startNewSession,
    switchSession,
    archiveCurrentSession,
    refetchSession,
  };
}

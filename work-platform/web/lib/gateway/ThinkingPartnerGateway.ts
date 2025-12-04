/**
 * Thinking Partner Gateway (v2.0)
 *
 * Centralized orchestration layer for TP chat and state management.
 * Updated for session persistence and context management.
 *
 * See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  TPChatRequest,
  TPChatResponse,
  TPSession,
  TPSessionWithMessages,
  TPMessage,
  TPContextChange,
  WorkOutput,
  WorkTicketStatus,
  TPCapabilities,
} from '@/lib/types/thinking-partner';
import { fetchWithToken } from '@/lib/fetchWithToken';

/**
 * ThinkingPartnerGateway
 *
 * Manages chat interactions, session state, and real-time updates for TP.
 */
export class ThinkingPartnerGateway {
  private basketId: string;
  private workspaceId: string;
  private sessionId: string | null = null;
  private subscription: RealtimeChannel | null = null;

  // Callbacks
  private onContextChangeCallback?: (changes: TPContextChange[]) => void;
  private onWorkOutputCallback?: (outputs: WorkOutput[]) => void;
  private onMessageCallback?: (message: TPMessage) => void;

  constructor(basketId: string, workspaceId: string) {
    this.basketId = basketId;
    this.workspaceId = workspaceId;
  }

  /**
   * Send message to TP and get response
   */
  async chat(message: string): Promise<TPChatResponse> {
    const request: TPChatRequest = {
      basket_id: this.basketId,
      message,
      session_id: this.sessionId,
    };

    const response = await fetchWithToken('/api/tp/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to chat with Thinking Partner');
    }

    const data: TPChatResponse = await response.json();

    // Update session ID for continuity
    if (data.session_id) {
      this.sessionId = data.session_id;
    }

    // Fire callbacks
    if (data.context_changes?.length > 0 && this.onContextChangeCallback) {
      this.onContextChangeCallback(data.context_changes);
    }
    if (data.work_outputs?.length > 0 && this.onWorkOutputCallback) {
      this.onWorkOutputCallback(data.work_outputs);
    }

    return data;
  }

  /**
   * List sessions for this basket
   */
  async listSessions(status: 'active' | 'archived' = 'active', limit = 20): Promise<TPSession[]> {
    const params = new URLSearchParams({
      basket_id: this.basketId,
      status,
      limit: String(limit),
    });

    const response = await fetchWithToken(`/api/tp/sessions?${params}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to list sessions');
    }

    return await response.json();
  }

  /**
   * Get session with messages
   */
  async getSession(sessionId?: string): Promise<TPSessionWithMessages | null> {
    const targetId = sessionId || this.sessionId;
    if (!targetId) {
      return null;
    }

    const response = await fetchWithToken(`/api/tp/sessions/${targetId}`);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to get session');
    }

    return await response.json();
  }

  /**
   * Create a new session
   */
  async createSession(title?: string): Promise<TPSession> {
    const response = await fetchWithToken('/api/tp/sessions', {
      method: 'POST',
      body: JSON.stringify({
        basket_id: this.basketId,
        title,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create session');
    }

    const session = await response.json();
    this.sessionId = session.id;
    return session;
  }

  /**
   * Archive a session
   */
  async archiveSession(sessionId: string): Promise<void> {
    const response = await fetchWithToken(`/api/tp/sessions/${sessionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to archive session');
    }

    // Clear session if it was the active one
    if (this.sessionId === sessionId) {
      this.sessionId = null;
    }
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<TPSessionWithMessages | null> {
    const session = await this.getSession(sessionId);
    if (session) {
      this.sessionId = sessionId;
    }
    return session;
  }

  /**
   * Get TP capabilities
   */
  async getCapabilities(): Promise<TPCapabilities> {
    const response = await fetch('/api/tp/capabilities');

    if (!response.ok) {
      throw new Error('Failed to fetch TP capabilities');
    }

    return await response.json();
  }

  /**
   * Set callback for context changes
   */
  onContextChange(callback: (changes: TPContextChange[]) => void): void {
    this.onContextChangeCallback = callback;
  }

  /**
   * Set callback for work outputs
   */
  onWorkOutput(callback: (outputs: WorkOutput[]) => void): void {
    this.onWorkOutputCallback = callback;
  }

  /**
   * Set callback for new messages (for real-time updates)
   */
  onMessage(callback: (message: TPMessage) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * Subscribe to work ticket updates (real-time)
   *
   * TODO: Implement Supabase Realtime subscription
   */
  subscribeToWorkUpdates(
    callback: (update: WorkTicketStatus) => void
  ): RealtimeChannel | null {
    // TODO: Implement Supabase Realtime subscription
    return null;
  }

  /**
   * Unsubscribe from all subscriptions
   */
  unsubscribe(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Clear session (start fresh)
   */
  clearSession(): void {
    this.sessionId = null;
  }

  /**
   * Get basket and workspace IDs
   */
  getContext(): { basketId: string; workspaceId: string } {
    return {
      basketId: this.basketId,
      workspaceId: this.workspaceId,
    };
  }

  // ============================================================================
  // Backward Compatibility (deprecated)
  // ============================================================================

  /** @deprecated Use getSessionId() instead */
  getSessionIds(): { sessionId: string | null; claudeSessionId: string | null } {
    return {
      sessionId: this.sessionId,
      claudeSessionId: null, // No longer used
    };
  }
}

/**
 * Factory function to create ThinkingPartnerGateway
 */
export function createTPGateway(
  basketId: string,
  workspaceId: string
): ThinkingPartnerGateway {
  return new ThinkingPartnerGateway(basketId, workspaceId);
}

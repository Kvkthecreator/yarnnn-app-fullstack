"use client";

/**
 * useTPChat - Hook for Thinking Partner chat interactions
 *
 * Provides:
 * - Send message with session management
 * - Message state tracking
 * - Context change notifications
 * - Work output tracking
 *
 * See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
 */

import { useCallback, useState } from "react";
import type {
  TPMessage,
  TPChatRequest,
  TPChatResponse,
  TPToolCall,
  TPContextChange,
  WorkOutput,
} from "@/lib/types/thinking-partner";

// ============================================================================
// Types
// ============================================================================

export interface TPChatState {
  messages: TPMessage[];
  isLoading: boolean;
  error: string | null;
  sessionId: string | null;
}

export interface SendMessageResult {
  success: boolean;
  response?: TPChatResponse;
  error?: string;
}

// ============================================================================
// useTPChat
// ============================================================================

export interface UseTPChatOptions {
  /** Basket ID */
  basketId: string;
  /** Initial session ID (optional - will create new if not provided) */
  sessionId?: string | null;
  /** Initial messages to populate (e.g., from session fetch) */
  initialMessages?: TPMessage[];
  /** Callback when context changes */
  onContextChange?: (changes: TPContextChange[]) => void;
  /** Callback when work outputs are created */
  onWorkOutput?: (outputs: WorkOutput[]) => void;
}

export function useTPChat(options: UseTPChatOptions) {
  const {
    basketId,
    sessionId: initialSessionId = null,
    initialMessages = [],
    onContextChange,
    onWorkOutput,
  } = options;

  const [messages, setMessages] = useState<TPMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);

  // Last response metadata
  const [lastToolCalls, setLastToolCalls] = useState<TPToolCall[]>([]);
  const [lastContextChanges, setLastContextChanges] = useState<TPContextChange[]>([]);
  const [lastWorkOutputs, setLastWorkOutputs] = useState<WorkOutput[]>([]);

  /**
   * Send a message to TP
   */
  const sendMessage = useCallback(async (content: string): Promise<SendMessageResult> => {
    if (!content.trim()) {
      return { success: false, error: "Message cannot be empty" };
    }

    // Create optimistic user message
    const userMessage: TPMessage = {
      id: `temp-${Date.now()}`,
      session_id: sessionId || '',
      role: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
    };

    // Add user message immediately
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const request: TPChatRequest = {
        basket_id: basketId,
        message: content.trim(),
        session_id: sessionId,
      };

      const response = await fetch('/api/tp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.detail || 'Failed to send message';
        setError(errorMessage);

        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== userMessage.id));

        return { success: false, error: errorMessage };
      }

      const data: TPChatResponse = await response.json();

      // Update session ID
      setSessionId(data.session_id);

      // Create assistant message from response
      const assistantMessage: TPMessage = {
        id: data.message_id,
        session_id: data.session_id,
        role: 'assistant',
        content: data.message,
        tool_calls: data.tool_calls,
        work_output_ids: data.work_outputs.map(wo => wo.id),
        created_at: new Date().toISOString(),
      };

      // Replace temp user message with real one and add assistant message
      setMessages(prev => [
        ...prev.filter(m => m.id !== userMessage.id),
        { ...userMessage, session_id: data.session_id },
        assistantMessage,
      ]);

      // Track tool calls and changes
      setLastToolCalls(data.tool_calls);
      setLastContextChanges(data.context_changes);
      setLastWorkOutputs(data.work_outputs);

      // Fire callbacks
      if (data.context_changes.length > 0 && onContextChange) {
        onContextChange(data.context_changes);
      }
      if (data.work_outputs.length > 0 && onWorkOutput) {
        onWorkOutput(data.work_outputs);
      }

      return { success: true, response: data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);

      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));

      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, [basketId, sessionId, onContextChange, onWorkOutput]);

  /**
   * Clear all messages (start fresh conversation)
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    setLastToolCalls([]);
    setLastContextChanges([]);
    setLastWorkOutputs([]);
  }, []);

  /**
   * Load messages from an existing session
   */
  const loadMessages = useCallback((newMessages: TPMessage[], newSessionId: string) => {
    setMessages(newMessages);
    setSessionId(newSessionId);
    setError(null);
  }, []);

  /**
   * Retry last message (after error)
   */
  const retryLast = useCallback(async () => {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMessage) {
      // Remove the failed message
      setMessages(prev => prev.filter(m => m.id !== lastUserMessage.id));
      // Retry
      return sendMessage(lastUserMessage.content);
    }
    return { success: false, error: "No message to retry" };
  }, [messages, sendMessage]);

  return {
    // State
    messages,
    isLoading,
    error,
    sessionId,

    // Last response metadata
    lastToolCalls,
    lastContextChanges,
    lastWorkOutputs,

    // Actions
    sendMessage,
    clearMessages,
    loadMessages,
    retryLast,
  };
}

// ============================================================================
// useTPCapabilities - Get TP feature flags
// ============================================================================

export interface TPCapabilitiesState {
  capabilities: {
    chat: boolean;
    streaming: boolean;
    context_management: boolean;
    work_orchestration: boolean;
    governance: boolean;
    session_persistence: boolean;
  } | null;
  loading: boolean;
  error: string | null;
}

export function useTPCapabilities() {
  const [capabilities, setCapabilities] = useState<TPCapabilitiesState['capabilities']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCapabilities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/tp/capabilities');

      if (!response.ok) {
        throw new Error('Failed to fetch TP capabilities');
      }

      const data = await response.json();

      // Extract feature flags
      setCapabilities({
        chat: data.features?.chat?.enabled ?? false,
        streaming: data.features?.chat?.streaming ?? false,
        context_management: data.features?.context_management?.enabled ?? false,
        work_orchestration: data.features?.work_orchestration?.enabled ?? false,
        governance: data.features?.governance?.enabled ?? false,
        session_persistence: data.features?.session_persistence?.enabled ?? false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useState(() => {
    fetchCapabilities();
  });

  return {
    capabilities,
    loading,
    error,
    refetch: fetchCapabilities,
    isEnabled: capabilities?.chat ?? false,
  };
}

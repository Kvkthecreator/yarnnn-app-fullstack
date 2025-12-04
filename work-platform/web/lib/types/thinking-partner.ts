/**
 * Thinking Partner Types (v2.0)
 *
 * Types for TP chat interface, session management, and work lifecycle.
 * Updated for new session persistence and context management.
 *
 * See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
 */

// ============================================================================
// TP State & Phases
// ============================================================================

/**
 * TP state phases for visual state morphing in LiveContextPane
 */
export type TPPhase =
  | 'idle'           // TP is idle, showing substrate overview
  | 'planning'       // TP is planning multi-step workflow (steps_planner tool)
  | 'delegating'     // TP is delegating to specialized agent (agent_orchestration tool)
  | 'executing'      // Agent is executing work (work_ticket running)
  | 'reviewing'      // TP is reviewing work outputs
  | 'responding';    // TP is formulating response

/**
 * TP state for ambient co-presence visualization
 */
export interface TPState {
  phase: TPPhase;

  // Planning phase
  plan?: WorkflowPlan;

  // Delegating phase
  selectedAgent?: AgentDelegation;

  // Executing phase
  workTicket?: WorkTicketStatus;

  // Reviewing phase
  outputs?: WorkOutput[];

  // Meta
  lastAction?: string;
  timestamp: string;
}

/**
 * Workflow plan from steps_planner tool
 */
export interface WorkflowPlan {
  steps: WorkflowStep[];
  estimatedDuration?: string;
  dependencies: string[];
}

export interface WorkflowStep {
  stepNumber: number;
  description: string;
  agent: 'research' | 'content' | 'reporting';
  dependencies: number[];  // Step numbers this depends on
  status: 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * Agent delegation info
 */
export interface AgentDelegation {
  agentType: 'research' | 'content' | 'reporting';
  task: string;
  parameters?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed';
}

/**
 * Work ticket execution status
 */
export interface WorkTicketStatus {
  id: string;
  agentType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: {
    currentStep?: string;
    completedSteps?: number;
    totalSteps?: number;
  };
  startedAt?: string;
  completedAt?: string;
}

/**
 * Work output from agent or TP
 */
export interface WorkOutput {
  id: string;
  outputType: string;
  title: string;
  body?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  sourceBlockIds?: string[];
  createdAt: string;
}

// ============================================================================
// Chat Messages (v2.0 - with DB persistence)
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * TP message as stored in tp_messages table
 */
export interface TPMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  tool_calls?: TPToolCall[];
  work_output_ids?: string[];
  created_at: string;
}

/**
 * Tool call record for display
 */
export interface TPToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/**
 * Context change record for display
 */
export interface TPContextChange {
  item_type: string;
  action: 'written' | 'proposed' | 'unknown';
}

// ============================================================================
// API Request/Response Types (v2.0)
// ============================================================================

/**
 * Request to send a chat message
 */
export interface TPChatRequest {
  basket_id: string;
  message: string;
  session_id?: string | null;
}

/**
 * Response from TP chat
 */
export interface TPChatResponse {
  message: string;
  session_id: string;
  message_id: string;
  tool_calls: TPToolCall[];
  work_outputs: WorkOutput[];
  context_changes: TPContextChange[];
}

/**
 * TP Session (from tp_sessions table)
 */
export interface TPSession {
  id: string;
  basket_id: string;
  workspace_id: string;
  title?: string;
  summary?: string;
  status: 'active' | 'archived' | 'expired';
  message_count: number;
  last_message_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Session with messages included
 */
export interface TPSessionWithMessages extends TPSession {
  messages: TPMessage[];
}

/**
 * Request to create a new session
 */
export interface TPSessionCreateRequest {
  basket_id: string;
  title?: string;
}

// ============================================================================
// TP Capabilities
// ============================================================================

export interface TPCapabilities {
  description: string;
  status: 'active' | 'disabled' | 'migration';
  features: {
    chat: { enabled: boolean; streaming: boolean; description: string };
    context_management: { enabled: boolean; tools: string[]; description: string };
    work_orchestration: { enabled: boolean; tools: string[]; description: string };
    governance: { enabled: boolean; description: string };
    session_persistence: { enabled: boolean; description: string };
  };
  context_tiers: {
    foundation: { types: string[]; governance: string };
    working: { types: string[]; governance: string };
    ephemeral: { types: string[]; governance: string };
  };
}

// ============================================================================
// Chat UI State
// ============================================================================

export interface ChatState {
  messages: TPMessage[];
  isLoading: boolean;
  error?: string;
  sessionId?: string | null;
}

// ============================================================================
// Legacy Types (backward compatibility)
// ============================================================================

/** @deprecated Use TPChatRequest with session_id instead */
export interface LegacyTPChatRequest {
  basket_id: string;
  message: string;
  claude_session_id?: string | null;
}

/** @deprecated Use TPChatResponse with session_id instead */
export interface LegacyTPChatResponse {
  message: string;
  claude_session_id: string | null;
  session_id?: string | null;
  work_outputs: WorkOutput[];
  actions_taken: string[];
}

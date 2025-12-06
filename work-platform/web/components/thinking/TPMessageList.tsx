'use client';

/**
 * TPMessageList (v3.0 - Chat-First Architecture)
 *
 * Displays list of chat messages with TP.
 * Supports rich in-chat displays: context cards, work outputs, recipe progress.
 *
 * See:
 * - /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 * - /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
 */

import type {
  TPMessage,
  TPToolCall,
  TPContextChangeRich,
  TPWorkOutputPreview,
} from '@/lib/types/thinking-partner';
import { cn } from '@/lib/utils';
import { CheckCircle2, User, Bot, Wrench, FileEdit, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import {
  ContextChangesGroup,
  WorkOutputCarousel,
  RecipeProgressCard,
  ExecutionStepsTimeline,
} from './chat-cards';

interface TPMessageListProps {
  messages: TPMessage[];
  onNavigateToContext?: (itemId: string) => void;
  onNavigateToOutput?: (outputId: string) => void;
  onNavigateToTicket?: (ticketId: string) => void;
  onViewAllContext?: () => void;
}

export function TPMessageList({
  messages,
  onNavigateToContext,
  onNavigateToOutput,
  onNavigateToTicket,
  onViewAllContext,
}: TPMessageListProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <TPMessageCard
          key={message.id}
          message={message}
          onNavigateToContext={onNavigateToContext}
          onNavigateToOutput={onNavigateToOutput}
          onNavigateToTicket={onNavigateToTicket}
          onViewAllContext={onViewAllContext}
        />
      ))}
    </div>
  );
}

interface TPMessageCardProps {
  message: TPMessage;
  onNavigateToContext?: (itemId: string) => void;
  onNavigateToOutput?: (outputId: string) => void;
  onNavigateToTicket?: (ticketId: string) => void;
  onViewAllContext?: () => void;
}

function TPMessageCard({
  message,
  onNavigateToContext,
  onNavigateToOutput,
  onNavigateToTicket,
  onViewAllContext,
}: TPMessageCardProps) {
  const isUser = message.role === 'user';

  // Get timestamp from created_at (v2.0) or timestamp (legacy)
  const timestamp = message.created_at || (message as { timestamp?: string }).timestamp;

  // Check for rich display data (v3.0)
  const hasContextChanges = message.context_changes && message.context_changes.length > 0;
  const hasWorkOutputs = message.work_outputs && message.work_outputs.length > 0;
  const hasRecipeExecution = !!message.recipe_execution;
  const hasExecutionSteps = message.execution_steps && message.execution_steps.length > 0;

  // Fallback to work_output_ids if no rich work_outputs
  const hasLegacyOutputs = !hasWorkOutputs &&
    message.work_output_ids && message.work_output_ids.length > 0;

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}

      {/* Message content */}
      <div
        className={cn(
          'max-w-[80%] space-y-2 rounded-lg p-4',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-card'
        )}
      >
        {/* Message text */}
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>

        {/* Tool calls (v2.0) - shown if no rich displays */}
        {message.tool_calls && message.tool_calls.length > 0 &&
         !hasContextChanges && !hasWorkOutputs && !hasRecipeExecution && (
          <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
            <div className="text-xs font-medium text-muted-foreground">
              Tools Used:
            </div>
            <ul className="space-y-1">
              {message.tool_calls.map((call, idx) => (
                <ToolCallPreview key={idx} call={call} />
              ))}
            </ul>
          </div>
        )}

        {/* v3.0: Rich context changes display */}
        {hasContextChanges && (
          <ContextChangesGroup
            changes={message.context_changes as TPContextChangeRich[]}
            onNavigate={onNavigateToContext}
            onViewAll={onViewAllContext}
          />
        )}

        {/* v3.0: Rich work outputs display */}
        {hasWorkOutputs && (
          <WorkOutputCarousel
            outputs={message.work_outputs as TPWorkOutputPreview[]}
            onViewFull={onNavigateToOutput}
          />
        )}

        {/* v3.0: Recipe execution progress */}
        {hasRecipeExecution && (
          <RecipeProgressCard
            execution={message.recipe_execution!}
            steps={message.execution_steps}
            onTrack={onNavigateToTicket}
          />
        )}

        {/* v3.0: Execution steps timeline (standalone, without recipe) */}
        {hasExecutionSteps && !hasRecipeExecution && (
          <ExecutionStepsTimeline
            steps={message.execution_steps!}
            collapsible
          />
        )}

        {/* Legacy: Work output IDs only (fallback) */}
        {hasLegacyOutputs && (
          <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileEdit className="h-3 w-3" />
              {message.work_output_ids!.length} output{message.work_output_ids!.length > 1 ? 's' : ''} created
            </div>
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <div className="mt-2 text-xs text-muted-foreground/70">
            {new Date(timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Avatar (user) */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

interface ToolCallPreviewProps {
  call: TPToolCall;
}

function ToolCallPreview({ call }: ToolCallPreviewProps) {
  // Get tool icon based on name
  const getToolIcon = (name: string) => {
    if (name.includes('context')) return <ListChecks className="h-3 w-3" />;
    if (name.includes('recipe')) return <FileEdit className="h-3 w-3" />;
    return <Wrench className="h-3 w-3" />;
  };

  // Format tool result for display
  const getResultStatus = (result?: Record<string, unknown>) => {
    if (!result) return null;
    if (result.success) return { status: 'success', message: result.message as string };
    if (result.error) return { status: 'error', message: result.error as string };
    if (result.action === 'proposed') return { status: 'pending', message: 'Awaiting approval' };
    return null;
  };

  const resultStatus = getResultStatus(call.result);

  const itemType = call.input?.item_type as string | undefined;

  return (
    <li className="flex items-start gap-2 text-xs text-muted-foreground">
      {getToolIcon(call.name)}
      <div className="flex-1">
        <span className="font-medium">{call.name}</span>
        {itemType && (
          <span className="ml-1">({itemType})</span>
        )}
        {resultStatus && (
          <span
            className={cn(
              'ml-2',
              resultStatus.status === 'success' && 'text-green-600',
              resultStatus.status === 'error' && 'text-red-600',
              resultStatus.status === 'pending' && 'text-amber-600'
            )}
          >
            {resultStatus.status === 'success' && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
            {resultStatus.message}
          </span>
        )}
      </div>
    </li>
  );
}

// ============================================================================
// Legacy Support (for backward compatibility)
// ============================================================================

interface WorkOutputPreviewProps {
  output: {
    id: string;
    outputType: string;
    title: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  };
}

function WorkOutputPreview({ output }: WorkOutputPreviewProps) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {output.outputType}
            </Badge>
            {output.confidence !== undefined && (
              <span className="text-xs text-muted-foreground">
                {Math.round(output.confidence * 100)}% confidence
              </span>
            )}
          </div>
          <div className="mt-1 text-sm font-medium">{output.title}</div>
        </div>
      </div>
    </div>
  );
}

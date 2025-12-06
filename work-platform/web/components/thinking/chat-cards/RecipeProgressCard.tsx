'use client';

/**
 * RecipeProgressCard
 *
 * Displays recipe execution progress in chat messages.
 * Shows real-time status updates, progress bar, and step information.
 *
 * Part of Chat-First Architecture v1.0
 * See: /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 */

import type { TPRecipeExecution, TPExecutionStep } from '@/lib/types/thinking-partner';
import { cn } from '@/lib/utils';
import {
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Pause,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useState } from 'react';

interface RecipeProgressCardProps {
  execution: TPRecipeExecution;
  steps?: TPExecutionStep[];
  onTrack?: (ticketId: string) => void;
}

// Status to display mapping
const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bgColor: string;
  Icon: React.ElementType;
  animate?: boolean;
}> = {
  queued: {
    label: 'Queued',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50 border-muted-foreground/20',
    Icon: Clock,
  },
  running: {
    label: 'Running',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200',
    Icon: Loader2,
    animate: true,
  },
  completed: {
    label: 'Completed',
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200',
    Icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    color: 'text-red-600',
    bgColor: 'bg-red-50 border-red-200',
    Icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 border-gray-200',
    Icon: Pause,
  },
};

export function RecipeProgressCard({
  execution,
  steps,
  onTrack,
}: RecipeProgressCardProps) {
  const [showSteps, setShowSteps] = useState(false);
  const statusConfig = STATUS_CONFIG[execution.status] || STATUS_CONFIG.queued;
  const isRunning = execution.status === 'running';

  const handleClick = () => {
    if (onTrack) {
      onTrack(execution.ticket_id);
    }
  };

  // Calculate duration if available
  const getDuration = () => {
    if (execution.started_at && execution.completed_at) {
      const start = new Date(execution.started_at).getTime();
      const end = new Date(execution.completed_at).getTime();
      const durationMs = end - start;
      if (durationMs < 60000) {
        return `${Math.round(durationMs / 1000)}s`;
      }
      return `${Math.round(durationMs / 60000)}m`;
    }
    return execution.estimated_duration;
  };

  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <div
        className={cn(
          'rounded-lg border p-3 transition-colors',
          statusConfig.bgColor,
          onTrack && 'cursor-pointer hover:opacity-90'
        )}
        onClick={handleClick}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={cn(
              'rounded-md p-1.5',
              isRunning ? 'bg-blue-100' : 'bg-primary/10'
            )}>
              <statusConfig.Icon
                className={cn(
                  'h-4 w-4',
                  statusConfig.color,
                  statusConfig.animate && 'animate-spin'
                )}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {execution.recipe_name || execution.recipe_slug}
                </span>
                <Badge
                  variant="outline"
                  className={cn('text-xs', statusConfig.color)}
                >
                  {statusConfig.label}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {execution.current_step && isRunning && (
                  <span>{execution.current_step}</span>
                )}
                {getDuration() && (
                  <>
                    {execution.current_step && <span>·</span>}
                    <span>{getDuration()}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {steps && steps.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSteps(!showSteps);
                }}
                className="p-1 hover:bg-black/5 rounded"
              >
                {showSteps ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            )}
            {onTrack && (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Progress bar */}
        {execution.progress_pct !== undefined && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span>{execution.progress_pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-black/10 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  isRunning ? 'bg-blue-500' : 'bg-primary'
                )}
                style={{ width: `${execution.progress_pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Execution steps */}
        {showSteps && steps && steps.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-border/30 pt-3">
            {steps.map((step) => (
              <ExecutionStepItem key={step.step_number} step={step} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ExecutionStepItemProps {
  step: TPExecutionStep;
}

function ExecutionStepItem({ step }: ExecutionStepItemProps) {
  const getStepIcon = () => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle2 className="h-3 w-3 text-green-600" />;
      case 'running':
        return <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-red-600" />;
      case 'skipped':
        return <AlertCircle className="h-3 w-3 text-muted-foreground" />;
      default:
        return <Clock className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 60000)}m`;
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-4 text-center text-muted-foreground">
        {step.step_number}
      </span>
      {getStepIcon()}
      <span
        className={cn(
          'flex-1',
          step.status === 'completed' && 'text-muted-foreground',
          step.status === 'running' && 'font-medium',
          step.status === 'pending' && 'text-muted-foreground'
        )}
      >
        {step.description}
      </span>
      {step.duration_ms !== undefined && step.status === 'completed' && (
        <span className="text-muted-foreground">
          {formatDuration(step.duration_ms)}
        </span>
      )}
    </div>
  );
}

/**
 * ExecutionStepsTimeline
 *
 * Standalone timeline view for workflow steps.
 */
interface ExecutionStepsTimelineProps {
  steps: TPExecutionStep[];
  collapsible?: boolean;
}

export function ExecutionStepsTimeline({
  steps,
  collapsible = true,
}: ExecutionStepsTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(!collapsible);

  if (steps.length === 0) {
    return null;
  }

  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const totalDuration = steps
    .filter((s) => s.duration_ms)
    .reduce((sum, s) => sum + (s.duration_ms || 0), 0);

  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <div
        className={cn(
          'flex items-center justify-between text-xs text-muted-foreground',
          collapsible && 'cursor-pointer'
        )}
        onClick={() => collapsible && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">Execution Steps</span>
          <span>
            {completedCount}/{steps.length} completed
          </span>
          {totalDuration > 0 && (
            <>
              <span>·</span>
              <span>{(totalDuration / 1000).toFixed(1)}s total</span>
            </>
          )}
        </div>
        {collapsible && (
          isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )
        )}
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-1">
          {steps.map((step) => (
            <ExecutionStepItem key={step.step_number} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

export default RecipeProgressCard;

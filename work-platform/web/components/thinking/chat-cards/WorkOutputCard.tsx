'use client';

/**
 * WorkOutputCard
 *
 * Displays a work output preview in chat messages.
 * Shows output type, title, preview, status, and confidence.
 *
 * Part of Chat-First Architecture v1.0
 * See: /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 */

import type { TPWorkOutputPreview } from '@/lib/types/thinking-partner';
import { cn } from '@/lib/utils';
import {
  FileText,
  Lightbulb,
  MessageSquare,
  TrendingUp,
  FileEdit,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface WorkOutputCardProps {
  output: TPWorkOutputPreview;
  onViewFull?: (outputId: string) => void;
  compact?: boolean;
}

// Output type to icon mapping
const OUTPUT_TYPE_ICONS: Record<string, React.ElementType> = {
  finding: Lightbulb,
  recommendation: TrendingUp,
  insight: Lightbulb,
  content_draft: FileEdit,
  content_variant: FileEdit,
  content_asset: FileText,
  document: FileText,
  error: AlertCircle,
  default: FileText,
};

// Status to display mapping
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; Icon: React.ElementType }> = {
  pending_review: {
    label: 'Pending Review',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200',
    Icon: Clock,
  },
  approved: {
    label: 'Approved',
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200',
    Icon: CheckCircle2,
  },
  rejected: {
    label: 'Rejected',
    color: 'text-red-600',
    bgColor: 'bg-red-50 border-red-200',
    Icon: XCircle,
  },
  revision_requested: {
    label: 'Revision Requested',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 border-orange-200',
    Icon: RotateCcw,
  },
};

// Agent type to label mapping
const AGENT_LABELS: Record<string, string> = {
  research: 'Research Agent',
  content: 'Content Agent',
  reporting: 'Reporting Agent',
  thinking_partner: 'Thinking Partner',
};

export function WorkOutputCard({
  output,
  onViewFull,
  compact = false,
}: WorkOutputCardProps) {
  const IconComponent = OUTPUT_TYPE_ICONS[output.output_type] || OUTPUT_TYPE_ICONS.default;
  const statusConfig = STATUS_CONFIG[output.supervision_status] || STATUS_CONFIG.pending_review;

  const handleClick = () => {
    if (onViewFull) {
      onViewFull(output.id);
    }
  };

  if (compact) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
          statusConfig.bgColor,
          onViewFull && 'cursor-pointer hover:opacity-80'
        )}
        onClick={handleClick}
      >
        <IconComponent className="h-3 w-3" />
        <span className="font-medium">{output.title || output.output_type}</span>
        <statusConfig.Icon className={cn('h-3 w-3', statusConfig.color)} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 transition-colors',
        onViewFull && 'cursor-pointer hover:bg-muted/50'
      )}
      onClick={handleClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1.5">
            <IconComponent className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {output.title || 'Untitled Output'}
              </span>
              <Badge variant="outline" className="text-xs capitalize">
                {output.output_type.replace('_', ' ')}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className={cn('flex items-center gap-1', statusConfig.color)}>
                <statusConfig.Icon className="h-3 w-3" />
                <span>{statusConfig.label}</span>
              </div>
              {output.agent_type && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    {AGENT_LABELS[output.agent_type] || output.agent_type}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {output.confidence !== undefined && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{Math.round(output.confidence * 100)}%</span>
            </div>
          )}
          {onViewFull && (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Preview */}
      {output.body_preview && (
        <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {output.body_preview}
        </div>
      )}

      {/* Confidence bar */}
      {output.confidence !== undefined && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full',
                output.confidence >= 0.8 ? 'bg-green-500' :
                output.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
              )}
              style={{ width: `${output.confidence * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Timestamp */}
      {output.created_at && (
        <div className="mt-2 text-xs text-muted-foreground/70">
          {new Date(output.created_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}

/**
 * WorkOutputCarousel
 *
 * Displays multiple work outputs in a horizontal scrolling carousel.
 */
interface WorkOutputCarouselProps {
  outputs: TPWorkOutputPreview[];
  onViewFull?: (outputId: string) => void;
}

export function WorkOutputCarousel({
  outputs,
  onViewFull,
}: WorkOutputCarouselProps) {
  if (outputs.length === 0) {
    return null;
  }

  // Single output: show full card
  if (outputs.length === 1) {
    return (
      <div className="mt-3 border-t border-border/50 pt-3">
        <WorkOutputCard output={outputs[0]} onViewFull={onViewFull} />
      </div>
    );
  }

  // Multiple outputs: horizontal scroll
  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {outputs.length} Outputs Created
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {outputs.map((output) => (
          <div key={output.id} className="min-w-[240px] flex-shrink-0">
            <WorkOutputCard output={output} onViewFull={onViewFull} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkOutputCard;

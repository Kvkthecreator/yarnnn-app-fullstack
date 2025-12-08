'use client';

/**
 * OutputsWindowContent
 *
 * Content for the Outputs floating window.
 * Displays work outputs with supervision actions (approve/reject).
 * Features realtime updates via Supabase subscriptions.
 *
 * Part of Desktop UI Architecture v2.0 (Live Workspace)
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Lightbulb,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  RefreshCw,
  FileText,
  Eye,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useBasketId, useDesktop } from '../DesktopProvider';
import { useWorkOutputsRealtime, type RealtimeEvent, type RealtimeWorkOutput } from '@/hooks/useTPRealtime';

// ============================================================================
// Types
// ============================================================================

interface WorkOutput {
  id: string;
  output_type: string;
  title?: string;
  body?: string;
  supervision_status: 'pending_review' | 'approved' | 'rejected' | 'revision_requested';
  confidence?: number;
  agent_type?: string;
  created_at: string;
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  pending_review: { label: 'Pending', color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
  approved: { label: 'Approved', color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-50', icon: XCircle },
  revision_requested: { label: 'Revision', color: 'text-purple-600', bg: 'bg-purple-50', icon: RefreshCw },
};

// ============================================================================
// Component
// ============================================================================

export function OutputsWindowContent() {
  const basketId = useBasketId();
  const { getHighlight } = useDesktop();
  const highlight = getHighlight('outputs');

  const [outputs, setOutputs] = useState<WorkOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<WorkOutput | null>(null);

  // Track recently changed outputs for highlight animation
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());
  const recentlyChangedTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Realtime subscription handler
  const handleRealtimeUpdate = useCallback((event: RealtimeEvent<RealtimeWorkOutput>) => {
    const { type, data } = event;

    // Mark as recently changed for animation
    const markAsChanged = (id: string) => {
      setRecentlyChanged(prev => new Set([...prev, id]));
      const timeout = setTimeout(() => {
        setRecentlyChanged(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 3000);
      const existing = recentlyChangedTimeoutRef.current.get(id);
      if (existing) clearTimeout(existing);
      recentlyChangedTimeoutRef.current.set(id, timeout);
    };

    if (type === 'INSERT') {
      // Fetch full output data
      fetch(`/api/baskets/${basketId}/work-outputs/${data.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(fullOutput => {
          if (fullOutput) {
            setOutputs(prev => [fullOutput, ...prev]);
            markAsChanged(data.id);
          }
        })
        .catch(console.error);
    } else if (type === 'UPDATE') {
      // Fetch updated output data
      fetch(`/api/baskets/${basketId}/work-outputs/${data.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(fullOutput => {
          if (fullOutput) {
            setOutputs(prev => prev.map(o => o.id === data.id ? fullOutput : o));
            markAsChanged(data.id);
          }
        })
        .catch(console.error);
    }
  }, [basketId]);

  // Subscribe to realtime updates
  const { isConnected } = useWorkOutputsRealtime(basketId || '', handleRealtimeUpdate);

  // Cleanup timeouts on unmount
  useEffect(() => {
    const timeouts = recentlyChangedTimeoutRef.current;
    return () => {
      timeouts.forEach(timeout => clearTimeout(timeout));
      timeouts.clear();
    };
  }, []);

  // Fetch outputs
  const fetchOutputs = useCallback(async () => {
    if (!basketId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/baskets/${basketId}/work-outputs`);
      if (!response.ok) {
        throw new Error('Failed to fetch work outputs');
      }
      const data = await response.json();
      setOutputs(data.outputs || data || []);
    } catch (err) {
      console.error('Failed to fetch work outputs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [basketId]);

  useEffect(() => {
    fetchOutputs();
  }, [fetchOutputs]);

  // Check if output is highlighted
  const isHighlighted = useCallback(
    (outputId: string) => {
      return highlight?.itemIds?.includes(outputId) ?? false;
    },
    [highlight]
  );

  // Check if output was recently changed
  const isRecentlyChanged = useCallback(
    (outputId: string) => {
      return recentlyChanged.has(outputId);
    },
    [recentlyChanged]
  );

  // Group outputs
  const pendingOutputs = outputs.filter((o) => o.supervision_status === 'pending_review');
  const reviewedOutputs = outputs.filter((o) => o.supervision_status !== 'pending_review');

  // Actions
  const handleApprove = async (outputId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-outputs/${outputId}/approve`, {
        method: 'POST',
      });
      fetchOutputs();
    } catch (err) {
      console.error('Failed to approve output:', err);
    }
  };

  const handleReject = async (outputId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-outputs/${outputId}/reject`, {
        method: 'POST',
      });
      fetchOutputs();
    } catch (err) {
      console.error('Failed to reject output:', err);
    }
  };

  // Detail view
  if (selectedOutput) {
    return (
      <OutputDetail
        output={selectedOutput}
        onBack={() => setSelectedOutput(null)}
        onApprove={() => {
          handleApprove(selectedOutput.id);
          setSelectedOutput(null);
        }}
        onReject={() => {
          handleReject(selectedOutput.id);
          setSelectedOutput(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            {pendingOutputs.length > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                {pendingOutputs.length} pending review
              </Badge>
            )}
            <span className="text-muted-foreground">
              {outputs.length} total
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Connection status */}
            {isConnected ? (
              <div className="flex items-center gap-1 text-xs">
                <Wifi className="h-3 w-3 text-green-500" />
                <span className="text-green-600">Live</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs">
                <WifiOff className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={fetchOutputs}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Outputs List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchOutputs}>
              Retry
            </Button>
          </div>
        ) : outputs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <Lightbulb className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm font-medium">No work outputs</p>
            <p className="text-xs text-muted-foreground mt-1">
              Outputs will appear here when work completes
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Pending outputs */}
            {pendingOutputs.length > 0 && (
              <div>
                <div className="bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
                  Pending Review ({pendingOutputs.length})
                </div>
                {pendingOutputs.map((output) => (
                  <OutputRow
                    key={output.id}
                    output={output}
                    highlighted={isHighlighted(output.id)}
                    recentlyChanged={isRecentlyChanged(output.id)}
                    onClick={() => setSelectedOutput(output)}
                    onApprove={() => handleApprove(output.id)}
                    onReject={() => handleReject(output.id)}
                  />
                ))}
              </div>
            )}

            {/* Reviewed outputs */}
            {reviewedOutputs.length > 0 && (
              <div>
                <div className="bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
                  Reviewed ({reviewedOutputs.length})
                </div>
                {reviewedOutputs.slice(0, 10).map((output) => (
                  <OutputRow
                    key={output.id}
                    output={output}
                    highlighted={isHighlighted(output.id)}
                    recentlyChanged={isRecentlyChanged(output.id)}
                    onClick={() => setSelectedOutput(output)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Output Row
// ============================================================================

interface OutputRowProps {
  output: WorkOutput;
  highlighted?: boolean;
  recentlyChanged?: boolean;
  onClick: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

function OutputRow({
  output,
  highlighted,
  recentlyChanged,
  onClick,
  onApprove,
  onReject,
}: OutputRowProps) {
  const config = STATUS_CONFIG[output.supervision_status] || STATUS_CONFIG.pending_review;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'p-4 transition-all duration-300',
        highlighted
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : recentlyChanged
          ? 'bg-green-50 border-l-2 border-l-green-500 animate-pulse'
          : 'hover:bg-muted/50'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'rounded-md p-2 transition-all',
          recentlyChanged ? 'bg-green-100 ring-2 ring-green-300' : config.bg
        )}>
          <Icon className={cn('h-4 w-4', recentlyChanged ? 'text-green-600' : config.color)} />
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {output.title || output.output_type}
            </span>
            <Badge variant="outline" className="text-xs">
              {output.output_type}
            </Badge>
            {recentlyChanged && (
              <Badge className="text-[10px] shrink-0 bg-green-100 text-green-700 border-green-200">
                New
              </Badge>
            )}
          </div>

          {output.body && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {output.body.slice(0, 150)}...
            </p>
          )}

          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            {output.confidence !== undefined && (
              <span>{Math.round(output.confidence * 100)}% confidence</span>
            )}
            {output.agent_type && (
              <>
                <span>·</span>
                <span className="capitalize">{output.agent_type}</span>
              </>
            )}
            <span>·</span>
            <span>{new Date(output.created_at).toLocaleString()}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {onApprove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
              }}
              className="h-8 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          )}
          {onReject && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
              className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            className="h-8 text-xs"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Output Detail
// ============================================================================

interface OutputDetailProps {
  output: WorkOutput;
  onBack: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

function OutputDetail({ output, onBack, onApprove, onReject }: OutputDetailProps) {
  const config = STATUS_CONFIG[output.supervision_status] || STATUS_CONFIG.pending_review;
  const isPending = output.supervision_status === 'pending_review';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
          <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
          Back
        </Button>

        <div className="flex items-start gap-3">
          <div className={cn('rounded-lg p-2', config.bg)}>
            <Lightbulb className={cn('h-6 w-6', config.color)} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">
                {output.title || output.output_type}
              </h3>
              <Badge className={cn('capitalize', config.bg, config.color)}>
                {config.label}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <span>{output.output_type}</span>
              {output.agent_type && (
                <>
                  <span>·</span>
                  <span className="capitalize">{output.agent_type}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        {output.confidence !== undefined && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Confidence</span>
              <span className="font-medium">{Math.round(output.confidence * 100)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${output.confidence * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {output.body ? (
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm">{output.body}</pre>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No content available</p>
        )}
      </div>

      {/* Footer with actions */}
      {isPending && (
        <div className="border-t border-border bg-muted/30 p-4">
          <div className="flex items-center justify-end gap-2">
            {onReject && (
              <Button variant="outline" onClick={onReject} className="text-red-600">
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </Button>
            )}
            {onApprove && (
              <Button onClick={onApprove} className="bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Approve
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default OutputsWindowContent;

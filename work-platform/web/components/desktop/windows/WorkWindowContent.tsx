'use client';

/**
 * WorkWindowContent
 *
 * Content for the Work floating window.
 * Displays active work tickets with status, progress, and actions.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useBasketId, useDesktop } from '../DesktopProvider';

// ============================================================================
// Types
// ============================================================================

interface WorkTicket {
  id: string;
  recipe_slug?: string;
  recipe_name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_pct?: number;
  current_step?: string;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; bg: string }
> = {
  pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
  running: { icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50' },
  completed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  cancelled: { icon: StopCircle, color: 'text-gray-600', bg: 'bg-gray-50' },
};

// ============================================================================
// Component
// ============================================================================

export function WorkWindowContent() {
  const basketId = useBasketId();
  const { getHighlight } = useDesktop();
  const highlight = getHighlight('work');

  const [tickets, setTickets] = useState<WorkTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch work tickets
  const fetchTickets = useCallback(async () => {
    if (!basketId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/baskets/${basketId}/work-tickets`);
      if (!response.ok) {
        throw new Error('Failed to fetch work tickets');
      }
      const data = await response.json();
      setTickets(data.tickets || data || []);
    } catch (err) {
      console.error('Failed to fetch work tickets:', err);
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [basketId]);

  useEffect(() => {
    fetchTickets();
    // Poll for updates when there are running tickets
    const interval = setInterval(() => {
      if (tickets.some((t) => t.status === 'running' || t.status === 'pending')) {
        fetchTickets();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchTickets, tickets]);

  // Check if ticket is highlighted
  const isHighlighted = useCallback(
    (ticketId: string) => {
      return highlight?.itemIds?.includes(ticketId) ?? false;
    },
    [highlight]
  );

  // Group tickets
  const activeTickets = tickets.filter(
    (t) => t.status === 'running' || t.status === 'pending'
  );
  const completedTickets = tickets.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );

  // Actions
  const handleCancel = async (ticketId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-tickets/${ticketId}/cancel`, {
        method: 'POST',
      });
      fetchTickets();
    } catch (err) {
      console.error('Failed to cancel ticket:', err);
    }
  };

  const handleRetry = async (ticketId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-tickets/${ticketId}/retry`, {
        method: 'POST',
      });
      fetchTickets();
    } catch (err) {
      console.error('Failed to retry ticket:', err);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header info */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {activeTickets.length} active
            </span>
            <span className="text-muted-foreground">
              {completedTickets.length} completed
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchTickets}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {highlight?.action && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Zap className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground">
              {highlight.action === 'using' && 'TP triggered work'}
            </span>
          </div>
        )}
      </div>

      {/* Tickets List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchTickets}>
              Retry
            </Button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm font-medium">No work tickets</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ask TP to run a recipe to create work
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Active tickets */}
            {activeTickets.length > 0 && (
              <div>
                <div className="bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
                  Active ({activeTickets.length})
                </div>
                {activeTickets.map((ticket) => (
                  <WorkTicketRow
                    key={ticket.id}
                    ticket={ticket}
                    highlighted={isHighlighted(ticket.id)}
                    onCancel={() => handleCancel(ticket.id)}
                  />
                ))}
              </div>
            )}

            {/* Completed tickets */}
            {completedTickets.length > 0 && (
              <div>
                <div className="bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
                  History ({completedTickets.length})
                </div>
                {completedTickets.slice(0, 10).map((ticket) => (
                  <WorkTicketRow
                    key={ticket.id}
                    ticket={ticket}
                    highlighted={isHighlighted(ticket.id)}
                    onRetry={
                      ticket.status === 'failed'
                        ? () => handleRetry(ticket.id)
                        : undefined
                    }
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
// Work Ticket Row
// ============================================================================

interface WorkTicketRowProps {
  ticket: WorkTicket;
  highlighted?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
}

function WorkTicketRow({
  ticket,
  highlighted,
  onCancel,
  onRetry,
}: WorkTicketRowProps) {
  const config = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isRunning = ticket.status === 'running';

  return (
    <div
      className={cn(
        'p-4 transition-colors',
        highlighted
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : 'hover:bg-muted/50'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('rounded-md p-2', config.bg)}>
          <Icon
            className={cn(
              'h-4 w-4',
              config.color,
              isRunning && 'animate-spin'
            )}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {ticket.recipe_name || ticket.recipe_slug || 'Work Request'}
            </span>
            <Badge variant="outline" className="text-xs capitalize">
              {ticket.status}
            </Badge>
          </div>

          {ticket.current_step && (
            <p className="mt-1 text-xs text-muted-foreground">
              {ticket.current_step}
            </p>
          )}

          {ticket.error_message && (
            <p className="mt-1 text-xs text-red-600">
              {ticket.error_message}
            </p>
          )}

          {/* Progress bar */}
          {isRunning && ticket.progress_pct !== undefined && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${ticket.progress_pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground mt-1">
                {ticket.progress_pct}%
              </span>
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {ticket.completed_at
                ? `Completed ${new Date(ticket.completed_at).toLocaleString()}`
                : ticket.started_at
                ? `Started ${new Date(ticket.started_at).toLocaleString()}`
                : `Created ${new Date(ticket.created_at).toLocaleString()}`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
          )}
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-8 text-xs"
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkWindowContent;

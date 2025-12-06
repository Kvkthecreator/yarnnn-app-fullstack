"use client";

/**
 * ThinkingAgentClient - Dedicated TP Page
 *
 * Chat-first layout for Thinking Partner with sliding detail panels.
 * Refactored in Phase 6 to use ChatFirstLayout from chat-first architecture.
 *
 * Layout:
 * - Desktop: Chat (60%) + Detail Panel (40%) - resizable
 * - Tablet: Chat full-width + slide-out panel
 * - Mobile: Chat full-screen + modal panel
 *
 * Detail Panel Tabs:
 * - Overview: Live context state visualization
 * - Context: Browse/search context items
 * - Outputs: Review work outputs
 * - Tickets: Track work tickets
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TPChatInterface } from '@/components/thinking/TPChatInterface';
import { ChatFirstLayout, type DetailTab } from '@/components/thinking/ChatFirstLayout';
import { ContextDetailPanel } from '@/components/thinking/detail-panels/ContextDetailPanel';
import { OutputsDetailPanel } from '@/components/thinking/detail-panels/OutputsDetailPanel';
import { TicketsDetailPanel } from '@/components/thinking/detail-panels/TicketsDetailPanel';
import type { TPPhase, TPContextChange, WorkOutput } from '@/lib/types/thinking-partner';
import { useTPRealtimeEnhanced } from '@/hooks/useTPRealtimeEnhanced';
import { AGENT_CONFIG } from '../config';
import {
  Brain,
  Search,
  Pencil,
  FileText,
  CheckCircle2,
  Loader2,
  Lightbulb,
  TrendingUp,
  Users,
  Target,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingAgentClientProps {
  project: {
    id: string;
    name: string;
  };
  basketId: string;
  workspaceId: string;
}

export function ThinkingAgentClient({
  project,
  basketId,
  workspaceId,
}: ThinkingAgentClientProps) {
  const router = useRouter();
  const config = AGENT_CONFIG.thinking;
  const [tpPhase, setTPPhase] = useState<TPPhase>('idle');

  // Context items state
  const [contextItems, setContextItems] = useState<any[]>([]);
  const [contextLoading, setContextLoading] = useState(true);

  // Work outputs state
  const [workOutputs, setWorkOutputs] = useState<any[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(true);

  // Work tickets state
  const [workTickets, setWorkTickets] = useState<any[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  // Realtime updates
  const {
    isConnected,
    latestContextUpdate,
    latestTicketUpdate,
    latestOutputUpdate,
    activeTickets,
    pendingOutputs,
  } = useTPRealtimeEnhanced({
    basketId,
    onContextUpdate: (update) => {
      // Refresh context items on updates
      fetchContextItems();
    },
    onTicketUpdate: (update) => {
      fetchWorkTickets();
    },
    onOutputUpdate: (update) => {
      fetchWorkOutputs();
    },
  });

  // Fetch context items
  const fetchContextItems = useCallback(async () => {
    try {
      setContextLoading(true);
      const response = await fetch(`/api/baskets/${basketId}/context`);
      if (response.ok) {
        const data = await response.json();
        setContextItems(data.items || data || []);
      }
    } catch (error) {
      console.error('Failed to fetch context items:', error);
    } finally {
      setContextLoading(false);
    }
  }, [basketId]);

  // Fetch work outputs
  const fetchWorkOutputs = useCallback(async () => {
    try {
      setOutputsLoading(true);
      const response = await fetch(`/api/baskets/${basketId}/work-outputs`);
      if (response.ok) {
        const data = await response.json();
        setWorkOutputs(data.outputs || data || []);
      }
    } catch (error) {
      console.error('Failed to fetch work outputs:', error);
    } finally {
      setOutputsLoading(false);
    }
  }, [basketId]);

  // Fetch work tickets
  const fetchWorkTickets = useCallback(async () => {
    try {
      setTicketsLoading(true);
      const response = await fetch(`/api/baskets/${basketId}/work-tickets`);
      if (response.ok) {
        const data = await response.json();
        setWorkTickets(data.tickets || data || []);
      }
    } catch (error) {
      console.error('Failed to fetch work tickets:', error);
    } finally {
      setTicketsLoading(false);
    }
  }, [basketId]);

  // Initial data fetch
  useEffect(() => {
    fetchContextItems();
    fetchWorkOutputs();
    fetchWorkTickets();
  }, [fetchContextItems, fetchWorkOutputs, fetchWorkTickets]);

  // Handle context changes from chat
  const handleContextChange = useCallback((changes: TPContextChange[]) => {
    // Refresh context items when TP modifies context
    fetchContextItems();
  }, [fetchContextItems]);

  // Handle work outputs from chat
  const handleWorkOutput = useCallback((outputs: WorkOutput[]) => {
    // Refresh work outputs when new outputs are created
    fetchWorkOutputs();
  }, [fetchWorkOutputs]);

  // Navigation handlers for detail panels
  const handleNavigateToContext = useCallback((itemId?: string) => {
    // Detail panel will show context items
    if (itemId) {
      // Could scroll to or highlight specific item
      console.log('Navigate to context item:', itemId);
    }
  }, []);

  const handleNavigateToOutput = useCallback((outputId?: string) => {
    if (outputId) {
      console.log('Navigate to output:', outputId);
    }
  }, []);

  const handleNavigateToTicket = useCallback((ticketId?: string) => {
    if (ticketId) {
      console.log('Navigate to ticket:', ticketId);
    }
  }, []);

  // Output approval actions
  const handleApproveOutput = async (outputId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-outputs/${outputId}/approve`, {
        method: 'POST',
      });
      fetchWorkOutputs();
    } catch (error) {
      console.error('Failed to approve output:', error);
    }
  };

  const handleRejectOutput = async (outputId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-outputs/${outputId}/reject`, {
        method: 'POST',
      });
      fetchWorkOutputs();
    } catch (error) {
      console.error('Failed to reject output:', error);
    }
  };

  // Ticket actions
  const handleCancelTicket = async (ticketId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-tickets/${ticketId}/cancel`, {
        method: 'POST',
      });
      fetchWorkTickets();
    } catch (error) {
      console.error('Failed to cancel ticket:', error);
    }
  };

  const handleRetryTicket = async (ticketId: string) => {
    try {
      await fetch(`/api/baskets/${basketId}/work-tickets/${ticketId}/retry`, {
        method: 'POST',
      });
      fetchWorkTickets();
    } catch (error) {
      console.error('Failed to retry ticket:', error);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <config.icon className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">{config.label}</h1>
            <p className="text-xs text-muted-foreground">{project.name}</p>
          </div>
          <Badge variant="outline" className="border-primary/40 text-primary">
            Interactive
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              <span className="mr-1.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </Badge>
          )}
          {activeTickets.length > 0 && (
            <Badge variant="secondary">
              {activeTickets.length} Active
            </Badge>
          )}
          {pendingOutputs.length > 0 && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              {pendingOutputs.length} Pending
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/projects/${project.id}/work-tickets-view`)}
          >
            View All Tickets
          </Button>
        </div>
      </header>

      {/* Chat-First Layout */}
      <div className="flex-1 overflow-hidden">
        <ChatFirstLayout
          initialDetailOpen={true}
          initialDetailTab="overview"
          onNavigateToContext={handleNavigateToContext}
          onNavigateToOutput={handleNavigateToOutput}
          onNavigateToTicket={handleNavigateToTicket}
          overviewPanel={
            <OverviewPanel
              basketId={basketId}
              tpPhase={tpPhase}
              contextItems={contextItems}
              activeTickets={activeTickets}
              pendingOutputs={pendingOutputs}
            />
          }
          contextPanel={
            <ContextDetailPanel
              basketId={basketId}
              items={contextItems}
              loading={contextLoading}
            />
          }
          outputsPanel={
            <OutputsDetailPanel
              basketId={basketId}
              outputs={workOutputs}
              loading={outputsLoading}
              onApprove={handleApproveOutput}
              onReject={handleRejectOutput}
            />
          }
          ticketsPanel={
            <TicketsDetailPanel
              basketId={basketId}
              tickets={workTickets}
              loading={ticketsLoading}
              onCancelTicket={handleCancelTicket}
              onRetryTicket={handleRetryTicket}
            />
          }
        >
          {/* Main Chat Interface */}
          <TPChatInterface
            basketId={basketId}
            workspaceId={workspaceId}
            className="h-full"
            onTPStateChange={(phase) => setTPPhase(phase as TPPhase)}
            onContextChange={handleContextChange}
            onWorkOutput={handleWorkOutput}
          />
        </ChatFirstLayout>
      </div>
    </div>
  );
}

// ============================================================================
// Overview Panel - Live Context Visualization
// ============================================================================

interface OverviewPanelProps {
  basketId: string;
  tpPhase: TPPhase;
  contextItems: any[];
  activeTickets: any[];
  pendingOutputs: any[];
}

function OverviewPanel({
  basketId,
  tpPhase,
  contextItems,
  activeTickets,
  pendingOutputs,
}: OverviewPanelProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* State indicator */}
      <div className="border-b border-border bg-card p-4">
        <TPStateIndicator phase={tpPhase} />
      </div>

      {/* Content based on TP state */}
      <div className="flex-1 p-4 space-y-4">
        {tpPhase === 'idle' && (
          <IdleOverview
            contextItems={contextItems}
            activeTickets={activeTickets}
            pendingOutputs={pendingOutputs}
          />
        )}
        {tpPhase === 'planning' && <PlanningOverview />}
        {tpPhase === 'delegating' && <DelegatingOverview />}
        {tpPhase === 'executing' && <ExecutingOverview activeTickets={activeTickets} />}
        {tpPhase === 'reviewing' && <ReviewingOverview pendingOutputs={pendingOutputs} />}
        {tpPhase === 'responding' && <RespondingOverview />}
      </div>
    </div>
  );
}

// ============================================================================
// State Indicator
// ============================================================================

function TPStateIndicator({ phase }: { phase: TPPhase }) {
  const stateConfig: Record<TPPhase, { icon: React.ReactNode; label: string; color: string }> = {
    idle: {
      icon: <Brain className="h-4 w-4" />,
      label: 'Ready',
      color: 'bg-slate-100 text-slate-700',
    },
    planning: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: 'Planning',
      color: 'bg-blue-100 text-blue-700',
    },
    delegating: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: 'Delegating',
      color: 'bg-purple-100 text-purple-700',
    },
    executing: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: 'Executing',
      color: 'bg-amber-100 text-amber-700',
    },
    reviewing: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: 'Reviewing',
      color: 'bg-green-100 text-green-700',
    },
    responding: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: 'Responding',
      color: 'bg-indigo-100 text-indigo-700',
    },
  };

  const config = stateConfig[phase];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Status</span>
      <Badge className={cn('border-0', config.color)}>
        <span className="flex items-center gap-1.5">
          {config.icon}
          <span className="text-xs">{config.label}</span>
        </span>
      </Badge>
    </div>
  );
}

// ============================================================================
// Overview Views
// ============================================================================

function IdleOverview({
  contextItems,
  activeTickets,
  pendingOutputs,
}: {
  contextItems: any[];
  activeTickets: any[];
  pendingOutputs: any[];
}) {
  // Count by tier
  const foundationCount = contextItems.filter((i) => i.tier === 'foundation').length;
  const workingCount = contextItems.filter((i) => i.tier === 'working').length;

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Foundation Context"
          value={foundationCount}
          icon={<Target className="h-4 w-4" />}
          color="blue"
        />
        <StatCard
          label="Working Context"
          value={workingCount}
          icon={<FileText className="h-4 w-4" />}
          color="purple"
        />
        <StatCard
          label="Active Work"
          value={activeTickets.length}
          icon={<Loader2 className="h-4 w-4" />}
          color="amber"
        />
        <StatCard
          label="Pending Review"
          value={pendingOutputs.length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="green"
        />
      </div>

      {/* Foundation context summary */}
      {foundationCount > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-medium mb-3">Foundation Context</h4>
          <div className="space-y-2">
            {contextItems
              .filter((i) => i.tier === 'foundation')
              .slice(0, 4)
              .map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <ContextTypeIcon type={item.item_type} />
                  <span className="capitalize">{item.item_type.replace('_', ' ')}</span>
                  {item.completeness_score !== undefined && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {Math.round(item.completeness_score * 100)}%
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {contextItems.length === 0 && (
        <div className="text-center py-8">
          <Brain className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-sm font-medium">Ready to Start</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Chat with TP to build your project context
          </p>
        </div>
      )}
    </div>
  );
}

function PlanningOverview() {
  return (
    <div className="text-center py-8">
      <Loader2 className="mx-auto h-12 w-12 animate-spin text-blue-500" />
      <h3 className="mt-4 text-sm font-medium">Planning Workflow</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Analyzing requirements and planning steps...
      </p>
    </div>
  );
}

function DelegatingOverview() {
  return (
    <div className="text-center py-8">
      <Loader2 className="mx-auto h-12 w-12 animate-spin text-purple-500" />
      <h3 className="mt-4 text-sm font-medium">Delegating Work</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Selecting specialist agent and preparing request...
      </p>
    </div>
  );
}

function ExecutingOverview({ activeTickets }: { activeTickets: any[] }) {
  return (
    <div className="space-y-4">
      <div className="text-center py-4">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-500" />
        <h3 className="mt-3 text-sm font-medium">Agent Working</h3>
      </div>

      {activeTickets.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h4 className="text-sm font-medium text-amber-800 mb-2">Active Tickets</h4>
          <div className="space-y-2">
            {activeTickets.slice(0, 3).map((ticket) => (
              <div key={ticket.id} className="flex items-center justify-between text-sm">
                <span className="text-amber-700">
                  {ticket.recipe_slug || 'Work request'}
                </span>
                <Badge variant="outline" className="bg-amber-100 text-amber-700">
                  {ticket.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewingOverview({ pendingOutputs }: { pendingOutputs: any[] }) {
  return (
    <div className="space-y-4">
      <div className="text-center py-4">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
        <h3 className="mt-3 text-sm font-medium">Review Outputs</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {pendingOutputs.length} output{pendingOutputs.length !== 1 ? 's' : ''} ready for review
        </p>
      </div>
    </div>
  );
}

function RespondingOverview() {
  return (
    <div className="text-center py-8">
      <Loader2 className="mx-auto h-12 w-12 animate-spin text-indigo-500" />
      <h3 className="mt-4 text-sm font-medium">Formulating Response</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Synthesizing information...
      </p>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'purple' | 'amber' | 'green';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
    amber: 'bg-amber-50 text-amber-700',
    green: 'bg-green-50 text-green-700',
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className={cn('rounded p-1', colors[color])}>{icon}</div>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ContextTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    problem: <Target className="h-4 w-4 text-blue-600" />,
    customer: <Users className="h-4 w-4 text-blue-600" />,
    vision: <Lightbulb className="h-4 w-4 text-blue-600" />,
    brand: <Palette className="h-4 w-4 text-blue-600" />,
    competitor: <TrendingUp className="h-4 w-4 text-purple-600" />,
    trend_digest: <TrendingUp className="h-4 w-4 text-purple-600" />,
  };

  return icons[type] || <FileText className="h-4 w-4 text-muted-foreground" />;
}

export default ThinkingAgentClient;

/**
 * Page: /projects/[id]/work-sessions - Work Sessions List
 *
 * Shows all work sessions for a project with filtering and status indicators.
 */
import { cookies } from "next/headers";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { getAuthenticatedUser } from "@/lib/auth/getAuthenticatedUser";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Clock, CheckCircle, XCircle, Loader2, Repeat } from 'lucide-react';
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; agent?: string }>;
}

export default async function WorkSessionsPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params;
  const { status: statusFilter, agent: agentFilter } = await searchParams;

  const supabase = createServerComponentClient({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);

  // Fetch project
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, basket_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground">Project not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The project you're looking for doesn't exist or you don't have access to it.
          </p>
        </div>
      </div>
    );
  }

  const { data: projectAgentsData } = await supabase
    .from('project_agents')
    .select('id, display_name, agent_type')
    .eq('project_id', projectId)
    .order('display_name', { ascending: true });

  const projectAgents = projectAgentsData || [];

  // Fetch work tickets with output counts
  let tickets: any[] = [];
  let statusCounts: Record<string, number> = { pending: 0, running: 0, completed: 0, failed: 0 };
  let totalCount = 0;

  try {
    // Build query for work_tickets
    let query = supabase
      .from('work_tickets')
      .select(`
        id,
        status,
        agent_type,
        created_at,
        completed_at,
        metadata,
        work_outputs (
          id,
          title,
          output_type
        )
      `)
      .eq('basket_id', project.basket_id || '')
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data: ticketsData } = await query;
    tickets = ticketsData || [];

    // Calculate status counts
    const allTicketsQuery = supabase
      .from('work_tickets')
      .select('status')
      .eq('basket_id', project.basket_id || '');

    const { data: allTickets } = await allTicketsQuery;
    if (allTickets) {
      totalCount = allTickets.length;
      allTickets.forEach((t: any) => {
        if (statusCounts[t.status] !== undefined) {
          statusCounts[t.status]++;
        }
      });
    }
  } catch (error) {
    console.error(`[Work Tickets] Error fetching tickets:`, error);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/projects/${projectId}/overview`} className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Project
          </Link>
          <h1 className="text-3xl font-bold text-foreground">Work Tickets</h1>
          <p className="text-muted-foreground mt-1">{project.name}</p>
        </div>
        <Link href={`/projects/${projectId}/work-tickets/new`}>
          <Button>New Work Request</Button>
        </Link>
      </div>

      {/* Status Filter Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <StatusFilterCard
          label="All"
          count={totalCount}
          projectId={projectId}
          active={!statusFilter}
          agentFilter={agentFilter}
        />
        <StatusFilterCard
          label="Pending"
          count={statusCounts.pending || 0}
          projectId={projectId}
          statusFilter="pending"
          active={statusFilter === 'pending'}
          agentFilter={agentFilter}
          icon={<Clock className="h-4 w-4" />}
          accent="warning"
        />
        <StatusFilterCard
          label="Running"
          count={statusCounts.running || 0}
          projectId={projectId}
          statusFilter="running"
          active={statusFilter === 'running'}
          agentFilter={agentFilter}
          icon={<Loader2 className="h-4 w-4 animate-spin" />}
          accent="primary"
        />
        <StatusFilterCard
          label="Completed"
          count={statusCounts.completed || 0}
          projectId={projectId}
          statusFilter="completed"
          active={statusFilter === 'completed'}
          agentFilter={agentFilter}
          icon={<CheckCircle className="h-4 w-4" />}
          accent="success"
        />
        <StatusFilterCard
          label="Failed"
          count={statusCounts.failed || 0}
          projectId={projectId}
          statusFilter="failed"
          active={statusFilter === 'failed'}
          agentFilter={agentFilter}
          icon={<XCircle className="h-4 w-4" />}
          accent="danger"
        />
      </div>

      {/* Agent Filter Pills */}
      {projectAgents && projectAgents.length > 0 && (
        <AgentFilterBar
          agents={projectAgents}
          projectId={projectId}
          activeAgentId={agentFilter}
          statusFilter={statusFilter}
        />
      )}

      {/* Tickets List */}
      {tickets.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {statusFilter ? 'No tickets found' : 'No work tickets yet'}
          </h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            {statusFilter
              ? `No ${statusFilter} work tickets for this project.`
              : 'Create your first work request to get started.'}
          </p>
          {!statusFilter && (
            <Link href={`/projects/${projectId}/work-tickets/new`}>
              <Button>Create Work Request</Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const outputCount = Array.isArray(ticket.work_outputs) ? ticket.work_outputs.length : 0;
            const taskDesc = ticket.metadata?.task_description || ticket.metadata?.recipe_slug || 'Work Ticket';

            return (
              <Link key={ticket.id} href={`/projects/${projectId}/outputs`}>
                <Card className="p-4 cursor-pointer transition hover:border-ring">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <Badge variant={getStatusVariant(ticket.status)} className="capitalize">
                          {ticket.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {ticket.agent_type}
                        </Badge>
                        {outputCount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {outputCount} {outputCount === 1 ? 'output' : 'outputs'}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(ticket.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-foreground font-medium">{taskDesc}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ACCENT_STYLES = {
  primary: {
    surface: "border border-surface-primary-border bg-surface-primary",
    text: "text-primary",
  },
  success: {
    surface: "border border-surface-success-border bg-surface-success",
    text: "text-success-foreground",
  },
  warning: {
    surface: "border border-surface-warning-border bg-surface-warning",
    text: "text-warning-foreground",
  },
  danger: {
    surface: "border border-surface-danger-border bg-surface-danger",
    text: "text-destructive",
  },
} as const;

type AccentKey = keyof typeof ACCENT_STYLES;

function StatusFilterCard({
  label,
  count,
  projectId,
  statusFilter,
  active,
  icon,
  accent,
  agentFilter,
}: {
  label: string;
  count: number;
  projectId: string;
  statusFilter?: string;
  active?: boolean;
  icon?: ReactNode;
  accent?: AccentKey;
  agentFilter?: string | null;
}) {
  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (agentFilter) params.set('agent', agentFilter);
  const query = params.toString();
  const href = query
    ? `/projects/${projectId}/work-sessions?${query}`
    : `/projects/${projectId}/work-sessions`;
  const accentConfig = accent ? ACCENT_STYLES[accent] : null;
  const textClass = accentConfig ? accentConfig.text : "text-muted-foreground";

  return (
    <Link href={href}>
      <Card
        className={cn(
          "p-4 cursor-pointer transition",
          active && accentConfig ? accentConfig.surface : undefined,
          !active && "hover:border-ring",
        )}
      >
        <div className="flex items-center gap-2">
          {icon && <span className={textClass}>{icon}</span>}
          <div>
            <div className={cn("text-2xl font-bold", textClass)}>{count}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'completed':
      return 'default';
    case 'running':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

function AgentFilterBar({
  agents,
  projectId,
  activeAgentId,
  statusFilter,
}: {
  agents: { id: string; display_name: string; agent_type: string }[];
  projectId: string;
  activeAgentId?: string | null;
  statusFilter?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <AgentFilterPill
        label="All Agents"
        projectId={projectId}
        statusFilter={statusFilter}
        active={!activeAgentId}
      />
      {agents.map((agent) => (
        <AgentFilterPill
          key={agent.id}
          label={agent.display_name}
          projectId={projectId}
          statusFilter={statusFilter}
          agentId={agent.id}
          active={activeAgentId === agent.id}
          subtitle={agent.agent_type}
        />
      ))}
    </div>
  );
}

function AgentFilterPill({
  label,
  subtitle,
  projectId,
  statusFilter,
  agentId,
  active,
}: {
  label: string;
  subtitle?: string;
  projectId: string;
  statusFilter?: string;
  agentId?: string;
  active?: boolean;
}) {
  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (agentId) params.set('agent', agentId);
  const query = params.toString();
  const href = query
    ? `/projects/${projectId}/work-sessions?${query}`
    : `/projects/${projectId}/work-sessions`;

  return (
    <Link href={href}>
      <div
        className={cn(
          'rounded-full border px-4 py-2 text-sm flex flex-col sm:flex-row sm:items-center sm:gap-2 transition',
          active ? 'border-ring bg-surface-primary/20 text-foreground' : 'text-muted-foreground hover:border-ring'
        )}
      >
        <span>{label}</span>
        {subtitle && <span className="text-xs capitalize text-muted-foreground">{subtitle}</span>}
      </div>
    </Link>
  );
}

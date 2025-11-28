"use client";

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Plus, Zap, CheckCircle2, FileCheck, Clock, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import SetupContextBanner from '@/components/context/SetupContextBanner';

interface ProjectAgent {
  id: string;
  agent_type: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  basket_id: string;
  basket_name: string;
  status: string;
  workspace_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  agents: ProjectAgent[];
  stats: {
    contextItems: number;
    documents: number;
    knowledgeBlocks: number;
    meaningBlocks: number;
    workSessions: {
      total: number;
      pending: number;
      running: number;
      paused: number;
      completed: number;
      failed: number;
    };
    agents: Record<string, {
      pending: number;
      running: number;
      lastRun: string | null;
      lastStatus: string | null;
      lastTask?: string | null;
      lastSessionId?: string | null;
    }>;
  };
}

interface ProjectOverviewClientProps {
  project: ProjectData;
}

export function ProjectOverviewClient({ project }: ProjectOverviewClientProps) {
  const router = useRouter();

  const agentSummaries = useMemo(() => project.stats.agents || {}, [project.stats.agents]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Project Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">{project.name}</h1>
            {project.description && (
              <p className="mt-2 text-lg text-muted-foreground">{project.description}</p>
            )}
            <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
              <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
              <span>•</span>
              <span>Updated {new Date(project.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-xs capitalize">
              {project.status}
            </Badge>
            <Button
              onClick={() => router.push(`/projects/${project.id}/work-tickets/new`)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Work Ticket
            </Button>
          </div>
        </div>

      </div>

      {/* Setup Context Banner - shown when foundational context is incomplete */}
      <SetupContextBanner
        projectId={project.id}
        basketId={project.basket_id}
      />

      {/* Project Agents */}
      {project.agents && project.agents.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Agent Infrastructure</h3>
            <Badge variant="secondary" className="gap-2 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {project.agents.length} Agents Ready
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            All agent sessions pre-scaffolded and ready for immediate use. No setup required.
          </p>
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {project.agents.map((agent) => {
              const stats = agentSummaries[agent.id];
              return (
                <div
                  key={agent.id}
                  className={cn(
                    'rounded-xl border bg-card p-4 transition-all flex flex-col gap-3',
                    agent.is_active ? 'hover:border-ring hover:shadow-md' : 'opacity-70'
                  )}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-surface-primary/70 p-2 text-primary">
                        <Zap className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground">{agent.display_name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{agent.agent_type}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('text-xs capitalize w-fit', getAgentStatusBadgeClass(stats, agent.is_active))}>
                      {getAgentStatusLabel(stats, agent.is_active)}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {stats?.lastRun
                        ? `Last run ${formatDistanceToNow(new Date(stats.lastRun))} ago`
                        : 'Session ready • Never used'}
                    </p>
                    {stats?.lastTask && (
                      <p className="line-clamp-2 text-foreground/80">“{stats.lastTask}”</p>
                    )}
                    {(stats?.pending || stats?.running) ? (
                      <p className="text-muted-foreground/90">
                        Queue: {stats.pending ?? 0} pending · {stats.running ?? 0} running
                      </p>
                    ) : null}
                  </div>
                  {/* View Work Tickets Button */}
                  {(stats?.pending || stats?.running || stats?.lastRun) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => router.push(`/projects/${project.id}/work-tickets?agent=${agent.id}`)}
                    >
                      View Work Tickets
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Work Review Quick Access */}
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Work Review</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Review and approve agent outputs before they're promoted to your knowledge base.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/projects/${project.id}/work-tickets-view`)}
            >
              <Eye className="h-4 w-4 mr-1" />
              View Tickets
            </Button>
            <Button
              size="sm"
              onClick={() => router.push(`/projects/${project.id}/work-review`)}
            >
              <Clock className="h-4 w-4 mr-1" />
              Review Outputs
            </Button>
          </div>
        </div>
      </Card>

      {/* Context Basket Info */}
      <Card className="p-6 border border-border bg-muted/60">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Linked Context</h3>
            <p className="text-lg font-medium text-foreground">{project.basket_name}</p>
            <p className="text-sm text-muted-foreground">
              Central knowledge base powering every agent in this project.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-2xl font-semibold text-foreground">{project.stats.contextItems}</p>
                <p className="text-xs text-muted-foreground">Total Blocks</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{project.stats.knowledgeBlocks}</p>
                <p className="text-xs text-muted-foreground">Knowledge Blocks</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{project.stats.meaningBlocks}</p>
                <p className="text-xs text-muted-foreground">Meaning Blocks</p>
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="self-start md:self-auto"
            onClick={() => router.push(`/projects/${project.id}/context`)}
          >
            View Context →
          </Button>
        </div>
      </Card>

    </div>
  );
}

function getAgentStatusLabel(stats: any, isActive: boolean) {
  if (!isActive) return 'Inactive';
  if (!stats || !stats.lastRun) return 'Ready';
  if (stats.running > 0) return 'Running';
  if (stats.pending > 0) return 'Pending';
  return stats.lastStatus === 'completed' ? 'Completed' : 'Ready';
}

function getAgentStatusBadgeClass(stats: any, isActive: boolean) {
  if (!isActive) return 'border-muted text-muted-foreground';
  if (!stats || !stats.lastRun) return 'border-blue-500/30 text-blue-600 dark:text-blue-400';
  if (stats.running > 0) return 'border-yellow-500/30 text-yellow-600 dark:text-yellow-400';
  if (stats.pending > 0) return 'border-orange-500/30 text-orange-600 dark:text-orange-400';
  return stats.lastStatus === 'completed' ? 'border-green-500/30 text-green-600 dark:text-green-400' : 'border-blue-500/30 text-blue-600 dark:text-blue-400';
}

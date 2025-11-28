import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { Database } from '@/lib/dbTypes';
import { getAuthenticatedUser } from '@/lib/auth/getAuthenticatedUser';
import { ensureWorkspaceForUser } from '@/lib/workspaces/ensureWorkspaceForUser';
import { cn } from '@/lib/utils';
import AlertAnnouncer, { type DashboardAlert as AnnouncerAlert } from '@/components/dashboard/AlertAnnouncer';
import { CreateProjectButton } from './CreateProjectButton';
import { PurgeSuccessToast } from './PurgeSuccessToast';

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return date.toLocaleString();
}

export default async function DashboardPage() {
  const supabase = createServerComponentClient<Database>({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);
  const workspace = await ensureWorkspaceForUser(userId, supabase);

  const { data: projects = [] } = await supabase
    .from('projects')
    .select('id, name, status, created_at, updated_at')
    .eq('workspace_id', workspace.id)
    .order('updated_at', { ascending: false })
    .limit(4);

  const { data: activeSessions = [] } = await supabase
    .from('work_sessions')
    .select('id, project_id, task_type, status, created_at')
    .eq('workspace_id', workspace.id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(20);

  const pendingByProject = new Map<string, { count: number; lastCreatedAt: string | null; taskType: string | null }>();
  activeSessions?.forEach((session) => {
    if (!session.project_id) return;
    const entry = pendingByProject.get(session.project_id) ?? { count: 0, lastCreatedAt: null, taskType: null };
    entry.count += 1;
    if (!entry.lastCreatedAt || (session.created_at && session.created_at > entry.lastCreatedAt)) {
      entry.lastCreatedAt = session.created_at ?? entry.lastCreatedAt;
      entry.taskType = session.task_type ?? entry.taskType;
    }
    pendingByProject.set(session.project_id, entry);
  });

  const { data: recentRuns = [] } = await supabase
    .from('work_sessions')
    .select('id, project_id, agent_type, task_type, status, updated_at, created_at')
    .eq('workspace_id', workspace.id)
    .order('updated_at', { ascending: false })
    .limit(6);

  const projectNameMap = new Map<string, string>();
  projects?.forEach((project) => {
    projectNameMap.set(project.id, project.name || 'Untitled project');
  });
  recentRuns?.forEach((run) => {
    if (run.project_id && !projectNameMap.has(run.project_id)) {
      const fallback = run.project_id.slice(0, 8);
      projectNameMap.set(run.project_id, `Project ${fallback}`);
    }
  });

  // Fetch alerts directly from Supabase (server-side)
  let alerts: AnnouncerAlert[] = [];
  try {
    const { data: alertsData } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', userId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(10);

    alerts = (alertsData || []).map((alert) => ({
      id: alert.id,
      type: alert.alert_type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      created_at: alert.created_at,
    }));
  } catch (error) {
    console.error('[Dashboard] Failed to load alerts', error);
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12">
      <PurgeSuccessToast />
      <header className="flex items-start justify-between">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold">Control Tower</h1>
          <p className="text-sm text-muted-foreground">
            Monitor ambient activity, triage captures, and keep integrations healthy.
          </p>
        </div>
        <CreateProjectButton />
      </header>

      {alerts.length > 0 && (
        <section className="space-y-2">
          <AlertAnnouncer alerts={alerts} />
          {alerts.map((alert) => (
            <AlertBanner key={alert.id} alert={alert} />
          ))}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Projects in progress</h2>
          <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        {projects && projects.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {projects.map((project) => {
              const pending = pendingByProject.get(project.id);
              const activeRuns = pending?.count ?? 0;
              const meta =
                activeRuns > 0
                  ? `${activeRuns} run${activeRuns > 1 ? 's' : ''} in flight${pending?.taskType ? ` · ${pending.taskType}` : ''}`
                  : 'No active runs';
              const lastTouch = pending?.lastCreatedAt || project.updated_at || project.created_at;
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-medium truncate">{project.name || 'Untitled project'}</h3>
                      <p className="text-sm text-muted-foreground">{meta}</p>
                    </div>
                    <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                      {project.status ?? 'active'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">Updated {formatTimestamp(lastTouch)}</div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No projects yet. Create one to spin up baskets and agents automatically.
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Recent agent runs</h2>
          <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
            Manage work
          </Link>
        </div>
        <div className="mt-4 space-y-2">
          {recentRuns && recentRuns.length > 0 ? (
            recentRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-border px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{projectNameMap.get(run.project_id ?? '') || 'Unknown project'}</p>
                    <p className="text-xs text-muted-foreground">
                      {run.agent_type || run.task_type || 'agent'} · {run.task_type ?? 'task'}
                    </p>
                  </div>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-medium', runStatusBadge(run.status))}>
                    {run.status}
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Updated {formatTimestamp(run.updated_at ?? run.created_at)}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              When agents start running, their activity will show up here.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function AlertBanner({ alert }: { alert: AnnouncerAlert }) {
  const severityClass = alert.severity === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-900'
    : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm', severityClass)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{alert.title}</h3>
          <p className="text-sm">{alert.message}</p>
        </div>
        {alert.action_href ? (
          <Link
            href={alert.action_href}
            className="shrink-0 rounded-md border border-current px-3 py-1 text-xs font-medium hover:bg-white/20"
          >
            {alert.action_label || 'Review'}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function QueueCard({
  title,
  description,
  count,
  href,
}: {
  title: string;
  description: string;
  count: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 transition hover:border-primary hover:shadow-sm"
    >
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="mt-4">
        <span className="text-2xl font-semibold">{count}</span>
      </div>
    </Link>
  );
}

function runStatusBadge(status?: string | null) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'approved') {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (normalized === 'running') {
    return 'bg-sky-100 text-sky-700';
  }
  if (normalized === 'pending' || normalized === 'queued') {
    return 'bg-amber-100 text-amber-700';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'bg-rose-100 text-rose-700';
  }
  return 'bg-muted text-foreground';
}

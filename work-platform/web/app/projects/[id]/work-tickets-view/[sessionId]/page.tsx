/**
 * Page: /projects/[id]/work-sessions/[sessionId] - Work Ticket Detail
 *
 * Phase 2e: Displays work_tickets (execution tracking) and work_outputs (results)
 *
 * Shows detailed information including:
 * - Work ticket status and metadata
 * - Work request details (intent, recipe if used)
 * - Agent session information
 * - Work outputs (when completed)
 * - Error messages (if failed)
 */
import { cookies } from "next/headers";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { getAuthenticatedUser } from "@/lib/auth/getAuthenticatedUser";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
  FileText,
  AlertCircle,
} from 'lucide-react';
import WorkSessionExecutor from './WorkSessionExecutor';
// TODO: Rename ArtifactList to WorkOutputList for Phase 2e terminology
import ArtifactList from './ArtifactList';

interface PageProps {
  params: Promise<{ id: string; sessionId: string }>;
}

export default async function WorkSessionDetailPage({ params }: PageProps) {
  const { id: projectId, sessionId } = await params;

  const supabase = createServerComponentClient({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);

  // Fetch work ticket details via BFF (Phase 2e: work_tickets + work_outputs)
  let session: any = null;
  let error: string | null = null;
  let workOutputs: any[] = [];  // Phase 2e: work_outputs not artifacts

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/projects/${projectId}/work-sessions/${sessionId}`,
      {
        headers: {
          Cookie: (await cookies()).toString(),
        },
        cache: 'no-store',
      }
    );

    if (response.ok) {
      session = await response.json();

      // Fetch work outputs if session is completed (Phase 2e)
      if (session.status === 'completed') {
        try {
          const outputsResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/projects/${projectId}/work-sessions/${sessionId}/outputs`,
            {
              headers: {
                Cookie: (await cookies()).toString(),
              },
              cache: 'no-store',
            }
          );

          if (outputsResponse.ok) {
            workOutputs = await outputsResponse.json();
          }
        } catch (outputErr) {
          console.error(`[Work Outputs] Error:`, outputErr);
          // Don't fail the whole page if outputs fail
        }
      }
    } else if (response.status === 404) {
      error = 'Work ticket not found';
    } else {
      error = 'Failed to load work ticket';
    }
  } catch (err) {
    console.error(`[Work Ticket Detail] Error:`, err);
    error = 'Failed to load work ticket';
  }

  if (error || !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground">{error || 'Not Found'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The work session you're looking for doesn't exist or you don't have access to it.
          </p>
          <Link href={`/projects/${projectId}/work-sessions`} className="mt-4 inline-block">
            <Button variant="outline">Back to Work Sessions</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div>
        <Link
          href={`/projects/${projectId}/work-sessions`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Work Sessions
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Work Session</h1>
            <p className="text-muted-foreground mt-1">{session.project_name}</p>
          </div>
          <Badge variant={getStatusVariant(session.status)} className="text-base px-4 py-2">
            {getStatusIcon(session.status)}
            <span className="ml-2">{session.status}</span>
          </Badge>
        </div>
      </div>

      {/* Work Ticket Metadata (Phase 2e Schema) */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Work Ticket Information</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <InfoItem label="Agent" value={session.agent_display_name} icon={<Zap className="h-4 w-4" />} />
          <InfoItem label="Agent Type" value={session.agent_type} />
          <InfoItem label="Created" value={new Date(session.created_at).toLocaleString()} icon={<Clock className="h-4 w-4" />} />
          {session.completed_at && (
            <InfoItem label="Completed" value={new Date(session.completed_at).toLocaleString()} icon={<CheckCircle className="h-4 w-4" />} />
          )}
          <InfoItem label="Priority" value={session.priority} />
          {session.work_request_id && (
            <InfoItem label="Work Request ID" value={session.work_request_id.substring(0, 8)} />
          )}
        </div>
      </Card>

      {/* Task Description */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Task Description</h2>
        <p className="text-foreground/90 whitespace-pre-wrap">{session.task_description}</p>
      </Card>

      {/* Recipe Configuration (if any) */}
      {session.context && Object.keys(session.context).length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Recipe Configuration</h2>

          {/* Reporting Agent Recipe */}
          {session.context.report_spec && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <InfoItem
                  label="Report Type"
                  value={session.context.report_spec.report_type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Executive Summary'}
                />
                {session.context.report_spec.time_period_start && session.context.report_spec.time_period_end && (
                  <InfoItem
                    label="Time Period"
                    value={`${session.context.report_spec.time_period_start} to ${session.context.report_spec.time_period_end}`}
                  />
                )}
              </div>

              {session.context.report_spec.sections_required && session.context.report_spec.sections_required.length > 0 && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Required Sections</div>
                  <div className="flex flex-wrap gap-2">
                    {session.context.report_spec.sections_required.map((section: string, i: number) => (
                      <Badge key={i} variant="outline">{section}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {session.context.audience && (
                <div className="grid gap-4 md:grid-cols-2">
                  <InfoItem
                    label="Target Audience"
                    value={session.context.audience.stakeholder_level?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Executive'}
                  />
                  <InfoItem
                    label="Depth Level"
                    value={session.context.audience.depth?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'High Level'}
                  />
                </div>
              )}
            </div>
          )}

          {/* Research Agent Recipe */}
          {session.context.research_scope && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <InfoItem
                  label="Depth"
                  value={session.context.research_scope.depth?.replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Detailed'}
                />
                {session.context.output_preferences?.format && (
                  <InfoItem
                    label="Output Format"
                    value={session.context.output_preferences.format.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                  />
                )}
              </div>

              {session.context.research_scope.domains && session.context.research_scope.domains.length > 0 && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Domains</div>
                  <div className="flex flex-wrap gap-2">
                    {session.context.research_scope.domains.map((domain: string, i: number) => (
                      <Badge key={i} variant="outline">{domain}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content Creator Recipe */}
          {session.context.content_spec && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <InfoItem
                  label="Platform"
                  value={session.context.content_spec.platform?.replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'General'}
                />
                <InfoItem
                  label="Tone"
                  value={session.context.content_spec.tone?.replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Professional'}
                />
              </div>
              <InfoItem
                label="Target Audience"
                value={session.context.content_spec.target_audience || 'General Audience'}
              />
            </div>
          )}

          {/* Fallback: Show raw JSON if no known recipe structure */}
          {!session.context.report_spec && !session.context.research_scope && !session.context.content_spec && (
            <pre className="text-sm text-muted-foreground bg-muted p-4 rounded-lg overflow-x-auto border border-border/60">
              {JSON.stringify(session.context, null, 2)}
            </pre>
          )}
        </Card>
      )}

      {/* Work Session Executor - Shows execute button and status cards */}
      {/* Phase 2e: Using outputs_count instead of artifacts_count */}
      <WorkSessionExecutor
        projectId={projectId}
        sessionId={sessionId}
        initialStatus={session.status}
        initialArtifactsCount={session.outputs_count || 0}
      />

      {/* Work Outputs Viewer (Phase 2e: work_outputs table) */}
      {/* TODO: Rename ArtifactList component to WorkOutputList */}
      {session.status === 'completed' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Work Outputs & Results
          </h2>
          <ArtifactList artifacts={workOutputs} />
        </div>
      )}
    </div>
  );
}

function InfoItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-foreground font-medium">{value}</div>
    </div>
  );
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-4 w-4" />;
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin" />;
    case 'failed':
      return <XCircle className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
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

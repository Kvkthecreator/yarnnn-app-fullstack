"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/clients";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Download, RefreshCw, CheckCircle2, XCircle, Loader2, Clock, AlertTriangle, FileText, Package } from "lucide-react";
import Link from "next/link";
import { TaskProgressList } from "@/components/TaskProgressList";
import { cn } from "@/lib/utils";

interface WorkOutput {
  id: string;
  title: string;
  body: string;
  output_type: string;
  agent_type: string;
  file_id: string | null;
  file_format: string | null;
  generation_method: string;
  created_at: string;
}

interface WorkTicket {
  id: string;
  status: string;
  agent_type: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  metadata: any;
  basket_id: string;
  work_outputs: WorkOutput[];
}

interface TicketTrackingClientProps {
  projectId: string;
  projectName: string;
  ticket: WorkTicket;
  recipeName: string;
  recipeParams: Record<string, any>;
  taskDescription: string;
}

export default function TicketTrackingClient({
  projectId,
  projectName,
  ticket: initialTicket,
  recipeName,
  recipeParams,
  taskDescription,
}: TicketTrackingClientProps) {
  const router = useRouter();
  const [ticket, setTicket] = useState<WorkTicket>(initialTicket);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Create authenticated Supabase client for Realtime (singleton pattern)
  const supabase = createBrowserClient();

  // Subscribe to real-time ticket updates
  useEffect(() => {
    const channel = supabase
      .channel(`work_ticket_${ticket.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'work_tickets',
          filter: `id=eq.${ticket.id}`,
        },
        (payload) => {
          console.log('[Realtime] Ticket updated:', payload.new);
          setTicket((prev) => ({
            ...prev,
            ...(payload.new as any),
          }));

          // Refresh outputs when completed
          if (payload.new.status === 'completed' || payload.new.status === 'failed') {
            handleRefresh();
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [ticket.id, supabase]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const getStatusIcon = () => {
    switch (ticket.status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: 'default',
      running: 'secondary',
      failed: 'destructive',
      pending: 'outline',
    };
    return <Badge variant={variants[ticket.status] || 'outline'} className="capitalize">{ticket.status}</Badge>;
  };

  const formatDuration = () => {
    if (!ticket.started_at) return null;
    const start = new Date(ticket.started_at).getTime();
    const end = ticket.completed_at ? new Date(ticket.completed_at).getTime() : Date.now();
    const duration = Math.floor((end - start) / 1000);

    if (duration < 60) return `${duration}s`;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}m ${seconds}s`;
  };

  // Check if execution produced expected results
  const hasOutputs = ticket.work_outputs && ticket.work_outputs.length > 0;
  const hasExecutionSteps = ticket.metadata?.final_todos && ticket.metadata.final_todos.length > 0;
  const executionTimeMs = ticket.metadata?.execution_time_ms;
  const isCompleted = ticket.status === 'completed';
  const isFailed = ticket.status === 'failed';
  const isRunning = ticket.status === 'running' || ticket.status === 'pending';

  // Determine if this is a problematic execution
  const isProblematicExecution = isCompleted && !hasOutputs && !isFailed;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href={`/projects/${projectId}/work-tickets-view`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Work Tickets
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">{recipeName}</h1>
            <p className="text-muted-foreground mt-1">{projectName}</p>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            {getStatusBadge()}
          </div>
        </div>
      </div>

      {/* Warning Banner for problematic executions */}
      {isProblematicExecution && (
        <Card className="p-4 border-surface-warning-border bg-surface-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-warning-foreground">Execution Completed Without Outputs</h3>
              <p className="text-sm text-warning-foreground/80 mt-1">
                The agent executed for {executionTimeMs ? `${(executionTimeMs / 1000).toFixed(1)}s` : 'an unknown duration'} but did not produce any work outputs or detailed execution steps.
                This may indicate the agent did not follow the recipe requirements properly.
              </p>
              <p className="text-xs text-warning-foreground/70 mt-2">
                Expected: {recipeParams.output_format ? recipeParams.output_format.toUpperCase() : 'file'} output via Skill tool • Actual: No outputs
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Metadata & Progress */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recipe Configuration */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Package className="h-5 w-5" />
              Configuration
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="capitalize">
                  {ticket.agent_type}
                </Badge>
                {ticket.metadata?.output_format && (
                  <Badge variant="outline" className="uppercase">
                    {ticket.metadata.output_format}
                  </Badge>
                )}
                {recipeParams.output_format && (
                  <Badge variant="secondary" className="text-xs">
                    Expected: {recipeParams.output_format.toUpperCase()}
                  </Badge>
                )}
              </div>

              {taskDescription && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Task:</span>
                  <p className="text-sm text-foreground mt-1">{taskDescription}</p>
                </div>
              )}

              {Object.keys(recipeParams).length > 0 && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Parameters:</span>
                  <dl className="mt-2 space-y-2">
                    {Object.entries(recipeParams).map(([key, value]) => (
                      <div key={key} className="flex gap-2 text-sm">
                        <dt className="font-medium text-muted-foreground capitalize">
                          {key.replace(/_/g, ' ')}:
                        </dt>
                        <dd className="text-foreground">
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </Card>

          {/* Real-time Task Progress (for running/pending) */}
          {isRunning && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Live Execution Progress</h2>
              <TaskProgressList workTicketId={ticket.id} enabled={true} />
            </Card>
          )}

          {/* Execution Trace (for completed/failed) */}
          {!isRunning && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Execution Trace
              </h2>

              {hasExecutionSteps ? (
                <div className="space-y-2">
                  {ticket.metadata.final_todos.map((todo: any, index: number) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                      <span className="text-muted-foreground">
                        {todo.content || todo.activeForm || `Step ${index + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-warning-foreground bg-surface-warning border border-surface-warning-border rounded-lg p-3">
                    <p className="font-medium mb-1">No execution steps recorded</p>
                    <p className="text-xs text-warning-foreground/80">
                      The agent {isFailed ? 'failed' : 'completed'} but did not log detailed steps via TodoWrite.
                      {executionTimeMs && ` Execution took ${(executionTimeMs / 1000).toFixed(1)}s.`}
                    </p>
                  </div>

                  {/* Basic execution metadata */}
                  {ticket.metadata && (
                    <div className="text-xs text-muted-foreground space-y-1 bg-muted rounded-lg p-3">
                      <p className="font-medium text-foreground mb-2">Execution Metadata:</p>
                      {ticket.metadata.workflow && <p>• Workflow: {ticket.metadata.workflow}</p>}
                      {ticket.metadata.recipe_slug && <p>• Recipe: {ticket.metadata.recipe_slug}</p>}
                      {executionTimeMs && <p>• Execution time: {(executionTimeMs / 1000).toFixed(1)}s</p>}
                      {ticket.metadata.output_count !== undefined && (
                        <p>• Outputs generated: {ticket.metadata.output_count}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Error Message */}
          {isFailed && ticket.error_message && (
            <Card className="p-6 border-surface-danger-border bg-surface-danger">
              <h2 className="text-lg font-semibold mb-2 text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Execution Failed
              </h2>
              <p className="text-sm text-destructive-foreground font-mono bg-destructive/10 p-3 rounded">
                {ticket.error_message}
              </p>
            </Card>
          )}

          {/* Work Outputs */}
          {hasOutputs ? (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Work Outputs ({ticket.work_outputs.length})</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                </Button>
              </div>
              <div className="space-y-4">
                {ticket.work_outputs.map((output) => (
                  <OutputCard key={output.id} output={output} />
                ))}
              </div>
            </Card>
          ) : isCompleted && (
            <Card className="p-6 border-surface-warning-border bg-surface-warning">
              <h2 className="text-lg font-semibold mb-3 text-warning-foreground">No Work Outputs</h2>
              <div className="space-y-3 text-sm text-warning-foreground/90">
                <p>
                  The agent completed execution but did not generate any work outputs.
                  This is unexpected for a {ticket.agent_type} agent working on a {recipeName} task.
                </p>
                <div className="bg-warning/10 border border-surface-warning-border rounded p-3">
                  <p className="font-medium mb-2 text-warning-foreground">Expected Output:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {recipeParams.output_format && (
                      <li>Format: {recipeParams.output_format.toUpperCase()} file</li>
                    )}
                    <li>Generation method: Skill tool (professional file generation)</li>
                    <li>Output type: report_draft or final_report</li>
                  </ul>
                </div>
                <p className="text-xs text-warning-foreground/70">
                  This may indicate a bug in the agent execution or a missing emit_work_output call.
                  Check the agent logs for more details.
                </p>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Metadata */}
        <div className="space-y-6">
          {/* Timeline */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Timeline</h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Created:</span>
                <p className="text-foreground">{new Date(ticket.created_at).toLocaleString()}</p>
              </div>
              {ticket.started_at && (
                <div>
                  <span className="text-muted-foreground">Started:</span>
                  <p className="text-foreground">{new Date(ticket.started_at).toLocaleString()}</p>
                </div>
              )}
              {ticket.completed_at && (
                <div>
                  <span className="text-muted-foreground">Completed:</span>
                  <p className="text-foreground">{new Date(ticket.completed_at).toLocaleString()}</p>
                </div>
              )}
              {formatDuration() && (
                <div>
                  <span className="text-muted-foreground">Duration:</span>
                  <p className="text-foreground font-mono">{formatDuration()}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Diagnostics (for completed tickets) */}
          {!isRunning && (
            <Card className="p-6 bg-muted/50">
              <h2 className="text-lg font-semibold mb-4">Diagnostics</h2>
              <div className="space-y-3 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Ticket ID:</span>
                  <code className="text-xs bg-secondary px-1 rounded">{ticket.id.slice(0, 8)}...</code>
                </div>
                <div className="flex justify-between">
                  <span>Agent Type:</span>
                  <span className="font-medium">{ticket.agent_type}</span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className="font-medium capitalize">{ticket.status}</span>
                </div>
                <div className="flex justify-between">
                  <span>Outputs:</span>
                  <span className={cn("font-medium", hasOutputs ? "text-success" : "text-warning")}>
                    {ticket.work_outputs?.length || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Execution Steps:</span>
                  <span className={cn("font-medium", hasExecutionSteps ? "text-success" : "text-warning")}>
                    {ticket.metadata?.final_todos?.length || 0}
                  </span>
                </div>
                {executionTimeMs && (
                  <div className="flex justify-between">
                    <span>Execution Time:</span>
                    <span className="font-medium font-mono">{(executionTimeMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Actions */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
                Refresh
              </Button>
              <Link href={`/projects/${projectId}/work-tickets-view`} className="block">
                <Button variant="outline" className="w-full">
                  View All Tickets
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OutputCard({ output }: { output: WorkOutput }) {
  const isFileOutput = output.file_id && output.file_format;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{output.title}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {output.output_type}
            </Badge>
            {output.file_format && (
              <Badge variant="secondary" className="text-xs uppercase">
                {output.file_format}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {output.generation_method}
            </span>
            {!isFileOutput && output.body && (
              <span className="text-xs text-muted-foreground">
                ({output.body.length} chars)
              </span>
            )}
          </div>
        </div>
        {isFileOutput && (
          <Button variant="ghost" size="sm">
            <Download className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Preview body for text outputs */}
      {!isFileOutput && output.body && (
        <div className="text-sm text-muted-foreground max-h-32 overflow-auto bg-muted rounded p-3">
          <pre className="whitespace-pre-wrap font-sans text-xs">{output.body.slice(0, 500)}{output.body.length > 500 ? '...' : ''}</pre>
        </div>
      )}

      {/* File download info */}
      {isFileOutput && (
        <div className="text-sm text-success-foreground bg-surface-success border border-surface-success-border rounded p-2">
          File ready for download
        </div>
      )}
    </div>
  );
}

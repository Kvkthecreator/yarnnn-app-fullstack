"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface WorkSessionExecutorProps {
  projectId: string;
  sessionId: string;
  initialStatus: string;
  initialArtifactsCount?: number;
}

interface SessionStatus {
  session_id: string;
  status: string;
  artifacts_count: number;
  checkpoints: Array<{
    id: string;
    reason: string;
    status: string;
    created_at: string;
  }>;
  metadata: any;
}

export default function WorkSessionExecutor({
  projectId,
  sessionId,
  initialStatus,
  initialArtifactsCount = 0,
}: WorkSessionExecutorProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [artifactsCount, setArtifactsCount] = useState(initialArtifactsCount);
  const [checkpoints, setCheckpoints] = useState<SessionStatus["checkpoints"]>([]);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // Poll for status updates when executing
  // Note: DB uses 'running', frontend displays as 'in_progress'
  useEffect(() => {
    if (status === "running" || status === "in_progress" || status === "initialized" && polling) {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(
            `/api/projects/${projectId}/work-sessions/${sessionId}/status`
          );

          if (response.ok) {
            const data: SessionStatus = await response.json();
            setStatus(data.status);
            setArtifactsCount(data.artifacts_count);
            setCheckpoints(data.checkpoints || []);

            // Stop polling when terminal status reached
            if (["completed", "failed", "pending_review"].includes(data.status)) {
              setPolling(false);
              setExecuting(false);
              router.refresh(); // Refresh server component
            }
          }
        } catch (err) {
          console.error("Failed to poll status:", err);
        }
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
  }, [status, polling, projectId, sessionId, router]);

  const handleExecute = async () => {
    setExecuting(true);
    setError(null);
    setPolling(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/work-sessions/${sessionId}/execute`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          detail: "Failed to execute work ticket",
        }));
        throw new Error(
          typeof errorData.detail === "string"
            ? errorData.detail
            : "Failed to execute work ticket"
        );
      }

      const result = await response.json();
      setStatus(result.status);

      if (result.status === "failed") {
        setError(result.error || "Execution failed");
        setExecuting(false);
        setPolling(false);
      } else if (result.status === "completed") {
        setArtifactsCount(result.artifacts_count);
        setExecuting(false);
        setPolling(false);
        router.refresh();
      } else if (result.status === "checkpoint_required") {
        setArtifactsCount(result.artifacts_count);
        setExecuting(false);
        setPolling(false);
        router.refresh();
      }
      // If status is in_progress, polling will handle updates
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to execute work ticket";
      setError(message);
      setExecuting(false);
      setPolling(false);
    }
  };

  // Show execute button for pending or initialized status
  // Note: DB uses 'pending', legacy code may use 'initialized'
  if (status === "pending" || status === "initialized") {
    return (
      <Card className="p-6 border border-surface-primary-border bg-surface-primary">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3 flex-1">
            <Play className="h-6 w-6 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold text-foreground">Ready to Execute</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This work ticket is ready. Click Execute to start the agent.
              </p>
              {error && (
                <div className="mt-3 flex items-start gap-2 rounded border border-surface-danger-border bg-surface-danger p-3 text-sm text-destructive-foreground">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-destructive" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
          <Button
            onClick={handleExecute}
            disabled={executing}
            className="gap-2"
            size="lg"
          >
            {executing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Execute Work Ticket
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  // Show execution status for running/in_progress
  // Note: DB uses 'running', legacy code may use 'in_progress'
  if (status === "running" || status === "in_progress") {
    return (
      <Card className="p-6 border border-surface-primary-border bg-surface-primary">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <div>
            <h3 className="font-semibold text-foreground">Agent is executing your task</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The agent is actively working on your request. Results will appear when completed.
            </p>
            {artifactsCount > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
                <FileText className="h-4 w-4" />
                <span>{artifactsCount} artifact{artifactsCount !== 1 ? 's' : ''} created so far</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Show pending review status for checkpoint
  if (status === "pending_review") {
    return (
      <Card className="p-6 border border-surface-warning-border bg-surface-warning">
        <div className="flex items-start gap-3">
          <Clock className="h-6 w-6 text-warning-foreground mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-warning-foreground">Checkpoint - Review Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The agent has paused for your review before continuing.
            </p>
            {artifactsCount > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm text-warning-foreground">
                <FileText className="h-4 w-4" />
                <span>{artifactsCount} artifact{artifactsCount !== 1 ? 's' : ''} created</span>
              </div>
            )}
            {checkpoints.length > 0 && (
              <div className="mt-3 space-y-2">
                {checkpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="rounded border border-surface-warning-border bg-card p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-warning-foreground">
                        Checkpoint
                      </span>
                      <Badge variant="outline">{checkpoint.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{checkpoint.reason}</p>
                    {/* TODO: Add approve/reject buttons in Phase 3 */}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Show completed status
  if (status === "completed") {
    return (
      <Card className="p-6 border border-surface-success-border bg-surface-success">
        <div className="flex items-start gap-3">
          <CheckCircle className="h-6 w-6 text-success-foreground mt-0.5" />
          <div>
            <h3 className="font-semibold text-success-foreground">Task Completed Successfully</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The agent has successfully completed your task.
            </p>
            {artifactsCount > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm text-success-foreground">
                <FileText className="h-4 w-4" />
                <span>{artifactsCount} artifact{artifactsCount !== 1 ? 's' : ''} generated</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Show failed status
  if (status === "failed") {
    return (
      <Card className="p-6 border border-surface-danger-border bg-surface-danger">
        <div className="flex items-start gap-3">
          <XCircle className="h-6 w-6 text-destructive mt-0.5" />
          <div>
            <h3 className="font-semibold text-destructive-foreground">Execution Failed</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The agent encountered an error during execution.
            </p>
            {error && (
              <p className="text-sm text-destructive-foreground mt-2 font-mono rounded border border-surface-danger-border bg-card">
                {error}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Fallback for other statuses
  return null;
}

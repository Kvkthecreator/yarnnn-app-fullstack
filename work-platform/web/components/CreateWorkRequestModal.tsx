"use client";

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react';
import ResearchConfigForm, { type ResearchConfig } from '@/components/work/ResearchConfigForm';
import ContentConfigForm, { type ContentConfig } from '@/components/work/ContentConfigForm';
import ReportingConfigForm, { type ReportingConfig } from '@/components/work/ReportingConfigForm';
import ApprovalStrategySelector, { type ApprovalStrategy } from '@/components/work/ApprovalStrategySelector';

interface ProjectAgent {
  id: string;
  agent_type: string;
  display_name: string;
  is_active: boolean;
}

interface CreateWorkRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  agents: ProjectAgent[];
  preSelectedAgentId?: string | null;
}

export default function CreateWorkRequestModal({
  open,
  onOpenChange,
  projectId,
  agents,
  preSelectedAgentId,
}: CreateWorkRequestModalProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(preSelectedAgentId || '');
  const [taskDescription, setTaskDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Agent-specific configurations
  const [researchConfig, setResearchConfig] = useState<ResearchConfig>({
    research_scope: {
      depth: "detailed",
      timeframe_lookback_days: 30,
    },
    output_preferences: {
      format: "detailed_report",
      max_findings: 10,
      confidence_threshold: 0.7,
    },
  });

  const [contentConfig, setContentConfig] = useState<ContentConfig>({
    content_spec: {
      platform: "general",
      tone: "professional",
      target_audience: "",
    },
    brand_requirements: {
      use_brand_voice: true,
      include_cta: false,
    },
    variations_count: 1,
  });

  const [reportingConfig, setReportingConfig] = useState<ReportingConfig>({
    report_spec: {
      report_type: "executive_summary",
      time_period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      time_period_end: new Date().toISOString().split('T')[0],
      sections_required: ["Overview", "Key Metrics", "Recommendations"],
    },
    data_sources: {
      include_timeline_events: true,
      include_metrics: true,
    },
    audience: {
      stakeholder_level: "executive",
      depth: "high_level",
    },
  });

  const [approvalStrategy, setApprovalStrategy] = useState<ApprovalStrategy>({
    strategy: "final_only",
  });

  // Update selectedAgentId when preSelectedAgentId changes (e.g., when clicking an agent card)
  useEffect(() => {
    if (preSelectedAgentId) {
      setSelectedAgentId(preSelectedAgentId);
    }
  }, [preSelectedAgentId]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const canSubmit = selectedAgentId && taskDescription.trim().length >= 10 &&
    (selectedAgent?.agent_type !== 'content' || contentConfig.content_spec.target_audience.trim().length >= 3) &&
    (selectedAgent?.agent_type !== 'reporting' || (reportingConfig.report_spec.time_period_start && reportingConfig.report_spec.time_period_end));

  const resetState = () => {
    setSelectedAgentId('');
    setTaskDescription('');
    setError(null);
    setSubmitting(false);
    setSuccess(false);
  };

  const handleClose = (nextOpen: boolean) => {
    if (submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) resetState();
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      // Build agent-specific configuration payload
      const payload: any = {
        agent_id: selectedAgentId,
        task_description: taskDescription,
        approval_strategy: approvalStrategy,
        priority: 5,
      };

      // Add agent-type specific configuration
      if (selectedAgent?.agent_type === 'research') {
        payload.research_config = researchConfig;
      } else if (selectedAgent?.agent_type === 'content') {
        payload.content_config = contentConfig;
      } else if (selectedAgent?.agent_type === 'reporting') {
        payload.reporting_config = reportingConfig;
      }

      const response = await fetch(`/api/projects/${projectId}/work-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to create work request' }));

        // Handle trial exhausted error
        if (response.status === 403) {
          const message = typeof errorData.detail === 'object'
            ? errorData.detail.message
            : errorData.detail;
          throw new Error(message || 'Permission denied');
        }

        throw new Error(typeof errorData.detail === 'string' ? errorData.detail : 'Failed to create work request');
      }

      const result = await response.json();

      setSuccess(true);

      // Close modal and redirect after a short delay
      setTimeout(() => {
        handleClose(false);
        resetState();
        // Backend returns ticket_id (Phase 2e work_tickets primary key)
        const sessionId = result.ticket_id || result.session_id; // Backward compat
        router.push(`/projects/${projectId}/work-sessions/${sessionId}`);
        router.refresh();
      }, 1500);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create work request';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Work Request</DialogTitle>
          <DialogDescription>
            Select an agent and describe the work you want done. The agent will process your request and generate results.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {/* Agent Selection */}
          <section className="flex flex-col gap-3">
            <Label className="text-sm font-medium text-slate-800">
              Select Agent <span className="text-destructive">*</span>
            </Label>
            <div className="grid gap-3 md:grid-cols-3">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  disabled={!agent.is_active || submitting}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition ${
                    selectedAgentId === agent.id
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  } ${!agent.is_active || submitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`rounded-lg p-2 ${
                      selectedAgentId === agent.id ? 'bg-blue-100' : 'bg-blue-50'
                    }`}>
                      <Zap className={`h-5 w-5 ${
                        selectedAgentId === agent.id ? 'text-blue-700' : 'text-blue-600'
                      }`} />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{agent.display_name}</div>
                      <div className="text-xs text-slate-500">{agent.agent_type}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {selectedAgent && (
              <p className="text-xs text-slate-600">
                {getAgentDescription(selectedAgent.agent_type)}
              </p>
            )}
          </section>

          {/* Task Description */}
          <section className="flex flex-col gap-2">
            <Label htmlFor="task-description" className="text-sm font-medium text-slate-800">
              Task Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="task-description"
              placeholder="Describe what you want the agent to do... (minimum 10 characters)"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              rows={6}
              className="resize-none"
              maxLength={5000}
              disabled={submitting}
            />
            <p className="text-xs text-slate-500">
              {taskDescription.length}/5000 characters {taskDescription.length < 10 && '(minimum 10)'}
            </p>
          </section>

          {/* Agent-Specific Configuration Forms */}
          {selectedAgent && selectedAgent.agent_type === 'research' && (
            <ResearchConfigForm
              config={researchConfig}
              onChange={setResearchConfig}
            />
          )}

          {selectedAgent && selectedAgent.agent_type === 'content' && (
            <ContentConfigForm
              config={contentConfig}
              onChange={setContentConfig}
            />
          )}

          {selectedAgent && selectedAgent.agent_type === 'reporting' && (
            <ReportingConfigForm
              config={reportingConfig}
              onChange={setReportingConfig}
            />
          )}

          {/* Approval Strategy */}
          {selectedAgent && (
            <ApprovalStrategySelector
              strategy={approvalStrategy}
              onChange={setApprovalStrategy}
              agentType={selectedAgent.agent_type}
            />
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              <span>Work request created! Redirecting to session details...</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleClose(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </span>
            ) : (
              'Create Work Request'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getAgentDescription(agentType: string): string {
  switch (agentType) {
    case 'research':
      return 'Researches topics, gathers information, and provides comprehensive analysis.';
    case 'content':
      return 'Creates written content, articles, documentation, and creative writing.';
    case 'reporting':
      return 'Generates reports, summaries, and structured data presentations.';
    default:
      return 'Performs general-purpose work tasks.';
  }
}

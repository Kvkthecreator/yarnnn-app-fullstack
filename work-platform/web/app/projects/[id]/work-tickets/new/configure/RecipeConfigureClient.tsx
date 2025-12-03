"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Users, Eye, TrendingUp, Target, Brain, MessageSquare, Compass, UserCheck, FileOutput, Calendar, Clock, RefreshCw, History, Zap, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Role display configuration
const ROLE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  problem: { label: "Problem", icon: AlertTriangle },
  customer: { label: "Customer", icon: Users },
  vision: { label: "Vision", icon: Eye },
  solution: { label: "Solution", icon: CheckCircle2 },
  trend_digest: { label: "Trend Digest", icon: TrendingUp },
  competitor_snapshot: { label: "Competitor Snapshot", icon: Target },
  market_signal: { label: "Market Signal", icon: Brain },
  brand_voice: { label: "Brand Voice", icon: MessageSquare },
  strategic_direction: { label: "Strategic Direction", icon: Compass },
  customer_insight: { label: "Customer Insight", icon: UserCheck },
};

interface RecipeParameter {
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
  default?: any;
  min?: number;
  max?: number;
  options?: readonly string[];
}

interface ContextRequirements {
  roles?: string[];
  roles_optional?: string[];
}

interface ContextOutputs {
  role: string;
  refresh_policy?: { ttl_hours: number; auto_promote?: boolean };
}

interface Recipe {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  output_format: string;
  parameters: Record<string, RecipeParameter>;
  context_requirements?: ContextRequirements;
  context_outputs?: ContextOutputs;
}

interface ContextAnchor {
  anchor_key: string;
  lifecycle: string;
  updated_at?: string;
}

interface ExistingSchedule {
  id: string;
  frequency: string;
  day_of_week: number;
  time_of_day: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
}

interface ExecutionHistoryItem {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  source: string;
  schedule_id?: string;
}

interface RecipeConfigureClientProps {
  projectId: string;
  basketId: string;
  workspaceId: string;
  recipe: Recipe & { db_id?: string };
  contextAnchors?: ContextAnchor[];
  existingSchedule?: ExistingSchedule | null;
  executionHistory?: ExecutionHistoryItem[];
}

// Day of week options
const DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

// Frequency options with descriptions
const FREQUENCY_OPTIONS = [
  { value: "", label: "Run once (no schedule)", description: "Execute now only" },
  { value: "weekly", label: "Weekly", description: "Every week" },
  { value: "biweekly", label: "Every 2 weeks", description: "Biweekly" },
  { value: "monthly", label: "Monthly", description: "Once per month" },
];

export default function RecipeConfigureClient({
  projectId,
  basketId,
  workspaceId,
  recipe,
  contextAnchors = [],
  existingSchedule = null,
  executionHistory = [],
}: RecipeConfigureClientProps) {
  const router = useRouter();

  // Context validation
  const approvedRoles = new Set(
    contextAnchors
      .filter(a => a.lifecycle === 'approved')
      .map(a => a.anchor_key)
  );
  const requiredRoles = recipe.context_requirements?.roles || [];
  const optionalRoles = recipe.context_requirements?.roles_optional || [];
  const missingRoles = requiredRoles.filter(role => !approvedRoles.has(role));
  const hasAllRequired = missingRoles.length === 0;

  const [formValues, setFormValues] = useState<Record<string, any>>(() => {
    // Initialize with defaults
    const initial: Record<string, any> = {};
    Object.entries(recipe.parameters).forEach(([key, param]) => {
      if (param.default !== undefined) {
        initial[key] = param.default;
      }
    });
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Schedule state
  const [scheduleFrequency, setScheduleFrequency] = useState(existingSchedule?.frequency || "");
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(existingSchedule?.day_of_week ?? 1);
  const [scheduleTime, setScheduleTime] = useState(existingSchedule?.time_of_day?.slice(0, 5) || "09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(existingSchedule?.enabled ?? true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);

  const handleInputChange = (key: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Build task description from form values
      const topic = formValues.topic || "Work request";
      const taskDescription = `${topic}\n\nRecipe: ${recipe.name}\nParameters: ${JSON.stringify(formValues, null, 2)}`;

      // Call appropriate specialist endpoint based on agent type
      let endpoint = "";
      let requestBody: any = {
        basket_id: basketId,
        task_description: taskDescription,
        output_format: recipe.output_format,
        priority: 5,
        recipe_id: recipe.id, // Use slug directly from database
        recipe_parameters: formValues, // Pass validated parameters
        async_execution: true, // Enable async mode for immediate redirect
      };

      // Include context_outputs if recipe produces an anchor role
      // This enables auto-promotion of outputs to context blocks
      if (recipe.context_outputs) {
        requestBody.context_outputs = {
          target_context_role: recipe.context_outputs.role,
          auto_promote: recipe.context_outputs.refresh_policy?.auto_promote ?? true,
          ttl_hours: recipe.context_outputs.refresh_policy?.ttl_hours,
        };
      }

      switch (recipe.agent_type) {
        case "reporting":
          endpoint = "/api/work/reporting/execute";
          break;
        case "research":
          endpoint = "/api/work/research/execute";
          break;
        case "content":
          endpoint = "/api/work/content/execute";
          break;
        default:
          throw new Error(`Unknown agent type: ${recipe.agent_type}`);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();

      // Redirect to live tracking page
      if (result.work_ticket_id) {
        router.push(`/projects/${projectId}/work-tickets/${result.work_ticket_id}/track`);
      } else {
        throw new Error("No work_ticket_id in response");
      }
    } catch (err: any) {
      console.error("Recipe execution failed:", err);
      setError(err.message || "Failed to execute recipe");
      setSubmitting(false);
    }
  };

  const canSubmit = () => {
    // Check all required parameters are filled
    return Object.entries(recipe.parameters).every(([key, param]) => {
      if (!param.required) return true;
      const value = formValues[key];
      if (param.type === "multitext") {
        return Array.isArray(value) && value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    });
  };

  // Save or update schedule
  const handleSaveSchedule = async () => {
    if (!scheduleFrequency || !recipe.db_id) return;

    setSavingSchedule(true);
    setError(null);
    setScheduleSuccess(null);

    try {
      const scheduleData = {
        recipe_id: recipe.db_id,
        frequency: scheduleFrequency,
        day_of_week: scheduleDayOfWeek,
        time_of_day: `${scheduleTime}:00`,
        recipe_parameters: formValues,
        enabled: scheduleEnabled,
      };

      const method = existingSchedule ? "PATCH" : "POST";
      const url = existingSchedule
        ? `/api/projects/${projectId}/schedules/${existingSchedule.id}`
        : `/api/projects/${projectId}/schedules`;

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      setScheduleSuccess(existingSchedule ? "Schedule updated!" : "Schedule created!");

      // Clear success message after 3 seconds
      setTimeout(() => setScheduleSuccess(null), 3000);

    } catch (err: any) {
      console.error("Failed to save schedule:", err);
      setError(err.message || "Failed to save schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  // Delete schedule
  const handleDeleteSchedule = async () => {
    if (!existingSchedule) return;

    setSavingSchedule(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/schedules/${existingSchedule.id}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      setScheduleFrequency("");
      setScheduleSuccess("Schedule deleted");
      setTimeout(() => setScheduleSuccess(null), 3000);

    } catch (err: any) {
      console.error("Failed to delete schedule:", err);
      setError(err.message || "Failed to delete schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  // Get recommended frequency based on TTL
  const getRecommendedFrequency = () => {
    const ttlHours = recipe.context_outputs?.refresh_policy?.ttl_hours;
    if (!ttlHours) return null;
    const days = Math.round(ttlHours / 24);
    if (days <= 7) return "weekly";
    if (days <= 14) return "biweekly";
    return "monthly";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href={`/projects/${projectId}/work-tickets/new`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Recipe Gallery
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{recipe.name}</h1>
            <p className="text-muted-foreground mt-1">{recipe.description}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Badge variant="outline" className="capitalize">{recipe.agent_type} Agent</Badge>
            <Badge variant="secondary" className="uppercase">{recipe.output_format}</Badge>
          </div>
        </div>
      </div>

      {/* Context Requirements Card */}
      {(requiredRoles.length > 0 || optionalRoles.length > 0 || recipe.context_outputs) && (
        <Card className={cn(
          "p-4",
          !hasAllRequired ? "border-yellow-500/30 bg-yellow-500/5" : "border-green-500/30 bg-green-500/5"
        )}>
          <div className="flex items-center gap-2 mb-3">
            {hasAllRequired ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
            )}
            <h3 className="font-semibold text-sm">
              {hasAllRequired ? "Context Ready" : "Context Required"}
            </h3>
          </div>

          {/* Required roles */}
          {requiredRoles.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-2">Required context:</p>
              <div className="flex flex-wrap gap-2">
                {requiredRoles.map(role => {
                  const config = ROLE_CONFIG[role];
                  const satisfied = approvedRoles.has(role);
                  const IconComponent = config?.icon || AlertTriangle;
                  return (
                    <Badge
                      key={role}
                      variant="outline"
                      className={cn(
                        "text-xs gap-1",
                        satisfied
                          ? "bg-green-500/10 text-green-700 border-green-500/30"
                          : "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
                      )}
                    >
                      <IconComponent className="h-3 w-3" />
                      {config?.label || role}
                      {satisfied && <CheckCircle2 className="h-3 w-3 ml-0.5" />}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional roles */}
          {optionalRoles.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-2">Optional (enhances output):</p>
              <div className="flex flex-wrap gap-2">
                {optionalRoles.map(role => {
                  const config = ROLE_CONFIG[role];
                  const satisfied = approvedRoles.has(role);
                  const IconComponent = config?.icon || Brain;
                  return (
                    <Badge
                      key={role}
                      variant="outline"
                      className={cn(
                        "text-xs gap-1",
                        satisfied
                          ? "bg-blue-500/10 text-blue-700 border-blue-500/30"
                          : "bg-muted text-muted-foreground border-muted-foreground/30"
                      )}
                    >
                      <IconComponent className="h-3 w-3" />
                      {config?.label || role}
                      {satisfied && <CheckCircle2 className="h-3 w-3 ml-0.5" />}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Context output with scheduling info */}
          {recipe.context_outputs && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Produces:</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs gap-1 bg-purple-500/10 text-purple-700 border-purple-500/30">
                  <FileOutput className="h-3 w-3" />
                  {ROLE_CONFIG[recipe.context_outputs.role]?.label || recipe.context_outputs.role}
                </Badge>
                {/* Show existing anchor status */}
                {(() => {
                  const existingAnchor = contextAnchors.find(a => a.anchor_key === recipe.context_outputs?.role);
                  if (existingAnchor) {
                    const updatedAt = existingAnchor.updated_at ? new Date(existingAnchor.updated_at) : null;
                    const ttlHours = recipe.context_outputs?.refresh_policy?.ttl_hours;
                    const isStale = updatedAt && ttlHours
                      ? (Date.now() - updatedAt.getTime()) > (ttlHours * 60 * 60 * 1000)
                      : false;
                    return (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs gap-1",
                          isStale
                            ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
                            : "bg-blue-500/10 text-blue-700 border-blue-500/30"
                        )}
                      >
                        {isStale ? "⏰ Stale - refresh recommended" : "✓ Already exists"}
                        {updatedAt && (
                          <span className="text-[10px] opacity-70 ml-1">
                            (updated {updatedAt.toLocaleDateString()})
                          </span>
                        )}
                      </Badge>
                    );
                  }
                  return null;
                })()}
              </div>
              {/* Refresh policy info */}
              {recipe.context_outputs.refresh_policy && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  📅 Refresh policy: Every {Math.round(recipe.context_outputs.refresh_policy.ttl_hours / 24)} days
                  {recipe.context_outputs.refresh_policy.auto_promote === false && " • Manual promotion required"}
                </p>
              )}
            </div>
          )}

          {/* Missing context warning */}
          {!hasAllRequired && (
            <Link
              href={`/projects/${projectId}/context`}
              className="mt-3 flex items-center gap-1 text-xs text-yellow-700 hover:text-yellow-800"
            >
              <ArrowLeft className="h-3 w-3 rotate-180" />
              Add missing context to enable this recipe
            </Link>
          )}
        </Card>
      )}

      {/* Configuration Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">Recipe Configuration</h2>
          <div className="space-y-4">
            {Object.entries(recipe.parameters).map(([key, param]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>
                  {param.label}
                  {param.required && <span className="text-destructive ml-1">*</span>}
                </Label>

                {param.type === "text" && (
                  <Input
                    id={key}
                    type="text"
                    value={formValues[key] || ""}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    placeholder={param.placeholder}
                    required={param.required}
                  />
                )}

                {(param.type === "number" || param.type === "range") && (
                  <Input
                    id={key}
                    type="number"
                    value={formValues[key] || param.default || ""}
                    onChange={(e) => handleInputChange(key, parseInt(e.target.value))}
                    min={param.min}
                    max={param.max}
                    required={param.required}
                  />
                )}

                {param.type === "select" && (
                  <select
                    id={key}
                    value={formValues[key] || param.default || ""}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    required={param.required}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {param.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}

                {param.type === "multitext" && (
                  <Textarea
                    id={key}
                    value={(formValues[key] || param.default || []).join("\n")}
                    onChange={(e) => handleInputChange(key, e.target.value.split("\n").filter(Boolean))}
                    placeholder="Enter one item per line"
                    rows={4}
                    required={param.required}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Schedule Card - only show for recipes with context_outputs (refresh-able) */}
        {recipe.context_outputs && recipe.db_id && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Schedule (Optional)</h2>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              Set up automatic recurring execution to keep your {ROLE_CONFIG[recipe.context_outputs.role]?.label || recipe.context_outputs.role} context fresh.
            </p>

            <div className="space-y-4">
              {/* Frequency selector */}
              <div className="space-y-2">
                <Label htmlFor="schedule-frequency">Repeat this recipe</Label>
                <select
                  id="schedule-frequency"
                  value={scheduleFrequency}
                  onChange={(e) => setScheduleFrequency(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {/* Recommended frequency hint */}
                {getRecommendedFrequency() && scheduleFrequency === "" && (
                  <p className="text-xs text-muted-foreground">
                    Recommended: <button
                      type="button"
                      onClick={() => setScheduleFrequency(getRecommendedFrequency()!)}
                      className="text-primary hover:underline"
                    >
                      {FREQUENCY_OPTIONS.find(f => f.value === getRecommendedFrequency())?.label}
                    </button> based on {Math.round((recipe.context_outputs?.refresh_policy?.ttl_hours || 168) / 24)}-day refresh policy
                  </p>
                )}
              </div>

              {/* Day and time selectors - only show when frequency is set */}
              {scheduleFrequency && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="schedule-day">Day of week</Label>
                    <select
                      id="schedule-day"
                      value={scheduleDayOfWeek}
                      onChange={(e) => setScheduleDayOfWeek(parseInt(e.target.value))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {DAY_OPTIONS.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-time">Time (UTC)</Label>
                    <Input
                      id="schedule-time"
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Existing schedule info */}
              {existingSchedule && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <span className="font-medium">Active Schedule</span>
                    <Badge variant="outline" className={cn(
                      "text-xs ml-auto",
                      existingSchedule.enabled
                        ? "bg-green-500/10 text-green-700 border-green-500/30"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {existingSchedule.enabled ? "Enabled" : "Paused"}
                    </Badge>
                  </div>
                  {existingSchedule.next_run_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3 inline mr-1" />
                      Next run: {new Date(existingSchedule.next_run_at).toLocaleString()}
                    </p>
                  )}
                  {existingSchedule.last_run_at && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Last run: {new Date(existingSchedule.last_run_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Schedule action buttons */}
              {scheduleFrequency && (
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSaveSchedule}
                    disabled={savingSchedule}
                  >
                    {savingSchedule ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Calendar className="h-4 w-4 mr-1" />
                    )}
                    {existingSchedule ? "Update Schedule" : "Save Schedule"}
                  </Button>
                  {existingSchedule && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDeleteSchedule}
                      disabled={savingSchedule}
                      className="text-destructive hover:text-destructive"
                    >
                      Delete Schedule
                    </Button>
                  )}
                  {scheduleSuccess && (
                    <span className="text-sm text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                      {scheduleSuccess}
                    </span>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Execution History Card */}
        {executionHistory.length > 0 && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <History className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-foreground">Recent Executions</h2>
            </div>
            <div className="space-y-2">
              {executionHistory.map((ticket) => {
                const isScheduled = ticket.source === 'scheduled' || !!ticket.schedule_id;
                return (
                  <Link
                    key={ticket.id}
                    href={`/projects/${projectId}/work-tickets/${ticket.id}/track`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-ring transition bg-background"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          ticket.status === 'completed' ? 'default' :
                          ticket.status === 'running' ? 'secondary' :
                          ticket.status === 'failed' ? 'destructive' : 'outline'
                        }
                        className="capitalize text-xs"
                      >
                        {ticket.status}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs gap-1",
                          isScheduled ? "text-primary border-primary/30 bg-primary/5" : "text-muted-foreground"
                        )}
                      >
                        {isScheduled ? (
                          <>
                            <Calendar className="h-3 w-3" />
                            Scheduled
                          </>
                        ) : (
                          <>
                            <Zap className="h-3 w-3" />
                            Manual
                          </>
                        )}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(ticket.created_at).toLocaleDateString()} at{' '}
                        {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
            <Link
              href={`/projects/${projectId}/work-tickets-view`}
              className="mt-4 inline-flex items-center text-sm text-primary hover:underline"
            >
              View all work tickets
              <ExternalLink className="h-3 w-3 ml-1" />
            </Link>
          </Card>
        )}

        {/* Error Display */}
        {error && (
          <Card className="p-4 border-destructive bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Execution Failed</h3>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/projects/${projectId}/work-tickets/new`)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit() || submitting || !hasAllRequired}
            className="min-w-[140px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : !hasAllRequired ? (
              <>
                <AlertTriangle className="h-4 w-4 mr-2" />
                Add Required Context First
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Execute Recipe
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

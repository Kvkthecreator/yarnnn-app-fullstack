"use client";

import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/switch';
import { Calendar, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface Schedule {
  id: string;
  recipe_name: string;
  recipe_slug: string;
  agent_type: string;
  frequency: string;
  day_of_week: number;
  time_of_day: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
}

interface ScheduleCardProps {
  schedule: Schedule;
  onClick: () => void;
  onToggleEnable: (enabled: boolean) => void;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  custom: 'Custom',
};

const AGENT_TYPE_COLORS: Record<string, string> = {
  research: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  content: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  reporting: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  default: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

export default function ScheduleCard({ schedule, onClick, onToggleEnable }: ScheduleCardProps) {
  const agentColor = AGENT_TYPE_COLORS[schedule.agent_type] || AGENT_TYPE_COLORS.default;

  // Format schedule timing
  const dayName = DAY_NAMES[schedule.day_of_week] || 'Unknown';
  const timeFormatted = schedule.time_of_day
    ? format(new Date(`2000-01-01T${schedule.time_of_day}`), 'h:mm a')
    : '9:00 AM';
  const frequencyLabel = FREQUENCY_LABELS[schedule.frequency] || schedule.frequency;

  // Format next run
  const nextRunFormatted = schedule.next_run_at
    ? formatDistanceToNow(new Date(schedule.next_run_at), { addSuffix: true })
    : 'Not scheduled';

  // Format last run
  const lastRunFormatted = schedule.last_run_at
    ? formatDistanceToNow(new Date(schedule.last_run_at), { addSuffix: true })
    : 'Never';

  // Status icon for last run
  const StatusIcon = schedule.last_run_status === 'success'
    ? CheckCircle2
    : schedule.last_run_status === 'failed'
      ? XCircle
      : AlertCircle;

  const statusColor = schedule.last_run_status === 'success'
    ? 'text-green-500'
    : schedule.last_run_status === 'failed'
      ? 'text-red-500'
      : 'text-muted-foreground';

  return (
    <div
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Recipe info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">
              {schedule.recipe_name}
            </h3>
            <Badge variant="secondary" className={agentColor}>
              {schedule.agent_type}
            </Badge>
            {!schedule.enabled && (
              <Badge variant="outline" className="text-muted-foreground">
                Paused
              </Badge>
            )}
          </div>

          {/* Schedule timing */}
          <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {frequencyLabel} on {dayName}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {timeFormatted}
            </span>
          </div>

          {/* Run info */}
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            {schedule.enabled && schedule.next_run_at && (
              <span>
                Next run: <span className="text-foreground">{nextRunFormatted}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <StatusIcon className={`h-3 w-3 ${statusColor}`} />
              Last run: {lastRunFormatted}
              {schedule.run_count > 0 && ` (${schedule.run_count} total)`}
            </span>
          </div>
        </div>

        {/* Right: Enable toggle */}
        <div
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggleEnable}
            aria-label={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
          />
        </div>
      </div>
    </div>
  );
}

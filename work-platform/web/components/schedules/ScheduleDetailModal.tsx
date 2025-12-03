"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/AlertDialog';
import { Calendar, Clock, Pencil, Trash2, Loader2, CheckCircle2, XCircle, Play, Settings2, ExternalLink } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

interface Schedule {
  id: string;
  project_id: string;
  recipe_id: string;
  recipe_name: string;
  recipe_slug: string;
  agent_type: string;
  context_outputs: any;
  frequency: string;
  day_of_week: number;
  time_of_day: string;
  recipe_parameters: Record<string, any>;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  created_at: string;
}

interface ScheduleDetailModalProps {
  schedule: Schedule | null;
  projectId: string;
  open: boolean;
  onClose: () => void;
  onEdit: (schedule: Schedule) => void;
  onDeleted: () => void;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  custom: 'Custom',
};

export default function ScheduleDetailModal({
  schedule,
  projectId,
  open,
  onClose,
  onEdit,
  onDeleted,
}: ScheduleDetailModalProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!schedule) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/schedules/${schedule.id}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setShowDeleteConfirm(false);
        onDeleted();
      } else {
        console.error('[Schedule] Delete failed');
      }
    } catch (error) {
      console.error('[Schedule] Delete error:', error);
    } finally {
      setDeleting(false);
    }
  };

  // Format values
  const dayName = DAY_NAMES[schedule.day_of_week] || 'Unknown';
  const timeFormatted = schedule.time_of_day
    ? format(new Date(`2000-01-01T${schedule.time_of_day}`), 'h:mm a')
    : '9:00 AM';
  const frequencyLabel = FREQUENCY_LABELS[schedule.frequency] || schedule.frequency;

  const nextRunFormatted = schedule.next_run_at
    ? format(new Date(schedule.next_run_at), 'PPp')
    : 'Not scheduled';

  const lastRunFormatted = schedule.last_run_at
    ? format(new Date(schedule.last_run_at), 'PPp')
    : 'Never';

  const createdFormatted = format(new Date(schedule.created_at), 'PPp');

  // Context output role
  const outputRole = schedule.context_outputs?.role;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Schedule Details
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Recipe Info */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Recipe</h3>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium">{schedule.recipe_name}</span>
                <Badge variant="secondary">{schedule.agent_type}</Badge>
              </div>
              {outputRole && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Produces: <span className="text-foreground">{outputRole}</span> context
                </p>
              )}
              {/* Link to full recipe configuration */}
              <Link
                href={`/projects/${projectId}/work-tickets/new/configure?recipe=${schedule.recipe_slug}`}
                className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Configure recipe & view history
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            {/* Schedule Config */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Schedule</h3>
              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{frequencyLabel} on {dayName}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{timeFormatted} UTC</span>
                </div>
              </div>
            </div>

            {/* Status */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Status</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Enabled</span>
                  <Badge variant={schedule.enabled ? 'default' : 'secondary'}>
                    {schedule.enabled ? 'Active' : 'Paused'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Next Run</span>
                  <span>{schedule.enabled ? nextRunFormatted : 'Paused'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Last Run</span>
                  <span className="flex items-center gap-1">
                    {schedule.last_run_status === 'success' && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                    {schedule.last_run_status === 'failed' && (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                    {lastRunFormatted}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Runs</span>
                  <span>{schedule.run_count}</span>
                </div>
              </div>
            </div>

            {/* Parameters (if any) */}
            {schedule.recipe_parameters && Object.keys(schedule.recipe_parameters).length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Parameters</h3>
                <div className="rounded-lg bg-muted/50 p-3 text-sm font-mono">
                  {Object.entries(schedule.recipe_parameters).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground">{key}:</span>
                      <span>{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="text-xs text-muted-foreground">
              Created: {createdFormatted}
            </div>
          </div>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button size="sm" onClick={() => onEdit(schedule)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the schedule for "{schedule.recipe_name}".
              Any pending jobs for this schedule will be cancelled.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Schedule'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

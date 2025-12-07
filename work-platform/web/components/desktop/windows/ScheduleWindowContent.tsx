'use client';

/**
 * ScheduleWindowContent
 *
 * Content for the Schedule floating window.
 * Displays scheduled work (future feature - placeholder for now).
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { Calendar, Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function ScheduleWindowContent() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Calendar className="h-8 w-8 text-muted-foreground" />
      </div>

      <h3 className="text-lg font-semibold">Scheduled Work</h3>

      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        Schedule recipes to run automatically at specific times or intervals.
        This feature is coming soon.
      </p>

      <div className="mt-6 space-y-2 text-left w-full max-w-sm">
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          <Clock className="h-5 w-5" />
          <div>
            <p className="font-medium">Daily competitor check</p>
            <p className="text-xs">Every day at 9:00 AM</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          <Clock className="h-5 w-5" />
          <div>
            <p className="font-medium">Weekly trend digest</p>
            <p className="text-xs">Every Monday at 8:00 AM</p>
          </div>
        </div>
      </div>

      <Button variant="outline" className="mt-6" disabled>
        <Plus className="h-4 w-4 mr-2" />
        Add Schedule
      </Button>

      <p className="text-xs text-muted-foreground mt-4">
        Coming in a future update
      </p>
    </div>
  );
}

export default ScheduleWindowContent;

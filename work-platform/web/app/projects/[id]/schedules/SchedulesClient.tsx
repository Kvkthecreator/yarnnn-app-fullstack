"use client";

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase/clients';
import { Button } from '@/components/ui/Button';
import { Plus, Calendar, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import ScheduleCard from '@/components/schedules/ScheduleCard';
import ScheduleDetailModal from '@/components/schedules/ScheduleDetailModal';
import ScheduleFormModal from '@/components/schedules/ScheduleFormModal';

export interface Schedule {
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

export interface Recipe {
  id: string;
  name: string;
  slug: string;
  agent_type: string;
  context_outputs: any;
}

interface SchedulesClientProps {
  projectId: string;
  basketId: string;
  initialSchedules: Schedule[];
  availableRecipes: Recipe[];
}

export default function SchedulesClient({
  projectId,
  basketId,
  initialSchedules,
  availableRecipes,
}: SchedulesClientProps) {
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [loading, setLoading] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const supabase = createBrowserClient();

  // Fetch schedules
  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/schedules`);
      if (response.ok) {
        const data = await response.json();
        setSchedules(data.schedules || []);
      }
    } catch (error) {
      console.error('[Schedules] Failed to fetch:', error);
    } finally {
      setLoading(false);
    }
  };

  // Real-time subscription for schedule updates
  useEffect(() => {
    const channel = supabase
      .channel(`project_schedules_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_schedules',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          console.log('[Schedules] Realtime update:', payload.eventType);
          // Refetch on any change for simplicity
          fetchSchedules();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  // Handle toggle enable
  const handleToggleEnable = async (scheduleId: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      if (response.ok) {
        setSchedules(prev =>
          prev.map(s => s.id === scheduleId ? { ...s, enabled } : s)
        );
      }
    } catch (error) {
      console.error('[Schedules] Failed to toggle:', error);
    }
  };

  // Handle schedule deletion
  const handleDeleted = () => {
    setSelectedScheduleId(null);
    fetchSchedules();
  };

  // Handle edit from detail modal
  const handleEdit = (schedule: Schedule) => {
    setSelectedScheduleId(null);
    setEditingSchedule(schedule);
  };

  // Handle save (create or update)
  const handleSaved = () => {
    setShowCreateModal(false);
    setEditingSchedule(null);
    fetchSchedules();
  };

  // Get recipes that don't already have a schedule
  const availableRecipesForCreate = availableRecipes.filter(
    recipe => !schedules.some(s => s.recipe_id === recipe.id)
  );

  const selectedSchedule = schedules.find(s => s.id === selectedScheduleId);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Schedules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage recurring work recipe executions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSchedules}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {availableRecipesForCreate.length > 0 && (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Schedule
            </Button>
          )}
        </div>
      </div>

      {/* Schedule List */}
      {schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium text-foreground">No schedules yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create recurring schedules to automatically run work recipes on a regular basis.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {availableRecipesForCreate.length > 0 ? (
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Schedule
              </Button>
            ) : (
              <Link href={`/projects/${projectId}/work-tickets/new`}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Configure from Recipe Gallery
                </Button>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onClick={() => setSelectedScheduleId(schedule.id)}
              onToggleEnable={(enabled) => handleToggleEnable(schedule.id, enabled)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <ScheduleDetailModal
        schedule={selectedSchedule || null}
        projectId={projectId}
        open={!!selectedScheduleId}
        onClose={() => setSelectedScheduleId(null)}
        onEdit={handleEdit}
        onDeleted={handleDeleted}
      />

      {/* Create/Edit Form Modal */}
      <ScheduleFormModal
        projectId={projectId}
        basketId={basketId}
        open={showCreateModal || !!editingSchedule}
        onClose={() => {
          setShowCreateModal(false);
          setEditingSchedule(null);
        }}
        onSaved={handleSaved}
        schedule={editingSchedule}
        availableRecipes={editingSchedule ? availableRecipes : availableRecipesForCreate}
      />
    </div>
  );
}

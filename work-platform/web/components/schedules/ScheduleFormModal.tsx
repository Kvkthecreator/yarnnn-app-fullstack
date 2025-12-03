"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Calendar } from 'lucide-react';

interface Schedule {
  id: string;
  recipe_id: string;
  recipe_name: string;
  frequency: string;
  day_of_week: number;
  time_of_day: string;
  recipe_parameters: Record<string, any>;
  enabled: boolean;
}

interface Recipe {
  id: string;
  name: string;
  slug: string;
  agent_type: string;
  context_outputs: any;
}

interface ScheduleFormModalProps {
  projectId: string;
  basketId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  schedule: Schedule | null; // null = create, object = edit
  availableRecipes: Recipe[];
}

const DAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

const TIME_OPTIONS = [
  { value: '06:00:00', label: '6:00 AM' },
  { value: '09:00:00', label: '9:00 AM' },
  { value: '12:00:00', label: '12:00 PM' },
  { value: '15:00:00', label: '3:00 PM' },
  { value: '18:00:00', label: '6:00 PM' },
  { value: '21:00:00', label: '9:00 PM' },
];

export default function ScheduleFormModal({
  projectId,
  basketId,
  open,
  onClose,
  onSaved,
  schedule,
  availableRecipes,
}: ScheduleFormModalProps) {
  const isEdit = !!schedule;

  // Form state
  const [recipeId, setRecipeId] = useState<string>('');
  const [frequency, setFrequency] = useState<string>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState<string>('1');
  const [timeOfDay, setTimeOfDay] = useState<string>('09:00:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form when editing
  useEffect(() => {
    if (schedule) {
      setRecipeId(schedule.recipe_id);
      setFrequency(schedule.frequency);
      setDayOfWeek(String(schedule.day_of_week));
      setTimeOfDay(schedule.time_of_day || '09:00:00');
    } else {
      // Reset for create
      setRecipeId('');
      setFrequency('weekly');
      setDayOfWeek('1');
      setTimeOfDay('09:00:00');
    }
    setError(null);
  }, [schedule, open]);

  const handleSubmit = async () => {
    if (!isEdit && !recipeId) {
      setError('Please select a recipe');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        recipe_id: recipeId,
        frequency,
        day_of_week: parseInt(dayOfWeek),
        time_of_day: timeOfDay,
        enabled: true,
      };

      const url = isEdit
        ? `/api/projects/${projectId}/schedules/${schedule.id}`
        : `/api/projects/${projectId}/schedules`;

      const response = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        onSaved();
      } else {
        const data = await response.json();
        setError(data.detail || 'Failed to save schedule');
      }
    } catch (err) {
      console.error('[ScheduleForm] Save error:', err);
      setError('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  // Get selected recipe for display
  const selectedRecipe = availableRecipes.find(r => r.id === recipeId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {isEdit ? 'Edit Schedule' : 'Create Schedule'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Recipe Selection (only for create) */}
          {!isEdit && (
            <div className="space-y-2">
              <Label>Recipe</Label>
              <Select value={recipeId} onValueChange={setRecipeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a recipe" />
                </SelectTrigger>
                <SelectContent>
                  {availableRecipes.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRecipe?.context_outputs?.role && (
                <p className="text-xs text-muted-foreground">
                  Produces: {selectedRecipe.context_outputs.role} context
                </p>
              )}
            </div>
          )}

          {/* Recipe name display (edit mode) */}
          {isEdit && (
            <div className="space-y-2">
              <Label>Recipe</Label>
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                {schedule.recipe_name}
              </div>
            </div>
          )}

          {/* Frequency */}
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Day of Week */}
          <div className="space-y-2">
            <Label>Day</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time of Day */}
          <div className="space-y-2">
            <Label>Time (UTC)</Label>
            <Select value={timeOfDay} onValueChange={setTimeOfDay}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || (!isEdit && !recipeId)}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : isEdit ? (
              'Save Changes'
            ) : (
              'Create Schedule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

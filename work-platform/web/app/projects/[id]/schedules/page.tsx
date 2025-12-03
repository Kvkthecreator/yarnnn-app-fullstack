/**
 * Schedules Page: /projects/[id]/schedules
 *
 * Lists all recurring schedules for this project.
 * Follows same pattern as work-tickets-view page.
 */

import { cookies } from "next/headers";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { getAuthenticatedUser } from "@/lib/auth/getAuthenticatedUser";
import SchedulesClient from "./SchedulesClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SchedulesPage({ params }: PageProps) {
  const { id: projectId } = await params;

  const supabase = createServerComponentClient({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);

  // Fetch project to get basket_id and verify access
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, basket_id, workspace_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground">Project not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The project you're looking for doesn't exist or you don't have access to it.
          </p>
        </div>
      </div>
    );
  }

  // Fetch schedules with recipe details
  const { data: schedules } = await supabase
    .from('project_schedules')
    .select(`
      id,
      project_id,
      recipe_id,
      frequency,
      day_of_week,
      time_of_day,
      recipe_parameters,
      enabled,
      next_run_at,
      last_run_at,
      last_run_status,
      run_count,
      created_at,
      work_recipes (
        id,
        name,
        slug,
        agent_type,
        context_outputs
      )
    `)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  // Transform for frontend
  const transformedSchedules = (schedules || []).map((s: any) => ({
    id: s.id,
    project_id: s.project_id,
    recipe_id: s.recipe_id,
    recipe_name: s.work_recipes?.name,
    recipe_slug: s.work_recipes?.slug,
    agent_type: s.work_recipes?.agent_type,
    context_outputs: s.work_recipes?.context_outputs,
    frequency: s.frequency,
    day_of_week: s.day_of_week,
    time_of_day: s.time_of_day,
    recipe_parameters: s.recipe_parameters,
    enabled: s.enabled,
    next_run_at: s.next_run_at,
    last_run_at: s.last_run_at,
    last_run_status: s.last_run_status,
    run_count: s.run_count,
    created_at: s.created_at,
  }));

  // Fetch available recipes for create modal
  const { data: recipes } = await supabase
    .from('work_recipes')
    .select('id, name, slug, agent_type, context_outputs')
    .eq('status', 'active')
    .order('name');

  return (
    <SchedulesClient
      projectId={projectId}
      basketId={project.basket_id}
      initialSchedules={transformedSchedules}
      availableRecipes={recipes || []}
    />
  );
}

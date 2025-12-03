/**
 * Recipe Configuration Page: /projects/[id]/work-tickets/new/configure?recipe={recipe_slug}
 *
 * Dedicated configuration page for selected work recipe.
 * Fetches recipe from database and collects parameters for execution.
 */

import { cookies } from "next/headers";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { getAuthenticatedUser } from "@/lib/auth/getAuthenticatedUser";
import { redirect } from "next/navigation";
import RecipeConfigureClient from "./RecipeConfigureClient";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recipe?: string }>;
}

export default async function RecipeConfigurePage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params;
  const { recipe: recipeSlug } = await searchParams;

  // Validate recipe parameter
  if (!recipeSlug) {
    redirect(`/projects/${projectId}/work-tickets/new`);
  }

  const supabase = createServerComponentClient({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);

  // Fetch project and basket
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

  // Fetch recipe from database by slug (include context fields and output_specification)
  const { data: recipeData, error: recipeError } = await supabase
    .from('work_recipes')
    .select('id, name, slug, description, agent_type, configurable_parameters, context_requirements, context_outputs, output_specification')
    .eq('slug', recipeSlug)
    .eq('status', 'active')
    .maybeSingle();

  if (recipeError || !recipeData) {
    console.error("Failed to fetch recipe:", recipeError);
    redirect(`/projects/${projectId}/work-tickets/new`);
  }

  // Fetch context anchors for this basket
  // Note: blocks use uppercase states (ACCEPTED, PROPOSED, SUPERSEDED)
  const { data: contextBlocks } = await supabase
    .from('blocks')
    .select('id, anchor_role, state, updated_at')
    .eq('basket_id', project.basket_id)
    .not('anchor_role', 'is', null)
    .eq('state', 'ACCEPTED');

  const contextAnchors = (contextBlocks || []).map(b => ({
    anchor_key: b.anchor_role,
    lifecycle: 'approved', // Map ACCEPTED -> approved for frontend
    updated_at: b.updated_at,
  }));

  // Transform database recipe to frontend format
  const recipeParams = recipeData.configurable_parameters || {};
  const outputSpec = recipeData.output_specification || {};

  // Map format to display badge
  const formatDisplayMap: Record<string, string> = {
    'pptx': 'PPTX',
    'markdown': 'MD',
    'text': 'TXT',
    'brand_guidelines': 'DOC',
    'competitive_analysis': 'DOC',
    'structured_analysis': 'DOC',
  };

  // Get format from output_specification.format (where it actually lives)
  const rawFormat = outputSpec.format || recipeParams.output_format?.default || 'text';
  const outputFormat = formatDisplayMap[rawFormat] || rawFormat.toUpperCase();

  // Transform parameters to add missing fields (label, required)
  const transformedParams: Record<string, any> = {};
  Object.entries(recipeParams).forEach(([key, param]: [string, any]) => {
    if (key === 'output_format') return; // Skip output_format, it's metadata

    transformedParams[key] = {
      type: param.type || 'text',
      label: param.description || key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
      required: !param.optional,
      placeholder: param.description,
      default: param.default,
      min: param.min,
      max: param.max,
      options: param.options,
    };
  });

  const recipe = {
    id: recipeData.slug,
    db_id: recipeData.id,
    name: recipeData.name,
    description: recipeData.description || `${recipeData.name} recipe`,
    agent_type: recipeData.agent_type,
    output_format: outputFormat,
    parameters: transformedParams,
    context_requirements: recipeData.context_requirements,
    context_outputs: recipeData.context_outputs,
  };

  // Fetch existing schedule for this project/recipe combo
  const { data: existingSchedule } = await supabase
    .from('project_schedules')
    .select('id, frequency, day_of_week, time_of_day, enabled, next_run_at, last_run_at')
    .eq('project_id', projectId)
    .eq('recipe_id', recipeData.id)
    .maybeSingle();

  // Fetch recent execution history for this recipe
  // Work tickets store recipe_slug in metadata.recipe_id or metadata.recipe_slug
  const { data: recentTickets } = await supabase
    .from('work_tickets')
    .select('id, status, created_at, completed_at, metadata')
    .eq('basket_id', project.basket_id)
    .or(`metadata->>recipe_id.eq.${recipeData.slug},metadata->>recipe_slug.eq.${recipeData.slug}`)
    .order('created_at', { ascending: false })
    .limit(5);

  const executionHistory = (recentTickets || []).map(ticket => ({
    id: ticket.id,
    status: ticket.status,
    created_at: ticket.created_at,
    completed_at: ticket.completed_at,
    source: ticket.metadata?.source || 'manual',
    schedule_id: ticket.metadata?.schedule_id,
  }));

  return (
    <RecipeConfigureClient
      projectId={projectId}
      basketId={project.basket_id}
      workspaceId={project.workspace_id}
      recipe={recipe}
      contextAnchors={contextAnchors}
      existingSchedule={existingSchedule}
      executionHistory={executionHistory}
    />
  );
}

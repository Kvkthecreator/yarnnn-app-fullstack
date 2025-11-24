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

  // Fetch recipe from database by slug
  const { data: recipeData, error: recipeError } = await supabase
    .from('work_recipes')
    .select('id, name, slug, description, agent_type, configurable_parameters')
    .eq('slug', recipeSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (recipeError || !recipeData) {
    console.error("Failed to fetch recipe:", recipeError);
    redirect(`/projects/${projectId}/work-tickets/new`);
  }

  // Transform database recipe to frontend format
  const params = recipeData.configurable_parameters || {};
  const outputFormat = params.output_format?.default || 'pptx';

  const recipe = {
    id: recipeData.slug,
    db_id: recipeData.id,
    name: recipeData.name,
    description: recipeData.description || `${recipeData.name} recipe`,
    agent_type: recipeData.agent_type,
    output_format: outputFormat,
    parameters: params,
  };

  return (
    <RecipeConfigureClient
      projectId={projectId}
      basketId={project.basket_id}
      workspaceId={project.workspace_id}
      recipe={recipe}
    />
  );
}

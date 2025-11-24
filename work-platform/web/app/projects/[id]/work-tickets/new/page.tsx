/**
 * Recipe Gallery Page: /projects/[id]/work-tickets/new
 *
 * Shows available work recipes as cards. User selects a recipe to configure.
 * Replaces legacy generic "Create Work Request" modal.
 */

import { cookies } from "next/headers";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { getAuthenticatedUser } from "@/lib/auth/getAuthenticatedUser";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, FileText, FileSpreadsheet, Presentation, Search, PenTool, BarChart3 } from 'lucide-react';
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

// Work recipe definitions (will be loaded from DB/API in future)
const WORK_RECIPES = [
  // Reporting Agent Recipes
  {
    id: "powerpoint-report",
    name: "PowerPoint Presentation",
    description: "Professional PPTX presentation with slides, charts, and visuals",
    agent_type: "reporting",
    output_format: "pptx",
    icon: Presentation,
    color: "blue",
    popular: true,
  },
  {
    id: "pdf-document",
    name: "PDF Document",
    description: "Formatted PDF report with structured sections and charts",
    agent_type: "reporting",
    output_format: "pdf",
    icon: FileText,
    color: "red",
    popular: true,
  },
  {
    id: "excel-dashboard",
    name: "Excel Dashboard",
    description: "Interactive XLSX spreadsheet with data tables and charts",
    agent_type: "reporting",
    output_format: "xlsx",
    icon: FileSpreadsheet,
    color: "green",
    popular: false,
  },
  {
    id: "markdown-report",
    name: "Text Report",
    description: "Markdown-formatted text report for quick analysis",
    agent_type: "reporting",
    output_format: "markdown",
    icon: FileText,
    color: "gray",
    popular: false,
  },

  // Research Agent Recipes
  {
    id: "competitive-analysis",
    name: "Competitive Analysis",
    description: "Deep-dive research on competitors with market intelligence",
    agent_type: "research",
    output_format: "markdown",
    icon: Search,
    color: "purple",
    popular: true,
  },
  {
    id: "market-research",
    name: "Market Research",
    description: "Comprehensive market analysis with trends and insights",
    agent_type: "research",
    output_format: "markdown",
    icon: BarChart3,
    color: "purple",
    popular: false,
  },

  // Content Agent Recipes
  {
    id: "linkedin-post",
    name: "LinkedIn Post",
    description: "Professional LinkedIn content optimized for engagement",
    agent_type: "content",
    output_format: "markdown",
    icon: PenTool,
    color: "indigo",
    popular: true,
  },
  {
    id: "blog-article",
    name: "Blog Article",
    description: "Long-form blog content with SEO optimization",
    agent_type: "content",
    output_format: "markdown",
    icon: PenTool,
    color: "indigo",
    popular: false,
  },
];

const COLOR_STYLES = {
  blue: "border-blue-500/20 bg-blue-500/5 hover:border-blue-500/40 hover:bg-blue-500/10",
  red: "border-red-500/20 bg-red-500/5 hover:border-red-500/40 hover:bg-red-500/10",
  green: "border-green-500/20 bg-green-500/5 hover:border-green-500/40 hover:bg-green-500/10",
  purple: "border-purple-500/20 bg-purple-500/5 hover:border-purple-500/40 hover:bg-purple-500/10",
  indigo: "border-indigo-500/20 bg-indigo-500/5 hover:border-indigo-500/40 hover:bg-indigo-500/10",
  gray: "border-border bg-card hover:border-ring hover:shadow-md",
} as const;

const ICON_STYLES = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  gray: "bg-muted text-muted-foreground",
} as const;

export default async function WorkRecipeGalleryPage({ params }: PageProps) {
  const { id: projectId } = await params;

  const supabase = createServerComponentClient({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);

  // Fetch project
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, basket_id')
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

  // Group recipes by agent type
  const recipesByAgentType = WORK_RECIPES.reduce((acc, recipe) => {
    if (!acc[recipe.agent_type]) {
      acc[recipe.agent_type] = [];
    }
    acc[recipe.agent_type].push(recipe);
    return acc;
  }, {} as Record<string, typeof WORK_RECIPES>);

  const popularRecipes = WORK_RECIPES.filter(r => r.popular);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href={`/projects/${projectId}/overview`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Project
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Create Work Ticket</h1>
        <p className="text-muted-foreground">
          Choose a work recipe to get started. Each recipe is pre-configured for specific deliverables.
        </p>
      </div>

      {/* Popular Recipes */}
      {popularRecipes.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">Popular Recipes</h2>
            <Badge variant="secondary" className="text-xs">Most Used</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {popularRecipes.map((recipe) => {
              const Icon = recipe.icon;
              return (
                <Link
                  key={recipe.id}
                  href={`/projects/${projectId}/work-tickets/new/configure?recipe=${recipe.id}`}
                >
                  <Card
                    className={cn(
                      "p-6 cursor-pointer transition-all duration-200 border-2",
                      COLOR_STYLES[recipe.color as keyof typeof COLOR_STYLES]
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "rounded-lg p-3 transition-colors",
                        ICON_STYLES[recipe.color as keyof typeof ICON_STYLES]
                      )}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground mb-1">{recipe.name}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">{recipe.description}</p>
                        <div className="flex items-center gap-2 mt-3">
                          <Badge variant="outline" className="text-xs capitalize">
                            {recipe.agent_type}
                          </Badge>
                          <Badge variant="secondary" className="text-xs uppercase">
                            {recipe.output_format}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* All Recipes by Agent Type */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">All Recipes</h2>

        {Object.entries(recipesByAgentType).map(([agentType, recipes]) => (
          <div key={agentType} className="space-y-3">
            <h3 className="text-lg font-medium text-foreground capitalize flex items-center gap-2">
              {agentType} Agent
              <Badge variant="secondary" className="text-xs">{recipes.length} recipes</Badge>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recipes.map((recipe) => {
                const Icon = recipe.icon;
                return (
                  <Link
                    key={recipe.id}
                    href={`/projects/${projectId}/work-tickets/new/configure?recipe=${recipe.id}`}
                  >
                    <Card className="p-4 cursor-pointer transition hover:border-ring hover:shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "rounded-lg p-2",
                          ICON_STYLES[recipe.color as keyof typeof ICON_STYLES]
                        )}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-foreground text-sm">{recipe.name}</h4>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {recipe.description}
                          </p>
                          <Badge variant="secondary" className="text-xs uppercase mt-2">
                            {recipe.output_format}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

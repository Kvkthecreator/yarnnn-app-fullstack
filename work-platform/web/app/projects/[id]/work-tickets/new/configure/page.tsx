/**
 * Recipe Configuration Page: /projects/[id]/work-tickets/new/configure?recipe={recipe_id}
 *
 * Dedicated configuration page for selected work recipe.
 * Collects all parameters needed for WorkBundle scaffolding, then executes via specialist endpoint.
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

// Recipe definitions (hardcoded for now, will move to DB later)
const RECIPE_DEFINITIONS = {
  // Reporting recipes
  "powerpoint-report": {
    id: "powerpoint-report",
    name: "PowerPoint Presentation",
    description: "Professional PPTX presentation with slides, charts, and visuals",
    agent_type: "reporting",
    output_format: "pptx",
    parameters: {
      topic: { type: "text", label: "Presentation Topic", required: true, placeholder: "e.g., Q4 Business Review" },
      slides_count: { type: "number", label: "Number of Slides", required: false, default: 5, min: 3, max: 20 },
      template_style: { type: "select", label: "Template Style", required: false, default: "professional", options: ["professional", "creative", "minimal"] },
    },
  },
  "pdf-document": {
    id: "pdf-document",
    name: "PDF Document",
    description: "Formatted PDF report with structured sections and charts",
    agent_type: "reporting",
    output_format: "pdf",
    parameters: {
      topic: { type: "text", label: "Document Title", required: true, placeholder: "e.g., Annual Report 2024" },
      sections: { type: "multitext", label: "Sections to Include", required: false, default: ["Executive Summary", "Analysis", "Recommendations"] },
    },
  },
  "excel-dashboard": {
    id: "excel-dashboard",
    name: "Excel Dashboard",
    description: "Interactive XLSX spreadsheet with data tables and charts",
    agent_type: "reporting",
    output_format: "xlsx",
    parameters: {
      topic: { type: "text", label: "Dashboard Title", required: true, placeholder: "e.g., Sales Performance Dashboard" },
      metrics: { type: "multitext", label: "Metrics to Track", required: false, default: ["Revenue", "Growth Rate", "Key KPIs"] },
    },
  },
  "markdown-report": {
    id: "markdown-report",
    name: "Text Report",
    description: "Markdown-formatted text report for quick analysis",
    agent_type: "reporting",
    output_format: "markdown",
    parameters: {
      topic: { type: "text", label: "Report Topic", required: true, placeholder: "e.g., Monthly Progress Update" },
    },
  },

  // Research recipes
  "competitive-analysis": {
    id: "competitive-analysis",
    name: "Competitive Analysis",
    description: "Deep-dive research on competitors with market intelligence",
    agent_type: "research",
    output_format: "markdown",
    parameters: {
      topic: { type: "text", label: "Research Focus", required: true, placeholder: "e.g., AI-powered CRM tools" },
      competitors: { type: "multitext", label: "Competitors to Analyze", required: false, default: [] },
      depth: { type: "select", label: "Research Depth", required: false, default: "detailed", options: ["overview", "detailed", "comprehensive"] },
    },
  },
  "market-research": {
    id: "market-research",
    name: "Market Research",
    description: "Comprehensive market analysis with trends and insights",
    agent_type: "research",
    output_format: "markdown",
    parameters: {
      topic: { type: "text", label: "Market to Research", required: true, placeholder: "e.g., Enterprise SaaS Market" },
      timeframe_days: { type: "number", label: "Timeframe (days)", required: false, default: 30, min: 7, max: 365 },
    },
  },

  // Content recipes
  "linkedin-post": {
    id: "linkedin-post",
    name: "LinkedIn Post",
    description: "Professional LinkedIn content optimized for engagement",
    agent_type: "content",
    output_format: "markdown",
    parameters: {
      topic: { type: "text", label: "Post Topic", required: true, placeholder: "e.g., Product Launch Announcement" },
      tone: { type: "select", label: "Tone", required: false, default: "professional", options: ["professional", "casual", "technical", "promotional"] },
      target_audience: { type: "text", label: "Target Audience", required: false, placeholder: "e.g., Enterprise CTOs" },
    },
  },
  "blog-article": {
    id: "blog-article",
    name: "Blog Article",
    description: "Long-form blog content with SEO optimization",
    agent_type: "content",
    output_format: "markdown",
    parameters: {
      topic: { type: "text", label: "Article Topic", required: true, placeholder: "e.g., The Future of AI in Business" },
      word_count: { type: "number", label: "Target Word Count", required: false, default: 1000, min: 500, max: 5000 },
      tone: { type: "select", label: "Tone", required: false, default: "professional", options: ["professional", "casual", "technical"] },
    },
  },
} as const;

export default async function RecipeConfigurePage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params;
  const { recipe: recipeId } = await searchParams;

  // Validate recipe parameter
  if (!recipeId || !(recipeId in RECIPE_DEFINITIONS)) {
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

  const recipe = RECIPE_DEFINITIONS[recipeId as keyof typeof RECIPE_DEFINITIONS];

  return (
    <RecipeConfigureClient
      projectId={projectId}
      basketId={project.basket_id}
      workspaceId={project.workspace_id}
      recipe={recipe}
    />
  );
}

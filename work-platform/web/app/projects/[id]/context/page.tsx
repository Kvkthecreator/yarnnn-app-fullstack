/**
 * Page: /projects/[id]/context - Project Context Blocks
 *
 * Displays substrate blocks (knowledge & meaning) available for this project.
 * Shows what context agents can query when executing work.
 *
 * Architecture:
 * - Work-platform READS context from substrate-api (via BFF)
 * - Edit requests are DELEGATED to substrate-api (not performed locally)
 * - This validates substrate integration for agent execution
 */

import { cookies } from "next/headers";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { getAuthenticatedUser } from "@/lib/auth/getAuthenticatedUser";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "lucide-react";
import ContextPageClient from "./ContextPageClient";
import AddContextButton from "./AddContextButton";
import ContextInfoPopover from "./ContextInfoPopover";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectContextPage({ params }: PageProps) {
  const { id: projectId } = await params;

  const supabase = createServerComponentClient({ cookies });
  const { userId } = await getAuthenticatedUser(supabase);

  // Fetch project directly from Supabase (same pattern as overview page)
  const { data: project, error: dbError } = await supabase
    .from('projects')
    .select('id, name, description, basket_id, workspace_id, user_id, created_at')
    .eq('id', projectId)
    .maybeSingle();

  if (dbError || !project) {
    console.error('[Project Context] Database error:', dbError);
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground">Project not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The project you're looking for doesn't exist or you don't have access to it.
          </p>
          <Link href="/projects" className="mt-4 inline-block">
            <Button variant="outline">Back to Projects</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Check if project has a basket
  if (!project.basket_id) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground">No Context Available</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This project doesn't have a substrate basket yet. Create one to start adding context blocks.
          </p>
          <Link href={`/projects/${projectId}`} className="mt-4 inline-block">
            <Button variant="outline">Back to Project</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/projects/${projectId}`}
            className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Project
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-foreground">Context</h1>
            <ContextInfoPopover />
          </div>
          <p className="text-muted-foreground mt-1">{project.name}</p>
        </div>
        <AddContextButton projectId={projectId} basketId={project.basket_id} />
      </div>

      {/* Context Blocks Client Component */}
      <ContextPageClient projectId={projectId} basketId={project.basket_id} />
    </div>
  );
}

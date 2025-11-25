import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerWorkspace } from "@/lib/workspaces/getServerWorkspace";
import { createServerComponentClient } from "@/lib/supabase/clients";
import { cookies } from "next/headers";
import { ProjectNavigation } from "@/components/projects/ProjectNavigation";

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  const ws = await getServerWorkspace();
  const supabase = createServerComponentClient({ cookies });

  // Fetch project to ensure it exists and user has access
  const { data: project } = await supabase
    .from('projects')
    .select('id, workspace_id')
    .eq('id', id)
    .eq('workspace_id', ws.id)
    .maybeSingle();

  if (!project) {
    redirect('/projects');
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProjectNavigation projectId={id} />
      <div className="mx-auto">{children}</div>
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@/lib/supabase/clients";
import { ensureWorkspaceServer } from "@/lib/workspaces/ensureWorkspaceServer";

export const dynamic = 'force-dynamic';

const DEFAULT_SETTINGS = {
  review_strategy: 'auto' as const, // auto-approve by default
};

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await ensureWorkspaceServer(supabase);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace access required" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('workspace_work_supervision_settings')
      .select('*')
      .eq('workspace_id', workspace.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: "Failed to fetch work supervision settings" }, { status: 500 });
    }

    const settings = data ? { review_strategy: data.review_strategy } : DEFAULT_SETTINGS;

    return NextResponse.json({
      workspace_id: workspace.id,
      settings,
      source: data ? 'workspace_database' : 'defaults',
    });
  } catch (error) {
    console.error('[Work Supervision] GET error', error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await ensureWorkspaceServer(supabase);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace access required" }, { status: 401 });
    }

    // Owner/admin only
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_memberships')
      .select('role')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: "Admin access required to modify work supervision settings" }, { status: 403 });
    }

    const body = await req.json();
    const review_strategy = body.review_strategy === 'manual' ? 'manual' : 'auto';

    const { error: upsertError } = await supabase
      .from('workspace_work_supervision_settings')
      .upsert(
        {
          workspace_id: workspace.id,
          review_strategy,
        },
        { onConflict: 'workspace_id' }
      );

    if (upsertError) {
      return NextResponse.json({ error: "Failed to update work supervision settings" }, { status: 500 });
    }

    return NextResponse.json({
      workspace_id: workspace.id,
      settings: { review_strategy },
      message: 'Work supervision settings updated',
    });
  } catch (error) {
    console.error('[Work Supervision] PUT error', error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

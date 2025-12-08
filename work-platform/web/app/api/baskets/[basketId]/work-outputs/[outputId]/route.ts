/**
 * API Route: GET /api/baskets/[basketId]/work-outputs/[outputId]
 *
 * Fetches a single work output by ID.
 * Used for realtime updates when partial data is received via subscription.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';
import { ensureWorkspaceServer } from '@/lib/workspaces/ensureWorkspaceServer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string; outputId: string }> }
) {
  try {
    const { basketId, outputId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Ensure workspace access
    const workspace = await ensureWorkspaceServer(supabase);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace access required' }, { status: 403 });
    }

    // Verify basket belongs to workspace
    const { data: basket, error: basketError } = await supabase
      .from('baskets')
      .select('id, workspace_id')
      .eq('id', basketId)
      .single();

    if (basketError || !basket || basket.workspace_id !== workspace.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fetch the specific work output
    const { data: output, error: outputError } = await supabase
      .from('work_outputs')
      .select('*')
      .eq('id', outputId)
      .eq('basket_id', basketId)
      .single();

    if (outputError || !output) {
      return NextResponse.json({ error: 'Work output not found' }, { status: 404 });
    }

    return NextResponse.json(output);

  } catch (error) {
    console.error('[Work Output API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch work output' },
      { status: 500 }
    );
  }
}

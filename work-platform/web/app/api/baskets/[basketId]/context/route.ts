/**
 * API Route: GET /api/baskets/[basketId]/context
 *
 * Fetches context items for a basket.
 * Used by ThinkingAgentClient to populate ContextDetailPanel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';
import { ensureWorkspaceServer } from '@/lib/workspaces/ensureWorkspaceServer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string }> }
) {
  try {
    const { basketId } = await params;
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

    // Query context items
    const { data: items, error: itemsError } = await supabase
      .from('context_items')
      .select('*')
      .eq('basket_id', basketId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (itemsError) {
      console.error('[Context API] Error fetching items:', itemsError);
      return NextResponse.json({ error: 'Failed to fetch context items' }, { status: 500 });
    }

    return NextResponse.json({
      items: items || [],
      count: items?.length || 0,
    });

  } catch (error) {
    console.error('[Context API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch context items' },
      { status: 500 }
    );
  }
}

/**
 * API Route: GET /api/baskets/[basketId]/context/[itemId]
 *
 * Fetches a single context item by ID.
 * Used for realtime updates when partial data is received via subscription.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';
import { ensureWorkspaceServer } from '@/lib/workspaces/ensureWorkspaceServer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string; itemId: string }> }
) {
  try {
    const { basketId, itemId } = await params;
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

    // Fetch the specific context item
    const { data: item, error: itemError } = await supabase
      .from('context_items')
      .select('*')
      .eq('id', itemId)
      .eq('basket_id', basketId)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Context item not found' }, { status: 404 });
    }

    return NextResponse.json(item);

  } catch (error) {
    console.error('[Context Item API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch context item' },
      { status: 500 }
    );
  }
}

/**
 * API Route: GET /api/baskets/[basketId]/work-tickets/[ticketId]
 *
 * Fetches a single work ticket by ID.
 * Used for realtime updates when partial data is received via subscription.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';
import { ensureWorkspaceServer } from '@/lib/workspaces/ensureWorkspaceServer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string; ticketId: string }> }
) {
  try {
    const { basketId, ticketId } = await params;
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

    // Fetch the specific work ticket
    const { data: ticket, error: ticketError } = await supabase
      .from('work_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('basket_id', basketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: 'Work ticket not found' }, { status: 404 });
    }

    return NextResponse.json(ticket);

  } catch (error) {
    console.error('[Work Ticket API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch work ticket' },
      { status: 500 }
    );
  }
}

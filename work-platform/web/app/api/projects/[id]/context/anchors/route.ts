import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';
import { listAnchorsWithStatus } from '@/lib/anchors/registry';

/**
 * GET /api/projects/[id]/context/anchors
 *
 * Fetches anchor status for a project's basket.
 * Uses the existing anchor registry infrastructure.
 *
 * Returns:
 * - anchors: Array of AnchorStatusSummary
 * - stats: Anchor counts by lifecycle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[ANCHORS API] Request for project ${projectId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      console.error('[ANCHORS API] Auth error:', authError, 'Session:', session);
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    console.log('[ANCHORS API] Auth successful, user:', session.user.id);

    // Fetch project to get basket_id
    const projectResponse = await supabase
      .from('projects')
      .select('id, basket_id, name')
      .eq('id', projectId)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      return NextResponse.json(
        { detail: 'Project not found' },
        { status: 404 }
      );
    }

    const { basket_id: basketId } = projectResponse.data;

    if (!basketId) {
      console.error('[ANCHORS API] No basket_id for project:', projectId);
      return NextResponse.json(
        { detail: 'Project has no associated basket' },
        { status: 400 }
      );
    }

    console.log(`[ANCHORS API] Fetching anchors for basket ${basketId}`);

    // Use the existing anchor registry to get anchor status
    const anchors = await listAnchorsWithStatus(supabase, basketId);

    console.log(`[ANCHORS API] Found ${anchors.length} anchors for basket ${basketId}`);

    // Calculate stats
    const stats = {
      total: anchors.length,
      approved: anchors.filter(a => a.lifecycle === 'approved').length,
      draft: anchors.filter(a => a.lifecycle === 'draft').length,
      stale: anchors.filter(a => a.lifecycle === 'stale').length,
      missing: anchors.filter(a => a.lifecycle === 'missing').length,
    };

    return NextResponse.json({
      anchors,
      stats,
      basket_id: basketId,
    });

  } catch (error) {
    console.error('[ANCHORS API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

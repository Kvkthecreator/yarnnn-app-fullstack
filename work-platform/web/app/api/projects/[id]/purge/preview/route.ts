import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

/**
 * GET /api/projects/[id]/purge/preview
 *
 * Preview basket purge counts before execution.
 * Queries database directly for blocks, raw_dumps, and assets counts.
 *
 * Returns:
 * - blocks: number (active blocks count, excluding REJECTED/SUPERSEDED)
 * - dumps: number (raw dumps count)
 * - assets: number (reference assets count)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[PURGE PREVIEW API] Request for project ${projectId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      console.error('[PURGE PREVIEW API] Auth error:', authError);
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch project to get basket_id
    const projectResponse = await supabase
      .from('projects')
      .select('id, basket_id, user_id')
      .eq('id', projectId)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      return NextResponse.json(
        { detail: 'Project not found' },
        { status: 404 }
      );
    }

    const { basket_id: basketId, user_id: projectOwnerId } = projectResponse.data;

    // Verify ownership
    if (projectOwnerId !== session.user.id) {
      console.warn('[PURGE PREVIEW API] Access denied:', {
        userId: session.user.id,
        projectOwnerId,
      });
      return NextResponse.json(
        { detail: 'Access denied' },
        { status: 403 }
      );
    }

    if (!basketId) {
      return NextResponse.json(
        { detail: 'Project has no associated basket' },
        { status: 400 }
      );
    }

    console.log(`[PURGE PREVIEW API] Fetching preview for basket ${basketId}`);

    // Query database directly (work-platform shares DB with substrate-api)
    // Count active blocks (only PROPOSED, ACCEPTED, LOCKED, CONSTANT states)
    const { count: blocksCount, error: blocksError } = await supabase
      .from('blocks')
      .select('*', { count: 'exact', head: true })
      .eq('basket_id', basketId)
      .in('state', ['PROPOSED', 'ACCEPTED', 'LOCKED', 'CONSTANT']);

    if (blocksError) {
      console.error('[PURGE PREVIEW API] Database error counting blocks:', blocksError);
      return NextResponse.json(
        { detail: 'Failed to count blocks', error: blocksError.message },
        { status: 500 }
      );
    }

    // Count raw dumps
    const { count: dumpsCount, error: dumpsError } = await supabase
      .from('raw_dumps')
      .select('*', { count: 'exact', head: true })
      .eq('basket_id', basketId);

    if (dumpsError) {
      console.error('[PURGE PREVIEW API] Database error counting dumps:', dumpsError);
      return NextResponse.json(
        { detail: 'Failed to count dumps', error: dumpsError.message },
        { status: 500 }
      );
    }

    // Count reference assets
    const { count: assetsCount, error: assetsError } = await supabase
      .from('reference_assets')
      .select('*', { count: 'exact', head: true })
      .eq('basket_id', basketId);

    if (assetsError) {
      console.error('[PURGE PREVIEW API] Database error counting assets:', assetsError);
      return NextResponse.json(
        { detail: 'Failed to count assets', error: assetsError.message },
        { status: 500 }
      );
    }

    // Count schedules
    const { count: schedulesCount, error: schedulesError } = await supabase
      .from('project_schedules')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (schedulesError) {
      console.error('[PURGE PREVIEW API] Database error counting schedules:', schedulesError);
      // Don't fail - schedules table might not exist yet
    }

    const result = {
      blocks: blocksCount || 0,
      dumps: dumpsCount || 0,
      assets: assetsCount || 0,
      schedules: schedulesCount || 0,
    };

    console.log(`[PURGE PREVIEW API] Preview result for basket ${basketId}:`, result);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[PURGE PREVIEW API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

/**
 * POST /api/projects/[id]/purge
 *
 * Execute basket purge operation (archive blocks, redact dumps, delete assets).
 * Implements purge directly using database operations (BFF pattern).
 *
 * Request Body:
 * - mode: 'archive_all' | 'redact_dumps'
 * - confirmation_text: string (must match project name)
 *
 * Returns:
 * - success: boolean
 * - total_operations: number
 * - totals: { archivedBlocks, redactedDumps, deletedAssets }
 * - message: string
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[PURGE API] Request for project ${projectId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      console.error('[PURGE API] Auth error:', authError);
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { mode, confirmation_text } = body;

    if (!mode || !confirmation_text) {
      return NextResponse.json(
        { detail: 'mode and confirmation_text are required' },
        { status: 400 }
      );
    }

    if (!['archive_all', 'redact_dumps'].includes(mode)) {
      return NextResponse.json(
        { detail: 'Invalid mode. Must be "archive_all" or "redact_dumps"' },
        { status: 400 }
      );
    }

    // Fetch project to get basket_id and verify ownership
    const projectResponse = await supabase
      .from('projects')
      .select('id, name, basket_id, user_id')
      .eq('id', projectId)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      return NextResponse.json(
        { detail: 'Project not found' },
        { status: 404 }
      );
    }

    const {
      name: projectName,
      basket_id: basketId,
      user_id: projectOwnerId,
    } = projectResponse.data;

    // Verify ownership
    if (projectOwnerId !== session.user.id) {
      console.warn('[PURGE API] Access denied:', {
        userId: session.user.id,
        projectOwnerId,
      });
      return NextResponse.json(
        { detail: 'Access denied' },
        { status: 403 }
      );
    }

    // Verify confirmation text matches project name
    if (confirmation_text !== projectName) {
      return NextResponse.json(
        { detail: 'Confirmation text does not match project name' },
        { status: 400 }
      );
    }

    if (!basketId) {
      return NextResponse.json(
        { detail: 'Project has no associated basket' },
        { status: 400 }
      );
    }

    console.log(`[PURGE API] Executing ${mode} purge for basket ${basketId}`);

    // Execute purge operations directly (BFF pattern)
    let archivedBlocks = 0;
    let redactedDumps = 0;
    let deletedAssets = 0;
    let deletedSchedules = 0;
    let cancelledJobs = 0;

    if (mode === 'archive_all') {
      // Delete all schedules for this project
      console.log('[PURGE API] Deleting schedules...');
      const { data: schedulesToDelete } = await supabase
        .from('project_schedules')
        .select('id')
        .eq('project_id', projectId);

      const scheduleIds = schedulesToDelete?.map(s => s.id) || [];

      if (scheduleIds.length > 0) {
        // Cancel any pending jobs for these schedules
        const { data: cancelledJobsData } = await supabase
          .from('jobs')
          .update({ status: 'cancelled' })
          .in('parent_schedule_id', scheduleIds)
          .in('status', ['pending', 'claimed'])
          .select('id');

        cancelledJobs = cancelledJobsData?.length || 0;

        // Delete the schedules
        await supabase
          .from('project_schedules')
          .delete()
          .eq('project_id', projectId);

        deletedSchedules = scheduleIds.length;
      }

      console.log(`[PURGE API] Deleted ${deletedSchedules} schedules, cancelled ${cancelledJobs} jobs`);

      // Mark all active blocks as SUPERSEDED (soft delete)
      // Valid block states: PROPOSED, ACCEPTED, LOCKED, CONSTANT, SUPERSEDED, REJECTED
      console.log('[PURGE API] Marking blocks as SUPERSEDED...');
      const { data: updatedBlocks, error: archiveError } = await supabase
        .from('blocks')
        .update({ state: 'SUPERSEDED' })
        .eq('basket_id', basketId)
        .in('state', ['PROPOSED', 'ACCEPTED', 'LOCKED', 'CONSTANT'])
        .select('id');

      if (archiveError) {
        console.error('[PURGE API] Error archiving blocks:', archiveError);
        return NextResponse.json(
          { detail: 'Failed to archive blocks', error: archiveError.message },
          { status: 500 }
        );
      }

      archivedBlocks = updatedBlocks?.length || 0;
      console.log(`[PURGE API] Marked ${archivedBlocks} blocks as SUPERSEDED`);
    }

    if (mode === 'archive_all' || mode === 'redact_dumps') {
      // Delete all raw dumps
      console.log('[PURGE API] Redacting dumps...');

      // First count the dumps to delete
      const { data: dumpsToDelete, error: countError } = await supabase
        .from('raw_dumps')
        .select('id')
        .eq('basket_id', basketId);

      if (countError) {
        console.error('[PURGE API] Error counting dumps:', countError);
      }

      const dumpCount = dumpsToDelete?.length || 0;
      const dumpIds = dumpsToDelete?.map(d => d.id) || [];

      if (dumpCount > 0) {
        // First delete agent_processing_queue entries that reference these dumps
        // (foreign key constraint: agent_processing_queue.dump_id -> raw_dumps.id)
        console.log('[PURGE API] Clearing processing queue for dumps...');
        const { error: queueDeleteError } = await supabase
          .from('agent_processing_queue')
          .delete()
          .in('dump_id', dumpIds);

        if (queueDeleteError) {
          console.error('[PURGE API] Error clearing processing queue:', queueDeleteError);
          // Continue anyway - queue entries may not exist
        }

        // Now delete the dumps
        const { error: deleteError } = await supabase
          .from('raw_dumps')
          .delete()
          .eq('basket_id', basketId);

        if (deleteError) {
          console.error('[PURGE API] Error redacting dumps:', deleteError);
          return NextResponse.json(
            { detail: 'Failed to redact dumps', error: deleteError.message },
            { status: 500 }
          );
        }
      }

      redactedDumps = dumpCount;
      console.log(`[PURGE API] Redacted ${redactedDumps} dumps`);

      // Delete all reference assets
      console.log('[PURGE API] Deleting assets...');

      const { data: assetsToDelete, error: assetsCountError } = await supabase
        .from('reference_assets')
        .select('id')
        .eq('basket_id', basketId);

      if (assetsCountError) {
        console.error('[PURGE API] Error counting assets:', assetsCountError);
      }

      const assetCount = assetsToDelete?.length || 0;

      if (assetCount > 0) {
        const { error: assetsDeleteError } = await supabase
          .from('reference_assets')
          .delete()
          .eq('basket_id', basketId);

        if (assetsDeleteError) {
          console.error('[PURGE API] Error deleting assets:', assetsDeleteError);
          return NextResponse.json(
            { detail: 'Failed to delete assets', error: assetsDeleteError.message },
            { status: 500 }
          );
        }
      }

      deletedAssets = assetCount;
      console.log(`[PURGE API] Deleted ${deletedAssets} assets`);
    }

    const totalOperations = archivedBlocks + redactedDumps + deletedAssets + deletedSchedules;
    console.log(`[PURGE API] Success: ${totalOperations} total operations`);

    // User-friendly message
    const messageParts: string[] = [];
    if (archivedBlocks > 0) messageParts.push(`archived ${archivedBlocks} blocks`);
    if (redactedDumps > 0) messageParts.push(`redacted ${redactedDumps} dumps`);
    if (deletedAssets > 0) messageParts.push(`deleted ${deletedAssets} assets`);
    if (deletedSchedules > 0) messageParts.push(`deleted ${deletedSchedules} schedules`);

    const message = messageParts.length > 0
      ? `Successfully ${messageParts.join(', ')}`
      : 'No data to purge';

    return NextResponse.json({
      success: true,
      total_operations: totalOperations,
      totals: {
        archivedBlocks,
        redactedDumps,
        deletedAssets,
        deletedSchedules,
        cancelledJobs,
      },
      message,
    });
  } catch (error) {
    console.error('[PURGE API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

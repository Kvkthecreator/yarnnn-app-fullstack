import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * Helper to get project and basket context with auth
 */
async function getProjectContext(projectId: string, supabase: any, session: any) {
  // Fetch project to verify access and get basket_id
  const projectResponse = await supabase
    .from('projects')
    .select('id, basket_id, name')
    .eq('id', projectId)
    .single();

  if (projectResponse.error || !projectResponse.data) {
    return { error: { detail: 'Project not found', status: 404 } };
  }

  const { basket_id: basketId } = projectResponse.data;

  if (!basketId) {
    return { error: { detail: 'Project has no associated basket', status: 400 } };
  }

  return { basketId, token: session.access_token };
}

/**
 * GET /api/projects/[id]/context/[blockId]
 *
 * Fetches a single substrate block's details for display in the modal.
 * This is a BFF route that queries the database directly.
 *
 * Returns:
 * - Block details with all metadata
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> }
) {
  try {
    const { id: projectId, blockId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[CONTEXT BLOCK API] GET request for project ${projectId}, block ${blockId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      console.error('[CONTEXT BLOCK API] Auth error:', authError);
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    const context = await getProjectContext(projectId, supabase, session);
    if (context.error) {
      return NextResponse.json(
        { detail: context.error.detail },
        { status: context.error.status }
      );
    }

    const { basketId } = context;

    console.log(`[CONTEXT BLOCK API] Fetching block ${blockId} for basket ${basketId}`);

    // Query single block from database
    const { data: blockData, error: blockError } = await supabase
      .from('blocks')
      .select('*')
      .eq('id', blockId)
      .eq('basket_id', basketId)
      .single();

    if (blockError || !blockData) {
      console.error('[CONTEXT BLOCK API] Block not found:', blockError);
      return NextResponse.json(
        { detail: 'Block not found or access denied' },
        { status: 404 }
      );
    }

    console.log(`[CONTEXT BLOCK API] Found block ${blockId}`);

    return NextResponse.json(blockData);

  } catch (error) {
    console.error('[CONTEXT BLOCK API] GET Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/projects/[id]/context/[blockId]
 *
 * Updates a user-authored block directly (no governance).
 * Only ACCEPTED or PROPOSED blocks can be modified.
 * LOCKED blocks require explicit unlock first.
 *
 * Payload (JSON):
 * - title?: string
 * - content?: string
 * - semantic_type?: string
 * - metadata?: object
 *
 * Returns:
 * - Updated block
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> }
) {
  try {
    const { id: projectId, blockId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[CONTEXT BLOCK API] PUT request for project ${projectId}, block ${blockId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    const context = await getProjectContext(projectId, supabase, session);
    if (context.error) {
      return NextResponse.json(
        { detail: context.error.detail },
        { status: context.error.status }
      );
    }

    const { basketId, token } = context;

    // Parse request body
    const body = await request.json();
    const { title, content, semantic_type, metadata } = body;

    // At least one field must be provided
    if (!title && !content && !semantic_type && !metadata) {
      return NextResponse.json(
        { detail: 'At least one field must be provided to update' },
        { status: 400 }
      );
    }

    console.log(`[CONTEXT BLOCK API] Updating block ${blockId} in basket ${basketId}`);

    // Forward to substrate-api
    const substrateUrl = `${SUBSTRATE_API_URL}/api/baskets/${basketId}/blocks/${blockId}`;

    const updatePayload: Record<string, any> = {};
    if (title !== undefined) updatePayload.title = title.trim();
    if (content !== undefined) updatePayload.content = content.trim();
    if (semantic_type !== undefined) updatePayload.semantic_type = semantic_type.trim();
    if (metadata !== undefined) updatePayload.metadata = metadata;

    const substrateResponse = await fetch(substrateUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });

    if (!substrateResponse.ok) {
      const errorData = await substrateResponse.json().catch(() => ({
        detail: 'Failed to update block'
      }));
      console.error('[CONTEXT BLOCK API] Substrate error:', substrateResponse.status, errorData);
      return NextResponse.json(errorData, { status: substrateResponse.status });
    }

    const result = await substrateResponse.json();
    console.log(`[CONTEXT BLOCK API] Block updated: ${blockId}`);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[CONTEXT BLOCK API] PUT Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id]/context/[blockId]
 *
 * Soft-deletes a block by setting state to SUPERSEDED.
 * LOCKED blocks cannot be deleted.
 *
 * Returns:
 * - Deletion confirmation with previous state
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> }
) {
  try {
    const { id: projectId, blockId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[CONTEXT BLOCK API] DELETE request for project ${projectId}, block ${blockId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    const context = await getProjectContext(projectId, supabase, session);
    if (context.error) {
      return NextResponse.json(
        { detail: context.error.detail },
        { status: context.error.status }
      );
    }

    const { basketId, token } = context;

    console.log(`[CONTEXT BLOCK API] Deleting block ${blockId} in basket ${basketId}`);

    // Forward to substrate-api
    const substrateUrl = `${SUBSTRATE_API_URL}/api/baskets/${basketId}/blocks/${blockId}`;

    const substrateResponse = await fetch(substrateUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!substrateResponse.ok) {
      const errorData = await substrateResponse.json().catch(() => ({
        detail: 'Failed to delete block'
      }));
      console.error('[CONTEXT BLOCK API] Substrate error:', substrateResponse.status, errorData);
      return NextResponse.json(errorData, { status: substrateResponse.status });
    }

    const result = await substrateResponse.json();
    console.log(`[CONTEXT BLOCK API] Block deleted: ${blockId}`);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[CONTEXT BLOCK API] DELETE Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

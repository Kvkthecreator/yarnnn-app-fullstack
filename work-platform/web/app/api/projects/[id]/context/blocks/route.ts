import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * POST /api/projects/[id]/context/blocks
 *
 * Creates a new user-authored block directly (no governance).
 * User-provided blocks are trusted and created in ACCEPTED state.
 *
 * This is a BFF route that delegates to substrate-api.
 *
 * Payload (JSON):
 * - title: string (required)
 * - content: string (required)
 * - semantic_type: string (required, e.g., "fact", "intent", "metric")
 * - anchor_role?: string (optional, for foundational blocks)
 * - metadata?: object (optional)
 *
 * Returns:
 * - Created block with id, state, etc.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const supabase = createRouteHandlerClient({ cookies });

    console.log(`[BLOCK CREATE API] Request for project ${projectId}`);

    // Get Supabase session for auth
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      console.error('[BLOCK CREATE API] Auth error:', authError);
      return NextResponse.json(
        { detail: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = session.access_token;

    // Parse request body
    const body = await request.json();
    const { title, content, semantic_type, anchor_role, metadata } = body;

    // Validate required fields
    if (!title?.trim()) {
      return NextResponse.json(
        { detail: 'Title is required' },
        { status: 400 }
      );
    }

    if (!content?.trim()) {
      return NextResponse.json(
        { detail: 'Content is required' },
        { status: 400 }
      );
    }

    if (!semantic_type?.trim()) {
      return NextResponse.json(
        { detail: 'Semantic type is required' },
        { status: 400 }
      );
    }

    // Fetch project to get basket_id and workspace_id
    const projectResponse = await supabase
      .from('projects')
      .select('id, basket_id, workspace_id, name')
      .eq('id', projectId)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      return NextResponse.json(
        { detail: 'Project not found' },
        { status: 404 }
      );
    }

    const { basket_id: basketId, workspace_id: workspaceId } = projectResponse.data;

    if (!basketId) {
      return NextResponse.json(
        { detail: 'Project has no associated basket' },
        { status: 400 }
      );
    }

    console.log(`[BLOCK CREATE API] Creating block in basket ${basketId}`);

    // Forward to substrate-api
    const substrateUrl = `${SUBSTRATE_API_URL}/api/baskets/${basketId}/blocks`;

    const substrateResponse = await fetch(substrateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.trim(),
        content: content.trim(),
        semantic_type: semantic_type.trim(),
        workspace_id: workspaceId,
        anchor_role: anchor_role?.trim() || null,
        metadata: metadata || {},
      }),
    });

    if (!substrateResponse.ok) {
      const errorData = await substrateResponse.json().catch(() => ({
        detail: 'Failed to create block'
      }));
      console.error('[BLOCK CREATE API] Substrate error:', substrateResponse.status, errorData);
      return NextResponse.json(errorData, { status: substrateResponse.status });
    }

    const result = await substrateResponse.json();
    console.log(`[BLOCK CREATE API] Block created: ${result.id}`);

    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('[BLOCK CREATE API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

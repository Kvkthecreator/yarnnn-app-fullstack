import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * GET /api/projects/[id]/context/templates/[slug]
 *
 * Fetches a specific template schema and its current values if filled.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> }
) {
  try {
    const { id: projectId, slug } = await params;
    const supabase = createRouteHandlerClient({ cookies });

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

    // Fetch project to get basket_id
    const projectResponse = await supabase
      .from('projects')
      .select('id, basket_id')
      .eq('id', projectId)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      return NextResponse.json(
        { detail: 'Project not found' },
        { status: 404 }
      );
    }

    const { basket_id: basketId } = projectResponse.data;

    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from('context_template_catalog')
      .select('*')
      .eq('slug', slug)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { detail: `Template not found: ${slug}` },
        { status: 404 }
      );
    }

    // Check if already filled
    const { data: existingBlock } = await supabase
      .from('blocks')
      .select('id, title, content, created_at, updated_at')
      .eq('basket_id', basketId)
      .eq('metadata->>template_id', slug)
      .single();

    let currentValues = null;
    if (existingBlock) {
      try {
        currentValues = JSON.parse(existingBlock.content);
      } catch {
        currentValues = null;
      }
    }

    return NextResponse.json({
      template: {
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        category: template.category,
        schema: template.schema,
        is_required: template.is_required,
        icon: template.icon,
      },
      is_filled: !!existingBlock,
      block_id: existingBlock?.id || null,
      current_values: currentValues,
      filled_at: existingBlock?.updated_at || existingBlock?.created_at || null,
    });

  } catch (error) {
    console.error('[TEMPLATE API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[id]/context/templates/[slug]
 *
 * Fills a template, creating or updating a foundational block.
 *
 * Body:
 * - values: Object with key-value pairs matching template fields
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> }
) {
  try {
    const { id: projectId, slug } = await params;
    const supabase = createRouteHandlerClient({ cookies });

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

    const token = session.access_token;
    const body = await request.json();
    const { values } = body;

    if (!values || typeof values !== 'object') {
      return NextResponse.json(
        { detail: 'values object is required' },
        { status: 400 }
      );
    }

    // Fetch project to get basket_id
    const projectResponse = await supabase
      .from('projects')
      .select('id, basket_id')
      .eq('id', projectId)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      return NextResponse.json(
        { detail: 'Project not found' },
        { status: 404 }
      );
    }

    const { basket_id: basketId } = projectResponse.data;

    // Forward to substrate-api
    const substrateResponse = await fetch(
      `${SUBSTRATE_API_URL}/api/templates/baskets/${basketId}/fill/${slug}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );

    if (!substrateResponse.ok) {
      const errorData = await substrateResponse.json().catch(() => ({
        detail: 'Failed to fill template'
      }));
      console.error('[TEMPLATE API] Substrate error:', substrateResponse.status, errorData);
      return NextResponse.json(errorData, { status: substrateResponse.status });
    }

    const result = await substrateResponse.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('[TEMPLATE API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

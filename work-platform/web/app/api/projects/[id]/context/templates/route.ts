import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * GET /api/projects/[id]/context/templates
 *
 * Fetches context templates and their fill status for a project's basket.
 * Combines template catalog with basket-specific status.
 *
 * Returns:
 * - templates: Array of available templates with fill status
 * - status: Overall completion status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
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
      return NextResponse.json(
        { detail: 'Project has no associated basket' },
        { status: 400 }
      );
    }

    // Fetch template catalog
    const { data: templates, error: templatesError } = await supabase
      .from('context_template_catalog')
      .select('*')
      .order('display_order');

    if (templatesError) {
      console.error('[TEMPLATES API] Error fetching templates:', templatesError);
      return NextResponse.json(
        { detail: 'Failed to fetch templates' },
        { status: 500 }
      );
    }

    // Fetch existing filled templates for this basket
    const { data: filledBlocks, error: blocksError } = await supabase
      .from('blocks')
      .select('id, title, content, metadata, created_at, updated_at')
      .eq('basket_id', basketId)
      .not('metadata->template_id', 'is', null);

    if (blocksError) {
      console.error('[TEMPLATES API] Error fetching filled blocks:', blocksError);
    }

    // Build template status map
    const filledMap = new Map<string, { block_id: string; filled_at: string }>();
    for (const block of filledBlocks || []) {
      const templateId = block.metadata?.template_id;
      if (templateId) {
        filledMap.set(templateId, {
          block_id: block.id,
          filled_at: block.updated_at || block.created_at,
        });
      }
    }

    // Combine templates with status
    const templatesWithStatus = (templates || []).map((template: any) => {
      const filled = filledMap.get(template.slug);
      return {
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        category: template.category,
        schema: template.schema,
        scope: template.scope,
        is_required: template.is_required,
        display_order: template.display_order,
        icon: template.icon,
        // Status
        is_filled: !!filled,
        block_id: filled?.block_id || null,
        filled_at: filled?.filled_at || null,
      };
    });

    // Calculate completion status
    const requiredTemplates = templatesWithStatus.filter((t: any) => t.is_required);
    const filledRequired = requiredTemplates.filter((t: any) => t.is_filled);

    return NextResponse.json({
      templates: templatesWithStatus,
      basket_id: basketId,
      status: {
        total: templatesWithStatus.length,
        filled: filledMap.size,
        required_total: requiredTemplates.length,
        required_filled: filledRequired.length,
        is_complete: filledRequired.length >= requiredTemplates.length,
      },
    });

  } catch (error) {
    console.error('[TEMPLATES API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

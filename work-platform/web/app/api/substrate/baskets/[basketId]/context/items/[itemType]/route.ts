import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * GET /api/substrate/baskets/[basketId]/context/items/[itemType]
 *
 * Get a specific context item by item type.
 *
 * v3.0 Terminology:
 * - item_type: Type of context item (problem, customer, vision, brand, etc.)
 * - item_key: Optional key for non-singleton types (query param)
 * - content: Structured JSONB data
 * - tier: Governance tier (foundation, working, ephemeral)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string; itemType: string }> }
) {
  try {
    const { basketId, itemType } = await params;

    // Get Supabase session
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

    // Forward query params (item_key)
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const url = `${SUBSTRATE_API_URL}/api/substrate/baskets/${basketId}/context/items/${itemType}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to fetch item' }));
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[CONTEXT ITEM GET] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/substrate/baskets/[basketId]/context/items/[itemType]
 *
 * Create or update a context item.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string; itemType: string }> }
) {
  try {
    const { basketId, itemType } = await params;

    // Get Supabase session
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

    const body = await request.json();

    // Forward query params (item_key)
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const url = `${SUBSTRATE_API_URL}/api/substrate/baskets/${basketId}/context/items/${itemType}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to save item' }));
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[CONTEXT ITEM PUT] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/substrate/baskets/[basketId]/context/items/[itemType]
 *
 * Archive a context item.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ basketId: string; itemType: string }> }
) {
  try {
    const { basketId, itemType } = await params;

    // Get Supabase session
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

    // Forward query params (item_key)
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const url = `${SUBSTRATE_API_URL}/api/substrate/baskets/${basketId}/context/items/${itemType}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to archive item' }));
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[CONTEXT ITEM DELETE] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

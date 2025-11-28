import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * GET /api/work-outputs/[outputId]/download?basket_id=xxx
 *
 * Download a file-based work output via substrate-API proxy.
 * This endpoint proxies to substrate-API which downloads from Claude Files API.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ outputId: string }> }
) {
  try {
    const { outputId } = await params;
    const basketId = request.nextUrl.searchParams.get('basket_id');

    if (!basketId) {
      return NextResponse.json(
        { detail: 'basket_id query parameter is required' },
        { status: 400 }
      );
    }

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

    const token = session.access_token;

    // Proxy to substrate-API
    const backendResponse = await fetch(
      `${SUBSTRATE_API_URL}/api/baskets/${basketId}/work-outputs/${outputId}/download`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({
        detail: 'Failed to download file',
      }));
      return NextResponse.json(errorData, { status: backendResponse.status });
    }

    // Stream the response
    const contentType = backendResponse.headers.get('Content-Type') || 'application/octet-stream';
    const contentDisposition = backendResponse.headers.get('Content-Disposition') || 'attachment';
    const contentLength = backendResponse.headers.get('Content-Length');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    return new NextResponse(backendResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[DOWNLOAD API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

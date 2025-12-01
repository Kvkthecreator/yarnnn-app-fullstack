import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@/lib/supabase/clients';

const WORK_PLATFORM_API_URL = process.env.NEXT_PUBLIC_WORK_PLATFORM_API_URL || 'http://localhost:8000';
const SUBSTRATE_API_URL = process.env.SUBSTRATE_API_URL || 'http://localhost:10000';

/**
 * POST /api/projects/new
 *
 * Creates a new project with TWO guaranteed foundational anchor blocks.
 *
 * Accepts either:
 * - JSON body: { project_topic, project_intent }
 * - FormData: project_topic, project_intent, seed_file?
 *
 * Flow:
 * 1. Create project via backend which creates TWO anchor blocks:
 *    - Topic block (anchor_role: 'topic') - WHAT you're working on
 *    - Vision block (anchor_role: 'vision') - WHY you're working on it
 * 2. If seed_file provided, upload to reference_assets for P1 extraction
 *
 * KEY INSIGHT: topic + intent create DIRECT anchor blocks (trusted, ACCEPTED).
 * Only seed_file content goes through raw_dump → P1 extraction pipeline.
 * This gives every project a strong "what and why" foundation.
 */
export async function POST(request: NextRequest) {
  try {
    // Get Supabase session (canonical pattern per AUTH_CANON.md line 39-43)
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

    // Parse request - handle both JSON and FormData
    // Two required fields: project_topic (what) + project_intent (why)
    let project_topic: string;
    let project_intent: string;
    let seedFile: File | null = null;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      project_topic = formData.get('project_topic') as string;
      project_intent = formData.get('project_intent') as string;
      seedFile = formData.get('seed_file') as File | null;
    } else {
      const body = await request.json();
      project_topic = body.project_topic;
      project_intent = body.project_intent;
    }

    // Validate required fields
    if (!project_topic?.trim()) {
      return NextResponse.json(
        { detail: 'Project topic is required' },
        { status: 400 }
      );
    }

    if (!project_intent?.trim()) {
      return NextResponse.json(
        { detail: 'Project intent is required' },
        { status: 400 }
      );
    }

    // Forward to work-platform backend with topic + intent
    // Backend will create TWO anchor blocks directly (no LLM needed):
    // 1. Topic block (anchor_role: 'topic') from project_topic
    // 2. Vision block (anchor_role: 'vision') from project_intent
    // NOTE: No initial_context/raw_dump - these become direct anchor blocks
    const backendPayload = {
      project_name: project_topic.trim(),  // Topic becomes project name
      project_topic: project_topic.trim(), // Explicit topic for anchor block
      project_intent: project_intent.trim(),
    };

    console.log(`[CREATE PROJECT API] Creating project: ${project_topic.trim()}`);

    // Send both Authorization AND sb-access-token headers (per AUTH_CANON.md line 7-9)
    const backendResponse = await fetch(`${WORK_PLATFORM_API_URL}/api/projects/new`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'sb-access-token': token,  // Both headers required
      },
      body: JSON.stringify(backendPayload),
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({ detail: 'Failed to create project' }));
      return NextResponse.json(
        errorData,
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    console.log(`[CREATE PROJECT API] Project created: ${result.project_id}, basket: ${result.basket_id}`);

    // If seed_file provided, upload to reference_assets and trigger P1 extraction
    // This is the ONLY path that creates raw_dumps - seed files go through governance
    if (seedFile && seedFile.size > 0 && result.basket_id) {
      console.log(`[CREATE PROJECT API] Processing seed file: ${seedFile.name} (${seedFile.size} bytes)`);

      try {
        // Upload file to reference_assets
        const uploadFormData = new FormData();
        uploadFormData.append('file', seedFile);
        uploadFormData.append('asset_type', 'seed_material');
        uploadFormData.append('description', `Project seed material: ${seedFile.name}`);

        const uploadResponse = await fetch(
          `${WORK_PLATFORM_API_URL}/api/baskets/${result.basket_id}/assets/upload`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'sb-access-token': token,
            },
            body: uploadFormData,
          }
        );

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          console.log(`[CREATE PROJECT API] Seed file uploaded: ${uploadResult.asset_id || uploadResult.id}`);

          // Trigger anchor seeding with file content extraction (fire-and-forget)
          // The substrate-api will extract text from the file and generate anchors
          fetch(`${SUBSTRATE_API_URL}/api/baskets/${result.basket_id}/seed-anchors-from-asset`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              asset_id: uploadResult.asset_id || uploadResult.id,
              project_name: project_topic.trim(),
            }),
          }).then(res => {
            if (res.ok) {
              console.log(`[CREATE PROJECT API] Anchor seeding from asset initiated for basket ${result.basket_id}`);
            } else {
              // Fallback: Try text-based seeding if asset-based endpoint doesn't exist
              console.log(`[CREATE PROJECT API] Asset-based seeding not available, skipping additional anchors`);
            }
          }).catch(err => {
            console.warn(`[CREATE PROJECT API] Anchor seeding error for basket ${result.basket_id}:`, err);
          });
        } else {
          console.warn(`[CREATE PROJECT API] Seed file upload failed: ${uploadResponse.status}`);
        }
      } catch (uploadError) {
        // Don't fail project creation if file upload fails
        console.warn(`[CREATE PROJECT API] Seed file processing error:`, uploadError);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[CREATE PROJECT API] Error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

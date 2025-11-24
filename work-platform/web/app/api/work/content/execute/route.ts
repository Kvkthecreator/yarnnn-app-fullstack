/**
 * API Route Proxy: POST /api/work/content/execute
 *
 * Proxies content execution requests to backend API.
 * Forwards JWT token for authentication.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Get auth token from cookies
    const cookieStore = await cookies();
    const authToken = cookieStore.get("sb-access-token")?.value ||
                     cookieStore.get("supabase-auth-token")?.value;

    if (!authToken) {
      return NextResponse.json(
        { detail: "Authentication required" },
        { status: 401 }
      );
    }

    // Forward request to backend
    const backendResponse = await fetch(`${BACKEND_URL}/work/content/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    const responseData = await backendResponse.json();

    return NextResponse.json(responseData, {
      status: backendResponse.status,
    });
  } catch (error: any) {
    console.error("[API Proxy] Content execute failed:", error);
    return NextResponse.json(
      { detail: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

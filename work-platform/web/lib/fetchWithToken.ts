import { createBrowserClient } from "./supabase/clients";

/**
 * Fetch wrapper that automatically adds Supabase auth JWT token.
 *
 * Use this for client-side calls to Next.js API routes that need authentication.
 * The Next.js API route will then forward the JWT to backend APIs as needed.
 *
 * @param input - URL to fetch (relative or absolute)
 * @param init - Fetch options
 * @param token - Optional JWT token (if already available)
 * @returns Fetch response
 */
export async function fetchWithToken(
  input: RequestInfo | URL,
  init: RequestInit = {},
  token?: string,
) {
  // Get JWT token from Supabase session
  let jwt = token;
  if (!jwt) {
    const supabase = createBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("No authenticated user found. Please log in to continue.");
    }

    jwt = session.access_token;
  }

  // Convert input to URL string
  let url: string;
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }

  // Add auth headers
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${jwt}`,
  };

  // Preserve existing headers
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, init.headers);
    }
  }

  // Set default Content-Type if not already set
  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });
}

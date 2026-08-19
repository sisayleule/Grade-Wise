/**
 * Service-role Supabase client — NEVER import this in Client Components or
 * expose it to the browser.  Use only in Route Handlers and Server Components.
 *
 * The service role key bypasses Row-Level Security, which is intentional here:
 * we need it to call the `get_school_gemini_key` RPC that reads from
 * vault.decrypted_secrets (a view that only the postgres / service role can
 * access — the anon role is explicitly blocked from it).
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

let _client: ReturnType<typeof createSupabaseClient> | null = null;

export function createServiceClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey || serviceKey === 'your-service-role-key-here') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. ' +
        'Add it to .env.local (Supabase Dashboard → Project Settings → API → service_role).'
    );
  }

  _client = createSupabaseClient(url, serviceKey, {
    auth: {
      // Service role clients must never persist sessions
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _client;
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';

/**
 * GET /api/settings/gemini-key
 *
 * Returns whether this school has a Gemini key stored in Vault, plus a masked
 * display value (e.g. "AQ.Ab8••••••••qLMg").  The raw key is never returned.
 */
export async function GET() {
  // Verify the request is from a logged-in school
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if a secret reference exists (no decryption needed for status check)
  const { data: school, error } = await supabase
    .from('schools')
    .select('gemini_key_secret_id')
    .eq('id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!school?.gemini_key_secret_id) {
    return NextResponse.json({ hasKey: false, masked: null });
  }

  // A secret UUID exists — decrypt just enough to produce a masked display.
  // We use the service client + RPC so the raw key never travels through the
  // anon/session layer.
  let rawKey: string | null = null;
  try {
    const service = createServiceClient();
    const { data, error: rpcErr } = await (service as any).rpc('get_school_gemini_key', {
      school_id: user.id,
    });
    if (rpcErr) throw rpcErr;
    rawKey = data as string | null;
  } catch (err: any) {
    console.error('[gemini-key GET] vault RPC error:', err?.message);
    // If decryption fails, still report hasKey:true so the UI shows "Replace"
    return NextResponse.json({ hasKey: true, masked: '••••••••••••••••' });
  }

  if (!rawKey) {
    return NextResponse.json({ hasKey: false, masked: null });
  }

  // Build the masked string — never return the full key
  const masked =
    rawKey.length > 10
      ? rawKey.slice(0, 6) + '••••••••••' + rawKey.slice(-4)
      : '••••••••••••';

  // rawKey goes out of scope here and is never serialised to a response
  return NextResponse.json({ hasKey: true, masked });
}

/**
 * POST /api/settings/gemini-key
 * Body: { key: string }
 *
 * 1. Validates key length
 * 2. Tests the key against Gemini (cheap single-token call)
 * 3. Stores it via vault.upsert_school_gemini_key RPC — plaintext never
 *    touches the schools table
 * 4. Returns success/failure message only — never echoes the key
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const key: string = (body?.key ?? '').trim();

  if (!key || key.length < 10) {
    return NextResponse.json(
      { error: 'Key is too short — paste the full key from Google AI Studio.' },
      { status: 400 }
    );
  }

  // ── Verify the key works before storing it ─────────────────────────────────
  // NOTE: no console.log of the key or any prefix of it here
  let geminiOk = false;
  let geminiError = '';
  try {
    const testRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    );
    if (testRes.ok) {
      geminiOk = true;
    } else {
      const errBody = await testRes.json().catch(() => ({}));
      geminiError = errBody?.error?.message || `HTTP ${testRes.status}`;
    }
  } catch (err: any) {
    geminiError = err?.message || 'Network error testing key';
  }

  if (!geminiOk) {
    return NextResponse.json(
      { error: `This key didn't work — check it and try again. (${geminiError})` },
      { status: 422 }
    );
  }

  // ── Store via Vault RPC (service role) ─────────────────────────────────────
  // The raw key is passed to a SECURITY DEFINER Postgres function that calls
  // vault.create_secret() / vault.update_secret().  It is never written to any
  // plain text column.
  const schoolName: string =
    user.user_metadata?.school_name ||
    user.email?.split('@')[0] ||
    'My School';

  try {
    const service = createServiceClient();
    const { error: rpcErr } = await (service as any).rpc('upsert_school_gemini_key', {
      school_id: user.id,
      raw_key: key,
      school_name: schoolName,
    });
    if (rpcErr) throw rpcErr;
  } catch (err: any) {
    console.error('[gemini-key POST] vault RPC error:', err?.message);
    return NextResponse.json({ error: 'Failed to save key.' }, { status: 500 });
  }

  // key goes out of scope — never logged, never returned
  return NextResponse.json({ ok: true, message: 'Key saved and verified.' });
}

/**
 * DELETE /api/settings/gemini-key
 * Removes the Vault secret and NULLs the reference in the schools table.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { error: rpcErr } = await (service as any).rpc('delete_school_gemini_key', {
      school_id: user.id,
    });
    if (rpcErr) throw rpcErr;
  } catch (err: any) {
    console.error('[gemini-key DELETE] vault RPC error:', err?.message);
    return NextResponse.json({ error: 'Failed to remove key.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

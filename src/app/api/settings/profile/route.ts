import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';

/**
 * GET /api/settings/profile
 *
 * Returns the school profile fields (name, teacher, principal, logo, footer)
 * for the currently authenticated school.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('schools')
    .select('name, teacher, principal, logo, footer')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('[profile GET]', error.message);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }

  return NextResponse.json({
    name:      data.name      ?? '',
    teacher:   data.teacher   ?? '',
    principal: data.principal ?? '',
    logo:      data.logo      ?? '',
    footer:    data.footer    ?? '',
  });
}

/**
 * PATCH /api/settings/profile
 * Body: { name?, teacher?, principal?, logo?, footer? }
 *
 * Updates any subset of the school profile fields.
 * Each field is trimmed; only the fields present in the body are updated.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Only pick the known profile fields — ignore anything else in the body.
  const allowed = ['name', 'teacher', 'principal', 'logo', 'footer'] as const;
  const update: Record<string, string> = {};
  for (const field of allowed) {
    if (field in body) {
      update[field] = String(body[field] ?? '').trim();
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
  }

  const { error } = await supabase
    .from('schools')
    .update(update as any)   // cast: new columns not yet in generated types
    .eq('id', user.id);

  if (error) {
    console.error('[profile PATCH]', error.message);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

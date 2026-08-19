import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';

/**
 * Admin-only API route.
 *
 * Uses the service-role client to check is_admin — avoids the RLS circular
 * reference that occurs when the policy itself queries the schools table.
 */
async function requireAdmin() {
  // Step 1: get the session user via the anon/cookie client
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), user: null };
  }

  // Step 2: check is_admin via service role (bypasses RLS, no circular ref)
  const service = createServiceClient();
  const { data: school } = await (service as any)
    .from('schools')
    .select('is_admin')
    .eq('id', user.id)
    .single() as { data: { is_admin: boolean } | null };

  if (!school || !school.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), user: null };
  }

  return { error: null, user };
}

/**
 * GET /api/admin/schools
 * Returns all schools with their status, name, email, signup date.
 * Optional ?status=pending|approved|rejected|suspended filter.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const service = createServiceClient();
  const statusFilter = request.nextUrl.searchParams.get('status');

  let q = service
    .from('schools')
    .select('id, name, status, is_admin, created_at')
    .order('created_at', { ascending: false });

  if (statusFilter) {
    q = (q as any).eq('status', statusFilter);
  }

  const { data: schools, error: dbErr } = await q;
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // Attach emails from auth.users
  const emailMap: Record<string, string> = {};
  try {
    const { data: { users } } = await service.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users ?? []) {
      emailMap[u.id] = u.email ?? '';
    }
  } catch {
    // Non-fatal
  }

  const enriched = (schools as any[]).map((s: any) => ({
    ...s,
    email: emailMap[s.id] ?? '',
  }));

  return NextResponse.json({ schools: enriched });
}

/**
 * PATCH /api/admin/schools
 * Body: { id: string, status: 'approved' | 'rejected' | 'pending' | 'suspended' }
 */
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body?.id || !body?.status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 });
  }

  const allowed = ['pending', 'approved', 'rejected', 'suspended'];
  if (!allowed.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
  }

  const service = createServiceClient();
  const { error: dbErr } = await (service as any)
    .from('schools')
    .update({ status: body.status })
    .eq('id', body.id);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // When approving, also confirm the user's email in Supabase Auth so they
  // can sign in even if their email was never verified.
  if (body.status === 'approved') {
    try {
      await service.auth.admin.updateUserById(body.id, { email_confirm: true });
    } catch {
      // Non-fatal — the status update already succeeded
    }
  }

  return NextResponse.json({ ok: true });
}

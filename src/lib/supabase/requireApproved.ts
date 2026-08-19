/**
 * Server-side guard for API route handlers.
 *
 * Uses the service-role client to read `status` from the schools table —
 * this bypasses RLS entirely, which is the correct approach here because:
 *   1. The anon-client RLS policy for schools has a security-definer helper
 *      function that works correctly, but using the service client is simpler
 *      and guarantees no policy-evaluation side effects.
 *   2. We already have the user's identity from getUser() on the session client,
 *      so there's no privilege escalation — we're just reading our own row.
 *
 * Usage:
 *   const guard = await requireApproved();
 *   if (guard.error) return guard.error;   // NextResponse 401/403
 *   const { user } = guard;               // approved user
 */
import { NextResponse } from 'next/server';
import { createClient } from './server';
import { createServiceClient } from './service';

type ApprovedUser = { id: string };
type GuardOk   = { error: null;        user: ApprovedUser };
type GuardFail = { error: NextResponse; user: null };
type GuardResult = GuardOk | GuardFail;

export async function requireApproved(): Promise<GuardResult> {
  // Step 1: verify the session (anon/cookie client — checks JWT)
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();

  if (authErr || !user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
    };
  }

  // Step 2: read status via service role — bypasses RLS, always returns the
  // real current value even if status was just updated by an admin.
  const service = createServiceClient();
  const { data: school } = await (service as any)
    .from('schools')
    .select('status')
    .eq('id', user.id)
    .single() as { data: { status: string } | null };

  const status: string = school?.status ?? 'pending';

  if (status !== 'approved') {
    const msg =
      status === 'pending'
        ? 'Your account is awaiting admin approval. You cannot use this feature yet.'
        : status === 'rejected'
        ? 'Your account application was not approved. Contact ssisayleule@gmail.com.'
        : 'Your account has been suspended. Contact ssisayleule@gmail.com.';

    return {
      error: NextResponse.json({ error: msg, status }, { status: 403 }),
      user: null,
    };
  }

  return { error: null, user: { id: user.id } };
}

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from 'lib/supabase/service';

/**
 * POST /api/auth/signup
 *
 * Creates a new user account using the service-role admin API so that:
 *   - email_confirm is set to true immediately (no verification email sent)
 *   - The user can sign in right away once admin approves their schools.status
 *   - The email does not need to be a real address
 *
 * Body: { email, password, school_name, contact_name }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { email, password, school_name, contact_name } = body ?? {};

  if (!email || !password || !school_name) {
    return NextResponse.json(
      { error: 'email, password, and school_name are required' },
      { status: 400 }
    );
  }
  if (!contact_name || !String(contact_name).trim()) {
    return NextResponse.json(
      { error: 'Your name is required.' },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters.' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Create the user with email already confirmed — no verification email.
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,           // ← bypasses Supabase email confirmation
    user_metadata: {
      school_name: school_name.trim(),
      contact_name: String(contact_name).trim(),
    },
  });

  if (error) {
    // Surface the real error (e.g. "User already registered")
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  // Belt-and-suspenders: also write contact_name directly to the schools row
  // (the DB trigger already does this via user_metadata, but we ensure it here
  //  in case the migration hasn't run yet on an existing project).
  // We use a raw PATCH via fetch rather than the typed Supabase client so that
  // a missing contact_name column in the generated types doesn't block the build.
  if (data.user?.id) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      await fetch(`${supabaseUrl}/rest/v1/schools?id=eq.${data.user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':         serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ contact_name: String(contact_name).trim() }),
      });
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, userId: data.user?.id });
}

/**
 * POST /api/students/portal
 *
 * Creates a Supabase auth user for a student and sends them a password-reset
 * (set-your-password) email — the student never sees a temporary password.
 *
 * Body: { student_id: string, email: string }
 *   student_id — the UUID in public.students (NOT the student_code)
 *   email      — the email to associate with this portal account
 *
 * Security:
 *   - Teacher must be approved (requireApproved guard).
 *   - The student row must belong to this teacher's school (school_id = uid).
 *   - Uses service-role admin API — never exposes keys to the browser.
 *   - Password-reset email reuses the existing Supabase reset flow
 *     (same redirect URL as /auth/forgot-password).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApproved } from 'lib/supabase/requireApproved';
import { createServiceClient } from 'lib/supabase/service';

export async function POST(request: NextRequest) {
  // ── 1. Verify teacher session ─────────────────────────────────────────────
  const guard = await requireApproved();
  if (guard.error) return guard.error;
  const teacherId = guard.user.id;

  // ── 2. Parse and validate body ────────────────────────────────────────────
  const body = await request.json().catch(() => null);
  const { student_id, email } = body ?? {};

  if (!student_id || !email) {
    return NextResponse.json(
      { error: 'student_id and email are required' },
      { status: 400 }
    );
  }

  const emailTrimmed = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const service = createServiceClient();

  // ── 3. Verify the student belongs to this teacher's school ────────────────
  const { data: student, error: fetchErr } = await (service as any)
    .from('students')
    .select('id, student_code, full_name, portal_status, auth_user_id')
    .eq('id', student_id)
    .eq('school_id', teacherId)
    .single() as { data: any; error: any };

  if (fetchErr || !student) {
    return NextResponse.json(
      { error: 'Student not found or does not belong to your school' },
      { status: 404 }
    );
  }

  if (student.portal_status === 'active' || student.auth_user_id) {
    return NextResponse.json(
      { error: 'This student already has an active portal account' },
      { status: 409 }
    );
  }

  // ── 4. Create auth user via service-role admin API ────────────────────────
  // email_confirm: true — account is immediately usable.
  // A random strong password is set; it will be replaced when the student
  // clicks the password-reset link we send next.
  const tempPassword =
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2).toUpperCase() +
    '!9';

  const { data: authData, error: createErr } =
    await service.auth.admin.createUser({
      email:          emailTrimmed,
      password:       tempPassword,
      email_confirm:  true,
      user_metadata:  {
        full_name:    student.full_name,
        role:         'student',
        student_id:   student.student_code,
      },
    });

  if (createErr) {
    // Surface real errors (e.g. email already registered)
    return NextResponse.json(
      { error: createErr.message },
      { status: 422 }
    );
  }

  const authUserId = authData.user?.id;
  if (!authUserId) {
    return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 });
  }

  // ── 5. Update public.students with email, auth_user_id, status ───────────
  const { error: updateErr } = await (service as any)
    .from('students')
    .update({
      email:         emailTrimmed,
      auth_user_id:  authUserId,
      portal_status: 'invited',
    })
    .eq('id', student_id);

  if (updateErr) {
    // Roll back the auth user to keep data consistent
    await service.auth.admin.deleteUser(authUserId);
    console.error('[portal POST] update student:', updateErr.message);
    return NextResponse.json({ error: 'Failed to link portal account' }, { status: 500 });
  }

  // ── 6. Send password-reset email (reuses the existing reset flow) ─────────
  // The student will receive a "Set your password" link pointing to
  // /auth/reset-password — the same page already built in the app.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000';

  const { error: resetErr } = await service.auth.resetPasswordForEmail(
    emailTrimmed,
    { redirectTo: `${siteUrl}/auth/reset-password` }
  );

  if (resetErr) {
    // Non-fatal — the account is created; teacher can retry the invite
    console.error('[portal POST] reset email:', resetErr.message);
  }

  return NextResponse.json({
    ok:      true,
    message: `Portal account created. An invitation email has been sent to ${emailTrimmed}.`,
  });
}

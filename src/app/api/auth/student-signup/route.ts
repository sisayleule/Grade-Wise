/**
 * POST /api/auth/student-signup
 *
 * Self-service student registration. No auth required (public route).
 *
 * Flow:
 *   1. Look up school by school_code → 404 with friendly message if not found
 *   2. Look up students row by (school_id + student_code) → 404 if not found
 *   3. Check auth_user_id — if already set → 409 "already claimed"
 *   4. Create Supabase auth user with the student's own chosen password
 *      (email_confirm: true — no verification email needed for portal)
 *   5. Update students row: set auth_user_id, email, portal_status = 'pending'
 *
 * Returns 201 on success.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from 'lib/supabase/service';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { full_name, student_code, school_code, email, password } = body;

  // ── Validate inputs ────────────────────────────────────────────────────────
  if (!full_name?.trim())    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  if (!student_code?.trim()) return NextResponse.json({ error: 'Student ID is required.' }, { status: 400 });
  if (!school_code?.trim())  return NextResponse.json({ error: 'School code is required.' }, { status: 400 });
  if (!email?.trim())        return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  const service = createServiceClient();

  // ── 1. Look up school by code ──────────────────────────────────────────────
  const { data: school, error: schoolErr } = await (service as any)
    .from('schools')
    .select('id, name, status')
    .eq('school_code', school_code.trim().toUpperCase())
    .single() as { data: { id: string; name: string; status: string } | null; error: any };

  if (schoolErr || !school) {
    return NextResponse.json(
      { error: 'Invalid school code — check with your teacher and try again.' },
      { status: 404 }
    );
  }

  // School must be approved (not pending/rejected/suspended)
  if (school.status !== 'approved') {
    return NextResponse.json(
      { error: 'This school is not yet active on GradeWise. Contact your teacher.' },
      { status: 403 }
    );
  }

  // ── 2. Look up student by school_id + student_code ─────────────────────────
  const { data: student, error: studentErr } = await (service as any)
    .from('students')
    .select('id, full_name, auth_user_id, portal_status, email')
    .eq('school_id', school.id)
    .eq('student_code', student_code.trim())
    .single() as { data: any; error: any };

  if (studentErr || !student) {
    return NextResponse.json(
      {
        error:
          'Student ID not found for this school — make sure your teacher has already ' +
          'uploaded a result sheet that includes you, then try again.',
      },
      { status: 404 }
    );
  }

  // ── 3. Check if already claimed ────────────────────────────────────────────
  if (student.auth_user_id) {
    return NextResponse.json(
      {
        error:
          'This Student ID has already been registered. ' +
          "If this wasn't you, contact your teacher.",
      },
      { status: 409 }
    );
  }

  // ── 4. Create auth user ────────────────────────────────────────────────────
  const { data: authData, error: createErr } =
    await service.auth.admin.createUser({
      email:         email.trim().toLowerCase(),
      password,
      email_confirm: true,   // no email verification needed for portal
      user_metadata: {
        full_name:    full_name.trim(),
        role:         'student',
        student_code: student_code.trim(),
        school_id:    school.id,
      },
    });

  if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 422 });
  }

  const authUserId = authData.user?.id;
  if (!authUserId) {
    return NextResponse.json({ error: 'Failed to create account.' }, { status: 500 });
  }

  // ── 5. Update students row ─────────────────────────────────────────────────
  const { error: updateErr } = await (service as any)
    .from('students')
    .update({
      auth_user_id:  authUserId,
      email:         email.trim().toLowerCase(),
      full_name:     full_name.trim(),        // update name if it was blank
      portal_status: 'pending',               // awaiting teacher approval
    })
    .eq('id', student.id);

  if (updateErr) {
    // Roll back auth user to keep data consistent
    await service.auth.admin.deleteUser(authUserId);
    console.error('[student-signup] update student:', updateErr.message);
    return NextResponse.json({ error: 'Failed to link account. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({
    ok:      true,
    message: 'Account created — awaiting your teacher\'s approval.',
  }, { status: 201 });
}

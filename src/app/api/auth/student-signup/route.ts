/**
 * POST /api/auth/student-signup
 *
 * Self-service student registration. No auth required (public route).
 *
 * Flow:
 *   1. Validate inputs
 *   2. Look up school by school_code → error if not found or not approved
 *   3. Check for an existing students row with the same (school_id, student_code):
 *      a. If it exists AND auth_user_id is already set → "already registered" error
 *      b. If it exists but unclaimed → claim it (update with auth_user_id etc.)
 *      c. If it doesn't exist → create a new students row then claim it
 *   4. Create the Supabase auth user (service-role admin API)
 *   5. Write auth_user_id + email + portal_status='pending' to the students row
 *
 * A student does NOT need the teacher to have uploaded results first.
 * The student_code they enter is any ID they know (from their result sheet,
 * school register, or assigned by the teacher). If a teacher later uploads
 * a result sheet containing that same student_code, the batch-save upsert
 * will find this students row and update grade/section/year — linking the
 * portal account to the results automatically.
 *
 * Returns 201 on success.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from 'lib/supabase/service';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { full_name, student_code, school_code, email, password } = body;

  // ── 1. Validate inputs ─────────────────────────────────────────────────────
  if (!full_name?.trim())
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  if (!student_code?.trim())
    return NextResponse.json({ error: 'Student ID is required.' }, { status: 400 });
  if (!school_code?.trim())
    return NextResponse.json({ error: 'School code is required.' }, { status: 400 });
  if (!email?.trim())
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  if (!password || password.length < 8)
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  const emailNorm   = email.trim().toLowerCase();
  const codeNorm    = student_code.trim();
  const nameNorm    = full_name.trim();
  const schoolNorm  = school_code.trim().toUpperCase();

  const service = createServiceClient();

  // ── 2. Look up school by code ──────────────────────────────────────────────
  const { data: school, error: schoolErr } = await (service as any)
    .from('schools')
    .select('id, name, status')
    .eq('school_code', schoolNorm)
    .single() as { data: { id: string; name: string; status: string } | null; error: any };

  if (schoolErr || !school) {
    return NextResponse.json(
      { error: 'Invalid school code — check with your teacher and try again.' },
      { status: 404 }
    );
  }

  if (school.status !== 'approved') {
    return NextResponse.json(
      { error: 'This school is not yet active on GradeWise. Contact your teacher.' },
      { status: 403 }
    );
  }

  // ── 3. Check existing students row ────────────────────────────────────────
  const { data: existing } = await (service as any)
    .from('students')
    .select('id, auth_user_id')
    .eq('school_id', school.id)
    .eq('student_code', codeNorm)
    .maybeSingle() as { data: { id: string; auth_user_id: string | null } | null };

  if (existing?.auth_user_id) {
    // Already claimed by another account
    return NextResponse.json(
      {
        error:
          'This Student ID has already been registered. ' +
          "If this wasn't you, contact your teacher.",
      },
      { status: 409 }
    );
  }

  // ── 4. Create Supabase auth user ───────────────────────────────────────────
  const { data: authData, error: createErr } =
    await service.auth.admin.createUser({
      email:         emailNorm,
      password,
      email_confirm: true,
      user_metadata: {
        full_name:    nameNorm,
        role:         'student',
        student_code: codeNorm,
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

  // ── 5a. If students row already exists → update it ────────────────────────
  if (existing) {
    const { error: updateErr } = await (service as any)
      .from('students')
      .update({
        auth_user_id:  authUserId,
        email:         emailNorm,
        full_name:     nameNorm,
        portal_status: 'pending',
      })
      .eq('id', existing.id);

    if (updateErr) {
      await service.auth.admin.deleteUser(authUserId);
      console.error('[student-signup] update:', updateErr.message);
      return NextResponse.json({ error: 'Failed to link account. Please try again.' }, { status: 500 });
    }
  } else {
    // ── 5b. No row yet → insert a new canonical student record ──────────────
    const { error: insertErr } = await (service as any)
      .from('students')
      .insert({
        school_id:     school.id,
        student_code:  codeNorm,
        full_name:     nameNorm,
        email:         emailNorm,
        auth_user_id:  authUserId,
        portal_status: 'pending',
        // grade/section/academic_year left as '' until teacher uploads results
        // containing this student_code — the batch-save upsert will fill them in
        grade:         '',
        section:       '',
        academic_year: '',
      });

    if (insertErr) {
      await service.auth.admin.deleteUser(authUserId);
      console.error('[student-signup] insert:', insertErr.message);
      return NextResponse.json({ error: 'Failed to create student record. Please try again.' }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: true, message: "Account created — awaiting your teacher's approval." },
    { status: 201 }
  );
}

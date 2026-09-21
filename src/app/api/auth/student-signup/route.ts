/**
 * POST /api/auth/student-signup
 *
 * Self-service student registration. No auth required (public route).
 *
 * Flow:
 *   1. Validate inputs (including grade + section — required since Phase 4 fix)
 *   2. Look up school by school_code → error if not found or not approved
 *   3. Look up students row by (school_id, student_code):
 *      a. Not found at all → error: "Student ID not found"
 *         (Students must exist in the DB — uploaded by teacher — before signing up.
 *          This prevents phantom registrations for nonexistent student codes.)
 *      b. Found but grade/section don't match exactly → specific mismatch error
 *      c. Found, grade/section match, already claimed (auth_user_id set) → 409
 *      d. Found, grade/section match, unclaimed → proceed
 *   4. Create the Supabase auth user (service-role admin API)
 *   5. Write auth_user_id + email + portal_status='pending' to the students row
 *
 * Grade + Section verification (step 3b) is the key fix:
 *   A student must prove they belong to the correct class, not just that they
 *   know a school code and any student ID in that school.  The error message
 *   is intentionally specific so a legitimate student can correct their input,
 *   but does not reveal whose record was found (no name/email leakage).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from 'lib/supabase/service';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { full_name, student_code, school_code, grade, section, email, password, parent_name, parent_phone } = body;

  // ── 1. Validate inputs ─────────────────────────────────────────────────────
  if (!full_name?.trim())
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  if (!student_code?.trim())
    return NextResponse.json({ error: 'Student ID is required.' }, { status: 400 });
  if (!school_code?.trim())
    return NextResponse.json({ error: 'School code is required.' }, { status: 400 });
  if (!grade?.trim())
    return NextResponse.json({ error: 'Grade is required.' }, { status: 400 });
  if (!section?.trim())
    return NextResponse.json({ error: 'Section is required.' }, { status: 400 });
  if (!email?.trim())
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  if (!password || password.length < 8)
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  const emailNorm  = email.trim().toLowerCase();
  const codeNorm   = student_code.trim();
  const nameNorm   = full_name.trim();
  const schoolNorm = school_code.trim().toUpperCase();
  const gradeNorm  = grade.trim();
  const sectNorm   = section.trim();

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

  // ── 3. Look up existing students row ──────────────────────────────────────
  // We select grade and section so we can verify the exact class match.
  const { data: existing } = await (service as any)
    .from('students')
    .select('id, auth_user_id, grade, section')
    .eq('school_id', school.id)
    .eq('student_code', codeNorm)
    .maybeSingle() as {
      data: {
        id: string;
        auth_user_id: string | null;
        grade: string;
        section: string;
      } | null;
    };

  // 3a. Student ID not found at all in this school
  if (!existing) {
    return NextResponse.json(
      {
        error:
          'Student ID not found in this school. ' +
          'Check your Student ID and School Code, or ask your teacher to upload your results first.',
      },
      { status: 404 }
    );
  }

  // 3b. Student ID found but grade or section doesn't match.
  //
  // Grade tolerance: the DB stores "Grade 9" (the full selector string from the
  // teacher app) but a student naturally types "9". Normalise both sides by
  // stripping the leading "Grade " / "grade " prefix before comparing so that
  // "Grade 9" == "9" == "grade 9" all pass. Section is compared as-is
  // (case-insensitive) since it is always a short value like "C" or "Gold".
  const normaliseGrade = (g: string) =>
    g.trim().toLowerCase().replace(/^grade\s+/i, '').trim();

  const gradeMatch   = normaliseGrade(existing.grade) === normaliseGrade(gradeNorm);
  const sectionMatch = existing.section.trim().toLowerCase() === sectNorm.toLowerCase();

  if (!gradeMatch || !sectionMatch) {
    return NextResponse.json(
      {
        error:
          "Student ID found, but Grade/Section doesn't match our records — " +
          'check with your teacher.',
      },
      { status: 422 }
    );
  }

  // 3c. Already claimed
  if (existing.auth_user_id) {
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

  // ── 5. Claim the existing students row ────────────────────────────────────
  // Always updates the existing row — we no longer insert phantom rows because
  // step 3a already rejects sign-ups for nonexistent student codes.
  // Grade/section are intentionally NOT overwritten — they come from the
  // teacher's uploaded data and must not be overridden by user input.
  const { error: updateErr } = await (service as any)
    .from('students')
    .update({
      auth_user_id:  authUserId,
      email:         emailNorm,
      full_name:     nameNorm,       // update name in case teacher had a placeholder
      portal_status: 'pending',
      // Parent contact — save if provided, leave existing value if not sent
      ...(parent_name?.trim()  ? { parent_name:  parent_name.trim()  } : {}),
      ...(parent_phone?.trim() ? { parent_phone: parent_phone.trim() } : {}),
    })
    .eq('id', existing.id);

  if (updateErr) {
    await service.auth.admin.deleteUser(authUserId);
    console.error('[student-signup] update:', updateErr.message);
    return NextResponse.json(
      { error: 'Failed to link account. Please try again.' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, message: "Account created — awaiting your teacher's approval." },
    { status: 201 }
  );
}

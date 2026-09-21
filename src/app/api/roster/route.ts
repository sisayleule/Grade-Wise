import { NextRequest, NextResponse } from 'next/server';
import { requireApproved } from 'lib/supabase/requireApproved';
import { createServiceClient } from 'lib/supabase/service';

/**
 * GET /api/roster?year=...&grade=...&section=...
 *
 * Returns all students rows for the given class, ordered by roll_number then
 * full_name. Used by the Roster page to display the current class list.
 *
 * Query params (all required):
 *   year     — academic year, e.g. "2025 / 2026"
 *   grade    — e.g. "Grade 8"
 *   section  — e.g. "A"
 */
export async function GET(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;
  const teacherId = guard.user.id;

  const { searchParams } = request.nextUrl;
  const year    = searchParams.get('year')?.trim()    ?? '';
  const grade   = searchParams.get('grade')?.trim()   ?? '';
  const section = searchParams.get('section')?.trim() ?? '';

  if (!year || !grade || !section) {
    return NextResponse.json(
      { error: 'year, grade, and section are required' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data, error } = await (service as any)
    .from('students')
    .select(
      'id, student_code, full_name, roll_number, sex, portal_status, auth_user_id, parent_name, parent_phone, created_at'
    )
    .eq('school_id', teacherId)
    .eq('academic_year', year)
    .eq('grade', grade)
    .eq('section', section)
    .order('roll_number', { ascending: true, nullsFirst: false })
    .order('full_name',   { ascending: true }) as { data: any[] | null; error: any };

  if (error) {
    console.error('[roster GET]', error.message);
    return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 });
  }

  return NextResponse.json({ students: data ?? [] });
}

/**
 * POST /api/roster
 *
 * Saves a roster for a given class. Each row in `students` is upserted by
 * (school_id, student_code). The roster is the sole source of student
 * identity — calling this creates or updates canonical students rows.
 *
 * Body:
 * {
 *   year:     string;
 *   grade:    string;
 *   section:  string;
 *   students: Array<{
 *     student_code: string;   // required — must be unique within this class
 *     full_name:    string;   // required
 *     roll_number?: string;
 *     sex?:         'M' | 'F' | 'Other';
 *   }>
 * }
 *
 * Validation performed server-side:
 *   - Missing student_code or full_name → 400
 *   - Duplicate student_code within the submitted list → 400
 *   - sex value not in ('M','F','Other') → 400
 *
 * On success returns { saved: number, students: [...] }.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;
  const teacherId = guard.user.id;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { year, grade, section, students } = body as {
    year:     string;
    grade:    string;
    section:  string;
    students: Array<{
      student_code: string;
      full_name:    string;
      roll_number?: string | null;
      sex?:         string | null;
    }>;
  };

  if (!year?.trim() || !grade?.trim() || !section?.trim()) {
    return NextResponse.json(
      { error: 'year, grade, and section are required' },
      { status: 400 }
    );
  }
  if (!Array.isArray(students) || students.length === 0) {
    return NextResponse.json(
      { error: 'students array is required and must not be empty' },
      { status: 400 }
    );
  }

  const VALID_SEX = new Set(['M', 'F', 'Other']);

  // ── Per-row validation ─────────────────────────────────────────────────────
  const errors: string[] = [];
  const seenCodes = new Set<string>();

  students.forEach((s, i) => {
    const rowNum = i + 1;
    if (!s.student_code?.trim()) {
      errors.push(`Row ${rowNum}: Student ID is required.`);
    } else {
      const key = s.student_code.trim().toLowerCase();
      if (seenCodes.has(key)) {
        errors.push(`Row ${rowNum}: Duplicate Student ID "${s.student_code}".`);
      }
      seenCodes.add(key);
    }
    if (!s.full_name?.trim()) {
      errors.push(`Row ${rowNum}: Full name is required.`);
    }
    if (s.sex && !VALID_SEX.has(s.sex)) {
      errors.push(`Row ${rowNum}: Sex must be M, F, or Other (got "${s.sex}").`);
    }
  });

  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  // ── Build upsert rows ──────────────────────────────────────────────────────
  const upsertRows = students.map((s) => ({
    school_id:     teacherId,
    student_code:  s.student_code.trim(),
    full_name:     s.full_name.trim(),
    roll_number:   s.roll_number?.trim() || null,
    sex:           s.sex || null,
    grade:         grade.trim(),
    section:       section.trim(),
    academic_year: year.trim(),
    // portal_status left untouched by upsert — it may already be 'active' etc.
  }));

  const service = createServiceClient();

  // onConflict: (school_id, student_code) — the existing unique constraint.
  // We update identity fields but intentionally do NOT touch auth_user_id,
  // email, or portal_status — those belong to the portal sign-up flow.
  const { data: saved, error: upsertErr } = await (service as any)
    .from('students')
    .upsert(upsertRows, {
      onConflict:       'school_id,student_code',
      ignoreDuplicates: false,
    })
    .select(
      'id, student_code, full_name, roll_number, sex, portal_status, auth_user_id, parent_name, parent_phone, created_at'
    ) as { data: any[] | null; error: any };

  if (upsertErr) {
    console.error('[roster POST] upsert:', upsertErr.message);
    return NextResponse.json(
      { error: 'Failed to save roster: ' + upsertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { saved: saved?.length ?? 0, students: saved ?? [] },
    { status: 200 }
  );
}

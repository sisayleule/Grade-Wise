import { NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';

/**
 * GET /api/student/me
 *
 * Returns the canonical students row for the currently authenticated student.
 * Uses the anon/cookie client — the existing RLS policy
 * "students: student read own row" (auth_user_id = auth.uid()) is sufficient.
 *
 * No service-role bypass — respects Phase 2 RLS exactly.
 *
 * Response shape:
 *   { student: { id, student_code, full_name, grade, section, academic_year,
 *                school_id, portal_status } }
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: student, error } = await supabase
    .from('students')
    .select(
      'id, student_code, full_name, grade, section, academic_year, school_id, portal_status'
    )
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[student/me GET]', error.message);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }

  if (!student) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  return NextResponse.json({ student });
}

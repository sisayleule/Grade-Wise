/**
 * GET /api/students
 *
 * Returns all canonical students for the authenticated teacher's school.
 * Optional query params: grade, section, academic_year
 *
 * This is the data source for the "Create Portal Account" UI on the
 * Students page — it shows which students already have portal accounts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApproved } from 'lib/supabase/requireApproved';
import { createServiceClient } from 'lib/supabase/service';

export async function GET(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;
  const teacherId = guard.user.id;

  const { searchParams } = request.nextUrl;
  const grade        = searchParams.get('grade');
  const section      = searchParams.get('section');
  const academicYear = searchParams.get('academic_year');

  const service = createServiceClient();

  let q = (service as any)
    .from('students')
    .select('id, student_code, full_name, grade, section, academic_year, email, portal_status, created_at')
    .eq('school_id', teacherId)
    .order('full_name', { ascending: true });

  if (grade)        q = q.eq('grade', grade);
  if (section)      q = q.eq('section', section);
  if (academicYear) q = q.eq('academic_year', academicYear);

  const { data, error } = await q;

  if (error) {
    console.error('[students GET]', error.message);
    return NextResponse.json({ error: 'Failed to load students' }, { status: 500 });
  }

  return NextResponse.json({ students: data ?? [] });
}

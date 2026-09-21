import { NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';

/**
 * GET /api/student/school-profile
 *
 * Returns the school's public display fields needed for report headers:
 * name, teacher, principal, logo, footer, period_system.
 *
 * Students have NO select policy on public.schools (by design — they must not
 * be able to read Gemini keys, approval status, school_code, etc.).
 * This endpoint reads only the safe display columns via the service-role client,
 * after verifying the student is authenticated and has a valid canonical row.
 *
 * The school_id is taken from the student's own `students` row (RLS-enforced)
 * rather than from any client-supplied parameter, so there is no way for a
 * student to read another school's profile.
 *
 * Response shape:
 *   { school: { name, teacher, principal, logo, footer, period_system } }
 */
export async function GET() {
  const supabase = await createClient();

  // ── 1. Verify session ─────────────────────────────────────────────────────
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Get student's school_id via RLS (auth_user_id = auth.uid()) ─────────
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('school_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr || !studentRow) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  // ── 3. Read only safe display columns via service client ──────────────────
  // Service client is used solely because students have no schools RLS policy.
  // The school_id comes from the student's own row — no privilege escalation.
  const service = createServiceClient();
  const { data: school, error: schoolErr } = await (service as any)
    .from('schools')
    .select('name, teacher, principal, logo, footer, period_system')
    .eq('id', studentRow.school_id)
    .single() as { data: {
      name: string;
      teacher: string;
      principal: string;
      logo: string | null;
      footer: string;
      period_system: string;
    } | null; error: any };

  if (schoolErr || !school) {
    console.error('[student/school-profile GET]', schoolErr?.message);
    return NextResponse.json({ error: 'School profile not found' }, { status: 404 });
  }

  return NextResponse.json({
    school: {
      name:          school.name          ?? '',
      teacher:       school.teacher       ?? '',
      principal:     school.principal     ?? '',
      logo:          school.logo          ?? '',
      footer:        school.footer        ?? '',
      period_system: school.period_system ?? 'semester',
    },
  });
}

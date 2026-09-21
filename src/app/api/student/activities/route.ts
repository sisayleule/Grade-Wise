import { NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';

/**
 * GET /api/student/activities
 *
 * Returns all published activity scores for the authenticated student.
 *
 * Security:
 *   - Students row verified via RLS (auth_user_id = auth.uid())
 *   - activity_scores read via anon client — RLS policy
 *     "activity_scores: student read own published" enforces:
 *       (a) is_published = true
 *       (b) student_ref_id → students.auth_user_id = auth.uid()
 *   - Activity metadata (name, subject, date, teacher_comment, max_score)
 *     read via service client since students have no policy on activities.
 *     school_id is sourced from the student's own row — no privilege escalation.
 *
 * Response:
 *   {
 *     activities: Array<{
 *       score_id:        string;
 *       activity_id:     string;
 *       activity_type:   string;
 *       name:            string;
 *       subject:         string;
 *       activity_date:   string | null;
 *       max_score:       number;
 *       teacher_comment: string | null;
 *       score:           number | null;
 *       published_at:    string;    // activity updated_at
 *     }>
 *   }
 */
export async function GET() {
  const supabase = await createClient();

  // ── 1. Verify student session ─────────────────────────────────────────────
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Load student's canonical row (RLS: auth_user_id = auth.uid()) ──────
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr || !studentRow) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  // ── 3. Load published scores via RLS ──────────────────────────────────────
  // The "activity_scores: student read own published" policy enforces both
  // is_published = true AND student_ref_id ownership.
  const { data: scoreRows, error: scoreErr } = await supabase
    .from('activity_scores')
    .select('id, activity_id, score')
    .eq('student_ref_id', studentRow.id)
    .eq('is_published', true) as { data: any[] | null; error: any };

  if (scoreErr) {
    console.error('[student/activities GET] scores:', scoreErr.message);
    return NextResponse.json({ error: 'Failed to load activities' }, { status: 500 });
  }

  if (!scoreRows?.length) {
    return NextResponse.json({ activities: [] });
  }

  // ── 4. Load activity metadata via service client ──────────────────────────
  // Students have no RLS policy on activities — we fetch using the service
  // role, scoped to the student's own school_id.
  const activityIds = [...new Set(scoreRows.map((r) => r.activity_id as string))];
  const service = createServiceClient();

  const { data: activityRows, error: actErr } = await (service as any)
    .from('activities')
    .select('id, activity_type, name, subject, activity_date, max_score, teacher_comment, updated_at')
    .eq('school_id', studentRow.school_id)
    .in('id', activityIds) as { data: any[] | null; error: any };

  if (actErr) {
    console.error('[student/activities GET] activities:', actErr.message);
    return NextResponse.json({ error: 'Failed to load activity details' }, { status: 500 });
  }

  // ── 5. Merge and sort ─────────────────────────────────────────────────────
  const actMap = new Map<string, any>();
  for (const a of activityRows ?? []) actMap.set(a.id, a);

  const activities = scoreRows
    .map((s) => {
      const a = actMap.get(s.activity_id);
      if (!a) return null;
      return {
        score_id:        s.id,
        activity_id:     a.id,
        activity_type:   a.activity_type,
        name:            a.name,
        subject:         a.subject,
        activity_date:   a.activity_date,
        max_score:       Number(a.max_score),
        teacher_comment: a.teacher_comment ?? null,
        score:           s.score !== null && s.score !== undefined ? Number(s.score) : null,
        published_at:    a.updated_at,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      // Most recent activity date first
      const da = a.activity_date ?? a.published_at ?? '';
      const db = b.activity_date ?? b.published_at ?? '';
      return db.localeCompare(da);
    });

  return NextResponse.json({ activities });
}

import { NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { buildAnnualFromBatches } from 'lib/grades';
import type { Batch } from 'lib/grades';

/**
 * GET /api/student/results
 *
 * Returns every published period visible to the authenticated student, plus a
 * Full Year synthetic entry when all required periods for the school's
 * period_system are published.
 *
 * ── Query scope fix (Phase 4 bug fix) ────────────────────────────────────────
 * Previous version queried result_batches by school_id alone.  This caused
 * cross-class visibility: when a teacher published a batch to "all students"
 * (published_student_ids = []), the RLS policy allowed any authenticated
 * student at that school to read ANY batch, regardless of grade/section.
 *
 * The fix is a two-layer filter:
 *
 *   Layer 1 — result_students join:
 *     Fetch only the batch IDs where this student's own result_students row
 *     (via student_ref_id = studentRow.id) actually exists.  This is the
 *     definitive proof that a batch contains this specific student.  A batch
 *     from another class will never have a result_students row for this
 *     student's UUID, so it is excluded at the source.
 *
 *   Layer 2 — grade + section filter on result_batches:
 *     As a second defence, filter batches to match this student's own
 *     grade and section from their canonical students row.
 *
 * Both layers together mean a student can only ever see batches that:
 *   (a) contain a score row linked to their exact students.id, AND
 *   (b) are from their own grade + section
 *
 * The migration-013 RLS policy (publish_status, school, published_student_ids)
 * still runs as a third layer enforced at the database level.
 *
 * Security model (unchanged):
 *   - result_batches  : migration-013 RLS (published + school + selectivity)
 *   - result_students : Phase-2 RLS (student_ref_id → own students row)
 *   - students        : Phase-2 RLS (auth_user_id = auth.uid())
 *   No service-role bypass on any result table.
 *
 * Response shape:
 *   {
 *     periods: Array<{
 *       batchId:      string;
 *       semester:     string;
 *       year:         string;
 *       grade:        string;
 *       section:      string;
 *       publishedAt:  string;
 *       subjectCount: number;
 *     }>
 *   }
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

  // ── 2. Load the student's own canonical row ───────────────────────────────
  // RLS: "students: student read own row" (auth_user_id = auth.uid())
  // .maybeSingle() is safe because migration-014 added a partial unique index
  // on auth_user_id, so at most one non-null row can match.
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, student_code, school_id, grade, section, academic_year')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr) {
    console.error('[student/results GET] students:', studentErr.message);
    return NextResponse.json({ error: 'Failed to load student record' }, { status: 500 });
  }
  if (!studentRow) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  // ── 3. Find batch IDs where this student has a result_students row ────────
  // Layer 1: only batches this student personally appears in.
  // RLS "result_students: student read own" enforces student_ref_id match.
  const { data: myScoreRows, error: scoreErr } = await supabase
    .from('result_students')
    .select('batch_id')
    .eq('student_ref_id', studentRow.id);

  if (scoreErr) {
    console.error('[student/results GET] result_students:', scoreErr.message);
    return NextResponse.json({ error: 'Failed to load result records' }, { status: 500 });
  }

  const myBatchIds = (myScoreRows ?? []).map((r) => r.batch_id as string);

  // No score rows → definitely no results to show
  if (myBatchIds.length === 0) {
    return NextResponse.json({ periods: [] });
  }

  // ── 4. Load published batches — scoped to this student's exact class ──────
  // Layer 2: grade + section must match this student's own canonical row.
  // The migration-013 RLS policy (publish_status, school, published_student_ids)
  // is the third layer, enforced transparently by Postgres.
  const { data: batches, error: batchErr } = await supabase
    .from('result_batches')
    .select('id, semester, academic_year, grade, section, subjects, updated_at')
    .eq('school_id', studentRow.school_id)
    .eq('grade',     studentRow.grade)
    .eq('section',   studentRow.section)
    .in('id', myBatchIds)
    .order('updated_at', { ascending: true });

  if (batchErr) {
    console.error('[student/results GET] batches:', batchErr.message);
    return NextResponse.json({ error: 'Failed to load results' }, { status: 500 });
  }

  const realBatches = batches ?? [];

  // ── 5. Build the periods list ──────────────────────────────────────────────
  const periods = realBatches.map((b) => ({
    batchId:      b.id as string,
    semester:     b.semester as string,
    year:         b.academic_year as string,
    grade:        b.grade as string,
    section:      b.section as string,
    publishedAt:  b.updated_at as string,
    subjectCount: Array.isArray(b.subjects) ? (b.subjects as string[]).length : 0,
  }));

  // ── 6. Detect complete Full Year sets ─────────────────────────────────────
  // Group by (year, grade, section) — all values now guaranteed to match this
  // student's own class since we filtered above.
  const yearKey = (b: typeof realBatches[0]) =>
    `${b.academic_year}||${b.grade}||${b.section}`;

  const grouped = new Map<string, typeof realBatches>();
  for (const b of realBatches) {
    const k = yearKey(b);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(b);
  }

  const SEMESTER_SET = new Set(['Semester 1', 'Semester 2']);
  const QUARTER_SET  = new Set(['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']);

  for (const [, group] of grouped) {
    const semesters = new Set(group.map((b) => b.semester as string));

    const isSemesterComplete =
      [...SEMESTER_SET].every((s) => semesters.has(s)) &&
      group.filter((b) => SEMESTER_SET.has(b.semester as string)).length === 2;

    const isQuarterComplete =
      [...QUARTER_SET].every((s) => semesters.has(s)) &&
      group.filter((b) => QUARTER_SET.has(b.semester as string)).length === 4;

    if (isSemesterComplete || isQuarterComplete) {
      const ordered = isQuarterComplete
        ? ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'].map(
            (s) => group.find((b) => b.semester === s)!
          )
        : ['Semester 1', 'Semester 2'].map(
            (s) => group.find((b) => b.semester === s)!
          );

      const publishedAt = ordered.reduce(
        (latest, b) =>
          new Date(b.updated_at as string) > new Date(latest)
            ? (b.updated_at as string)
            : latest,
        ordered[0].updated_at as string
      );

      const firstBatch = ordered[0];
      periods.push({
        batchId:      ordered.map((b) => b.id).join('|'),
        semester:     'Full Year',
        year:         firstBatch.academic_year as string,
        grade:        firstBatch.grade as string,
        section:      firstBatch.section as string,
        publishedAt,
        subjectCount: Array.from(
          new Set(
            ordered.flatMap((b) =>
              Array.isArray(b.subjects) ? (b.subjects as string[]) : []
            )
          )
        ).length,
      });
    }
  }

  // ── 7. Sort: year asc, then canonical period order ─────────────────────────
  const PERIOD_ORDER = [
    'Semester 1', 'Semester 2',
    'Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4',
    'Full Year',
  ];
  periods.sort((a, b) => {
    if (a.year !== b.year) return a.year.localeCompare(b.year);
    return PERIOD_ORDER.indexOf(a.semester) - PERIOD_ORDER.indexOf(b.semester);
  });

  return NextResponse.json({ periods });
}

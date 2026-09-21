import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { buildAnnualFromBatches, computeResults, getLetterGrade, statusFor } from 'lib/grades';
import type { Batch, Result } from 'lib/grades';

/**
 * GET /api/student/results/[batchId]
 *
 * Returns the full result detail for one published period.
 * batchId may be:
 *   - A single UUID — one real batch
 *   - Pipe-separated UUIDs (e.g. "uuid1|uuid2") — Full Year synthetic view
 *
 * Security:
 *   - result_batches  : migration-013 RLS (published + school match + selectivity)
 *   - result_students : Phase-2 RLS (student_ref_id → own students row)
 *   Both policies are enforced server-side via the anon/cookie client.
 *
 * Response shape:
 *   {
 *     result: {
 *       batchId:     string;
 *       semester:    string;
 *       year:        string;
 *       grade:       string;
 *       section:     string;
 *       subjects:    string[];
 *       publishedAt: string;
 *       student: {
 *         id:          string;   // student_code
 *         name:        string;
 *         scores:      Record<string, number | string>;
 *         total:       number;
 *         maximum:     number;
 *         average:     number;
 *         percentage:  number;
 *         rank:        number;
 *         status:      string;
 *         letterGrade: string;
 *       }
 *     }
 *   }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const supabase = await createClient();

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Load student canonical row ─────────────────────────────────────────
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, student_code, school_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr || !studentRow) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  const { batchId } = await params;

  // ── 3. Resolve single vs Full-Year batchId ─────────────────────────────────
  const batchIds = batchId.split('|').filter(Boolean);
  if (batchIds.length === 0) {
    return NextResponse.json({ error: 'Invalid batchId' }, { status: 400 });
  }

  // ── 4. Load each batch through RLS ────────────────────────────────────────
  // The migration-013 policy verifies publish_status, school, and selectivity.
  // If a batch ID is invalid or this student isn't published for it, RLS
  // returns no row and we return 404.
  const batchesResult = await Promise.all(
    batchIds.map((id) =>
      supabase
        .from('result_batches')
        .select('id, semester, academic_year, grade, section, subjects, updated_at')
        .eq('id', id)
        .eq('school_id', studentRow.school_id)
        .maybeSingle()
    )
  );

  const batches = batchesResult.map((r) => r.data);
  if (batches.some((b) => !b)) {
    // At least one batch was blocked by RLS or doesn't exist
    return NextResponse.json({ error: 'Result not found or not published' }, { status: 404 });
  }

  // ── 5. Load this student's result_students rows for each batch ─────────────
  // Phase-2 RLS (student_ref_id → own students row) enforces row-level access.
  const studentRowsResult = await Promise.all(
    batchIds.map((id) =>
      supabase
        .from('result_students')
        .select('student_id, student_name, scores, total, average, percentage, rank')
        .eq('batch_id', id)
        .eq('student_ref_id', studentRow.id)
        .maybeSingle()
    )
  );

  const studentRows = studentRowsResult.map((r) => r.data);
  if (studentRows.some((r) => !r)) {
    return NextResponse.json(
      { error: 'Your score record was not found in this batch' },
      { status: 404 }
    );
  }

  // ── 6. Build result ────────────────────────────────────────────────────────
  if (batchIds.length === 1) {
    // Single period
    const batch  = batches[0]!;
    const sRow   = studentRows[0]!;
    const subjects: string[] = Array.isArray(batch.subjects) ? (batch.subjects as string[]) : [];
    const pct    = Number(sRow.percentage);

    const result = {
      batchId:     batch.id as string,
      semester:    batch.semester as string,
      year:        batch.academic_year as string,
      grade:       batch.grade as string,
      section:     batch.section as string,
      subjects,
      publishedAt: batch.updated_at as string,
      student: {
        id:          sRow.student_id as string,
        name:        sRow.student_name as string,
        scores:      (sRow.scores ?? {}) as Record<string, number | string>,
        total:       Number(sRow.total),
        maximum:     subjects.length * 100,
        average:     Number(sRow.average),
        percentage:  pct,
        rank:        Number(sRow.rank),
        status:      statusFor(pct),
        letterGrade: getLetterGrade(pct),
      },
    };

    return NextResponse.json({ result });
  }

  // ── 7. Full Year — merge across batches ────────────────────────────────────
  // Build minimal Batch objects compatible with buildAnnualFromBatches.
  const partialBatches: Batch[] = batchIds.map((id, i) => {
    const batch   = batches[i]!;
    const sRow    = studentRows[i]!;
    const subjects: string[] = Array.isArray(batch.subjects) ? (batch.subjects as string[]) : [];
    const pct = Number(sRow.percentage);

    return {
      id,
      year:      batch.academic_year as string,
      className: `${batch.grade}${batch.section}`,
      semester:  batch.semester as string,
      subjects,
      createdAt: batch.updated_at as string,
      grade:     batch.grade as string,
      section:   batch.section as string,
      rows: [
        {
          id:          sRow.student_id as string,
          name:        sRow.student_name as string,
          scores:      (sRow.scores ?? {}) as Record<string, number | string>,
          total:       Number(sRow.total),
          maximum:     subjects.length * 100,
          average:     Number(sRow.average),
          percentage:  pct,
          rank:        Number(sRow.rank),
          status:      statusFor(pct),
          letterGrade: getLetterGrade(pct),
        },
      ],
    };
  });

  const annual = buildAnnualFromBatches(partialBatches);
  if (!annual) {
    return NextResponse.json({ error: 'Failed to compute Full Year result' }, { status: 500 });
  }

  const annualStudent = annual.rows[0];
  if (!annualStudent) {
    return NextResponse.json({ error: 'No result data in Full Year' }, { status: 404 });
  }

  const firstBatch = batches[0]!;
  const publishedAt = batchIds.reduce((latest, _, i) => {
    const d = batches[i]!.updated_at as string;
    return new Date(d) > new Date(latest) ? d : latest;
  }, batches[0]!.updated_at as string);

  const result = {
    batchId:     batchId,
    semester:    'Full Year',
    year:        firstBatch.academic_year as string,
    grade:       firstBatch.grade as string,
    section:     firstBatch.section as string,
    subjects:    annual.subjects,
    publishedAt,
    student: {
      id:          annualStudent.id,
      name:        annualStudent.name,
      scores:      annualStudent.scores,
      total:       annualStudent.total,
      maximum:     annualStudent.maximum,
      average:     annualStudent.average,
      percentage:  annualStudent.percentage,
      rank:        annualStudent.rank,
      status:      annualStudent.status,
      letterGrade: annualStudent.letterGrade,
    },
  };

  return NextResponse.json({ result });
}

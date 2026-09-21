import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';
import { computeResults } from 'lib/grades';
import { requireApproved } from 'lib/supabase/requireApproved';

/**
 * GET /api/batches
 *
 * Query params (all optional):
 *   year, grade, section, semester
 *
 * Returns all result_batches for the logged-in school, with their students.
 * When all four params are supplied, returns exactly one batch (or null).
 * When only some params are supplied, returns all matching batches.
 * When none are supplied, returns all batches for the school (for selectors).
 */
export async function GET(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const userId = guard.user.id;

  const { searchParams } = request.nextUrl;
  const year     = searchParams.get('year');
  const grade    = searchParams.get('grade');
  const section  = searchParams.get('section');
  const semester = searchParams.get('semester');

  // Build the query — always filter by school
  let batchQuery = supabase
    .from('result_batches')
    .select('*, result_students(*)')
    .eq('school_id', userId)
    .order('created_at', { ascending: false });

  if (year)     batchQuery = batchQuery.eq('academic_year', year);
  if (grade)    batchQuery = batchQuery.eq('grade', grade);
  if (section)  batchQuery = batchQuery.eq('section', section);
  if (semester && semester !== 'Full Year') {
    batchQuery = batchQuery.eq('semester', semester);
  }

  const { data: batches, error } = await batchQuery;
  if (error) {
    console.error('[batches GET]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reshape into the Batch type the frontend already understands
  const shaped = (batches || []).map(shapeBatch);
  return NextResponse.json({ batches: shaped });
}

/**
 * POST /api/batches
 *
 * Body: { year, grade, section, semester, fileName, subjects, rows, force }
 *   - rows: ScoreRow[] (validated, pre-computeResults)
 *   - force: boolean — if true, overwrite existing batch for this combination
 *
 * Returns { batch } on success, or { conflict: true, existing } when a batch
 * already exists and force is not set.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const userId = guard.user.id;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { year, grade, section, semester, fileName, subjects, rows, force } = body as {
    year: string;
    grade: string;
    section: string;
    semester: string;
    fileName: string;
    subjects: string[];
    rows: any[];
    force?: boolean;
  };

  if (!year || !grade || !section || !semester || !subjects?.length || !rows?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const VALID_PERIODS = ['Semester 1', 'Semester 2', 'Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'];
  if (!VALID_PERIODS.includes(semester)) {
    return NextResponse.json({ error: `semester must be one of: ${VALID_PERIODS.join(', ')}` }, { status: 400 });
  }

  // ── Duplicate check ──────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('result_batches')
    .select('id, academic_year, grade, section, semester, created_at, uploaded_file_name')
    .eq('school_id', userId)
    .eq('academic_year', year)
    .eq('grade', grade)
    .eq('section', section)
    .eq('semester', semester)
    .maybeSingle();

  if (existing && !force) {
    // Tell the frontend there's a conflict — let it show the confirmation dialog
    return NextResponse.json({ conflict: true, existing }, { status: 409 });
  }

  // ── Compute ranked results ────────────────────────────────────────────────
  const computed = computeResults(rows, subjects);

  // ── Delete old batch if replacing ─────────────────────────────────────────
  if (existing) {
    const { error: delErr } = await supabase
      .from('result_batches')
      .delete()
      .eq('id', existing.id);
    if (delErr) {
      console.error('[batches POST] delete old batch:', delErr.message);
      return NextResponse.json({ error: 'Failed to replace existing batch' }, { status: 500 });
    }
  }

  // ── Insert new batch row ───────────────────────────────────────────────────
  const { data: batch, error: batchErr } = await supabase
    .from('result_batches')
    .insert({
      school_id:          userId,
      academic_year:      year,
      grade,
      section,
      semester,
      uploaded_file_name: fileName || '',
      subjects:           subjects,
      num_students:       computed.length,
      processing_status:  'complete',
      publish_status:     'processed',   // Phase 3: new batches start as 'processed', not 'published'
    } as any)
    .select()
    .single();

  if (batchErr || !batch) {
    console.error('[batches POST] insert batch:', batchErr?.message);
    return NextResponse.json({ error: 'Failed to save batch' }, { status: 500 });
  }

  // ── Match result rows against the class roster ────────────────────────────
  //
  // Phase 5: the old canonicalUpserts auto-creation path has been REMOVED.
  // Students must already exist in the roster (public.students) for this
  // exact (school_id, grade, section) combination before a result batch can
  // reference them. This prevents cross-class identity leakage.
  //
  // For each result row we look up the existing students row by
  // (school_id, student_code). If found AND the row's grade+section matches
  // the batch being saved, we set student_ref_id. If NOT found, we record a
  // warning. Warnings do NOT block the save — the result row is still inserted
  // with student_ref_id = null (same as before), so the teacher's data is
  // never lost. The warning is returned in the response so the frontend can
  // surface it without failing the whole operation.
  //
  // If EVERY row is unmatched (the roster hasn't been uploaded yet), we
  // return a hard error prompting the teacher to set up the roster first.
  // This threshold keeps the old "upload results before roster" schools
  // working while nudging new schools toward the correct workflow.
  const service = createServiceClient();

  // Fetch all existing roster rows for this exact class in one query.
  const resultCodes = computed.map((r) => r.id || '').filter(Boolean);
  const { data: rosterRows } = await (service as any)
    .from('students')
    .select('id, student_code, grade, section')
    .eq('school_id', userId)
    .in('student_code', resultCodes) as { data: Array<{ id: string; student_code: string; grade: string; section: string }> | null };

  // Build code → canonical UUID map, only for rows whose grade+section match.
  const codeToRefId = new Map<string, string>();
  if (rosterRows) {
    for (const s of rosterRows) {
      // Exact match on grade AND section: prevents linking a Grade 8A result
      // row to a Grade 8B roster entry that happens to share the same code.
      if (s.grade.trim() === grade.trim() && s.section.trim() === section.trim()) {
        codeToRefId.set(s.student_code, s.id);
      }
    }
  }

  // Identify unmatched student codes
  const unmatchedCodes = computed
    .map((r) => r.id || '')
    .filter((code) => code && !codeToRefId.has(code));

  // Hard block only when zero rows matched — this indicates the roster has
  // not been set up at all.  A partial mismatch (some matched, some not) is
  // allowed with a warning so that OCR typos don't block the whole upload.
  if (unmatchedCodes.length === computed.length) {
    // Roll back the batch row
    await supabase.from('result_batches').delete().eq('id', batch.id);
    return NextResponse.json(
      {
        error:
          `No students in this result sheet are in the class roster for ${grade}${section}. ` +
          `Go to Class Roster → ${grade} ${section} and add these students first, ` +
          `then re-upload the result sheet.`,
        unmatched_codes: unmatchedCodes.slice(0, 10),
      },
      { status: 422 }
    );
  }

  // Build per-row roster warnings for partial mismatches
  const rosterWarnings: string[] = unmatchedCodes.map(
    (code) =>
      `Student ID "${code}" was not found in the class roster for ${grade}${section} — ` +
      `add them to the roster, or check for a typo.`
  );

  // Step B: insert result_students with student_ref_id set where available
  const studentRows = computed.map((r) => ({
    batch_id:        batch.id,
    student_id:      r.id || '',
    student_name:    r.name || '',
    scores:          r.scores,
    total:           r.total,
    average:         r.average,
    percentage:      r.percentage,
    rank:            r.rank,
    student_ref_id:  codeToRefId.get(r.id || '') ?? null,
  }));

  const { error: studErr } = await supabase
    .from('result_students')
    .insert(studentRows as any);  // cast: student_ref_id not yet in generated types

  if (studErr) {
    console.error('[batches POST] insert students:', studErr.message);
    // Roll back the batch row to avoid a ghost batch with no students
    await supabase.from('result_batches').delete().eq('id', batch.id);
    return NextResponse.json({ error: 'Failed to save student results' }, { status: 500 });
  }

  // Fetch back with students attached so the response is shaped correctly
  const { data: full } = await supabase
    .from('result_batches')
    .select('*, result_students(*)')
    .eq('id', batch.id)
    .single();

  // Return the shaped batch plus any roster warnings so the frontend can
  // display them as an amber notice without treating the save as a failure.
  const response: any = { batch: shapeBatch(full) };
  if (rosterWarnings.length) response.roster_warnings = rosterWarnings;
  return NextResponse.json(response, { status: 201 });
}

// ── Shared shaper ──────────────────────────────────────────────────────────
// Converts a DB row (with nested result_students) into the Batch type used by
// the frontend, which matches the existing { id, year, className, semester,
// subjects, rows, grade, section, createdAt, fileName } shape.
function shapeBatch(raw: any) {
  if (!raw) return null;
  const students: any[] = raw.result_students || [];

  // Sort by rank for consistent ordering
  students.sort((a, b) => a.rank - b.rank);

  const rows = students.map((s) => ({
    id:         s.student_id,
    name:       s.student_name,
    scores:     s.scores || {},
    total:      Number(s.total),
    maximum:    (raw.subjects?.length || 0) * 100,
    average:    Number(s.average),
    percentage: Number(s.percentage),
    rank:       s.rank,
    status:     statusFor(Number(s.percentage)),
  }));

  return {
    id:                   raw.id,
    year:                 raw.academic_year,
    grade:                raw.grade,
    section:              raw.section,
    className:            `${raw.grade}${raw.section}`,
    semester:             raw.semester,
    subjects:             raw.subjects || [],
    rows,
    createdAt:            raw.created_at,
    updatedAt:            raw.updated_at,
    fileName:             raw.uploaded_file_name,
    publishStatus:        raw.publish_status ?? 'published',
    publishedStudentIds:  Array.isArray(raw.published_student_ids) ? raw.published_student_ids : [],
  };
}

function statusFor(p: number) {
  return p >= 80 ? 'Excellent'
    : p >= 70 ? 'Very Good'
    : p >= 60 ? 'Good'
    : p >= 50 ? 'Satisfactory'
    : 'Needs Support';
}

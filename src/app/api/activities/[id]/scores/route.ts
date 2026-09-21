import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';
import { requireApproved } from 'lib/supabase/requireApproved';

/**
 * GET /api/activities/[id]/scores
 *
 * Returns the activity with all roster students for its class, with their
 * current score if one exists. Roster students without a score row are included
 * with score = null so the score entry table always shows a full class list.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const service  = createServiceClient();
  const { id }   = await params;
  const userId   = guard.user.id;

  // Load the activity
  const { data: activity, error: actErr } = await supabase
    .from('activities')
    .select('id, name, subject, activity_type, academic_year, grade, section, max_score, description, teacher_comment, publish_status, activity_date')
    .eq('id', id)
    .eq('school_id', userId)
    .single() as { data: any; error: any };

  if (actErr || !activity) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  }

  // Load all roster students for this class
  const { data: rosterStudents, error: rosterErr } = await (service as any)
    .from('students')
    .select('id, student_code, full_name, roll_number')
    .eq('school_id', userId)
    .eq('academic_year', activity.academic_year)
    .eq('grade',         activity.grade)
    .eq('section',       activity.section)
    .order('roll_number', { ascending: true,  nullsFirst: false })
    .order('full_name',   { ascending: true }) as { data: any[] | null; error: any };

  if (rosterErr) {
    console.error('[activities scores GET] roster:', rosterErr.message);
    return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 });
  }

  // Load existing score rows for this activity
  const { data: existingScores, error: scoreErr } = await supabase
    .from('activity_scores')
    .select('id, student_ref_id, score, is_published')
    .eq('activity_id', id) as { data: any[] | null; error: any };

  if (scoreErr) {
    console.error('[activities scores GET] scores:', scoreErr.message);
    return NextResponse.json({ error: 'Failed to load scores' }, { status: 500 });
  }

  // Merge: every roster student gets a score entry (null if not yet scored)
  const scoreMap = new Map<string, { id: string; score: number | null; is_published: boolean }>();
  for (const s of existingScores ?? []) {
    scoreMap.set(s.student_ref_id, {
      id:           s.id,
      score:        s.score !== null && s.score !== undefined ? Number(s.score) : null,
      is_published: s.is_published,
    });
  }

  const students = (rosterStudents ?? []).map((st: any) => {
    const existing = scoreMap.get(st.id);
    return {
      student_ref_id: st.id,
      student_code:   st.student_code,
      full_name:      st.full_name,
      roll_number:    st.roll_number,
      score_id:       existing?.id         ?? null,
      score:          existing?.score      ?? null,
      is_published:   existing?.is_published ?? false,
    };
  });

  return NextResponse.json({ activity, students });
}

/**
 * POST /api/activities/[id]/scores
 *
 * Saves (upserts) scores for one activity.  Accepts bulk score updates from
 * the score entry table or a CSV import.
 *
 * Body: {
 *   scores: Array<{
 *     student_ref_id: string;
 *     score: number | null;   // null = clear the score
 *   }>
 * }
 *
 * Validates that every score is within [0, max_score].
 * Does NOT publish — call PATCH /api/activities/[id] with { publish_status }
 * after reviewing scores.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const { id }   = await params;
  const userId   = guard.user.id;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.scores)) {
    return NextResponse.json({ error: 'scores array is required' }, { status: 400 });
  }

  // Verify ownership + get max_score
  const { data: activity, error: actErr } = await supabase
    .from('activities')
    .select('id, max_score')
    .eq('id', id)
    .eq('school_id', userId)
    .single() as { data: { id: string; max_score: number } | null; error: any };

  if (actErr || !activity) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  }

  const maxScore = Number(activity.max_score);

  // Validate scores
  const errors: string[] = [];
  const upsertRows: Array<{ activity_id: string; student_ref_id: string; score: number | null }> = [];

  for (const entry of body.scores as any[]) {
    if (!entry.student_ref_id) {
      errors.push('Each score entry must have student_ref_id.');
      continue;
    }
    if (entry.score !== null && entry.score !== undefined) {
      const v = Number(entry.score);
      if (!Number.isFinite(v)) {
        errors.push(`Score for student ${entry.student_ref_id} is not a valid number.`);
        continue;
      }
      if (v < 0) {
        errors.push(`Score for student ${entry.student_ref_id} cannot be negative.`);
        continue;
      }
      if (v > maxScore) {
        errors.push(`Score ${v} exceeds max_score ${maxScore} for student ${entry.student_ref_id}.`);
        continue;
      }
      upsertRows.push({ activity_id: id, student_ref_id: entry.student_ref_id, score: v });
    } else {
      upsertRows.push({ activity_id: id, student_ref_id: entry.student_ref_id, score: null });
    }
  }

  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  if (!upsertRows.length) {
    return NextResponse.json({ ok: true, saved: 0 });
  }

  // Upsert on (activity_id, student_ref_id)
  const { error: upsertErr } = await supabase
    .from('activity_scores')
    .upsert(upsertRows as any, {
      onConflict:       'activity_id,student_ref_id',
      ignoreDuplicates: false,
    });

  if (upsertErr) {
    console.error('[activities scores POST]', upsertErr.message);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: upsertRows.length });
}

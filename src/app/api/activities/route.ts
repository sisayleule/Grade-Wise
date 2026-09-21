import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { requireApproved } from 'lib/supabase/requireApproved';
import { ACTIVITY_TYPES } from 'lib/activityTypes';
export type { ActivityType } from 'lib/activityTypes';

/**
 * GET /api/activities?year=…&grade=…&section=…
 *
 * Returns all activities for the teacher's school filtered by class selectors.
 * Each activity includes:
 *   published_count — number of activity_scores rows where is_published = true
 *   scored_count    — number of activity_scores rows where score IS NOT NULL
 * These are used by the list view to show "X of N published" for partial
 * publishes, rather than a binary Draft/Published label.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const userId = guard.user.id;
  const { searchParams } = request.nextUrl;
  const year    = searchParams.get('year')?.trim()    ?? '';
  const grade   = searchParams.get('grade')?.trim()   ?? '';
  const section = searchParams.get('section')?.trim() ?? '';

  let q = supabase
    .from('activities')
    .select(`
      *,
      scored:activity_scores!activity_id(count),
      published:activity_scores!activity_id(count)
    `)
    .eq('school_id', userId)
    .order('activity_date', { ascending: false })
    .order('created_at',    { ascending: false });

  if (year)    q = q.eq('academic_year', year);
  if (grade)   q = q.eq('grade', grade);
  if (section) q = q.eq('section', section);

  const { data, error } = await q;
  if (error) {
    console.error('[activities GET]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Supabase count aggregation via the select above gives us the total rows
  // but doesn't filter by column values — we need the filtered counts.
  // Fetch both counts per activity in one parallel batch instead.
  const activities = data ?? [];
  if (activities.length === 0) {
    return NextResponse.json({ activities: [] });
  }

  const ids = activities.map((a: any) => a.id as string);

  // Fetch scored_count (score IS NOT NULL) and published_count (is_published = true)
  // for all activities belonging to this teacher in two parallel queries.
  const [{ data: scoredRows }, { data: publishedRows }] = await Promise.all([
    supabase
      .from('activity_scores')
      .select('activity_id')
      .in('activity_id', ids)
      .not('score', 'is', null),
    supabase
      .from('activity_scores')
      .select('activity_id')
      .in('activity_id', ids)
      .eq('is_published', true),
  ]);

  // Build lookup maps: activity_id → count
  const scoredMap    = new Map<string, number>();
  const publishedMap = new Map<string, number>();
  for (const r of scoredRows    ?? []) scoredMap.set(   r.activity_id, (scoredMap.get(r.activity_id)    ?? 0) + 1);
  for (const r of publishedRows ?? []) publishedMap.set(r.activity_id, (publishedMap.get(r.activity_id) ?? 0) + 1);

  const shaped = activities.map((a: any) => ({
    ...a,
    scored_count:    scoredMap.get(a.id)    ?? 0,
    published_count: publishedMap.get(a.id) ?? 0,
    // Remove the raw nested count arrays Supabase returns — not needed by client
    scored:    undefined,
    published: undefined,
  }));

  return NextResponse.json({ activities: shaped });
}

/**
 * POST /api/activities
 *
 * Creates a new activity for the given class. Scores are not created here —
 * use POST /api/activities/[id]/scores after creation.
 *
 * Body: { activity_type, name, subject, academic_year, grade, section,
 *         activity_date?, max_score, description?, teacher_comment? }
 */
export async function POST(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const userId = guard.user.id;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const {
    activity_type, name, subject,
    academic_year, grade, section,
    activity_date, max_score,
    description, teacher_comment,
  } = body;

  // Validate required fields
  if (!ACTIVITY_TYPES.includes(activity_type)) {
    return NextResponse.json(
      { error: `activity_type must be one of: ${ACTIVITY_TYPES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!name?.trim())          return NextResponse.json({ error: 'name is required' },          { status: 400 });
  if (!subject?.trim())       return NextResponse.json({ error: 'subject is required' },       { status: 400 });
  if (!academic_year?.trim()) return NextResponse.json({ error: 'academic_year is required' }, { status: 400 });
  if (!grade?.trim())         return NextResponse.json({ error: 'grade is required' },         { status: 400 });
  if (!section?.trim())       return NextResponse.json({ error: 'section is required' },       { status: 400 });

  const maxScoreNum = Number(max_score);
  if (!Number.isFinite(maxScoreNum) || maxScoreNum <= 0) {
    return NextResponse.json({ error: 'max_score must be a positive number' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('activities')
    .insert({
      school_id:       userId,
      activity_type,
      name:            name.trim(),
      subject:         subject.trim(),
      academic_year:   academic_year.trim(),
      grade:           grade.trim(),
      section:         section.trim(),
      activity_date:   activity_date || null,
      max_score:       maxScoreNum,
      description:     description?.trim() || null,
      teacher_comment: teacher_comment?.trim() || null,
      publish_status:  'draft',
    } as any)
    .select()
    .single();

  if (error) {
    console.error('[activities POST]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: data }, { status: 201 });
}

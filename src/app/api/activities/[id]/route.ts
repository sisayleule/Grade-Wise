import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';
import { requireApproved } from 'lib/supabase/requireApproved';
import { ACTIVITY_TYPES } from 'lib/activityTypes';

/**
 * GET /api/activities/[id]
 *
 * Returns a single activity with its score rows joined to student names/codes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const { id } = await params;

  const { data, error } = await supabase
    .from('activities')
    .select(`
      *,
      activity_scores (
        id,
        student_ref_id,
        score,
        is_published,
        students ( id, student_code, full_name, roll_number )
      )
    `)
    .eq('id', id)
    .eq('school_id', guard.user.id)
    .single();

  if (error) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  return NextResponse.json({ activity: data });
}

/**
 * PATCH /api/activities/[id]
 *
 * Two operations (same body pattern as PATCH /api/batches/[id]):
 *
 *   1. Metadata edit — body: { name?, subject?, activity_date?, max_score?,
 *                              description?, teacher_comment?, activity_type? }
 *
 *   2. Publishing — body: { publish_status: 'published' | 'draft',
 *                            student_ref_ids?: string[] }
 *      If student_ref_ids is omitted → publish all scored students.
 *      If student_ref_ids is provided → publish only those students.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const { id } = await params;
  const userId = guard.user.id;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  // Verify ownership
  const { data: activity, error: fetchErr } = await supabase
    .from('activities')
    .select('id, publish_status, max_score')
    .eq('id', id)
    .eq('school_id', userId)
    .single() as { data: any; error: any };

  if (fetchErr || !activity) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  }

  // ── Operation 1: Publishing ───────────────────────────────────────────────
  if ('publish_status' in body) {
    const { publish_status, student_ref_ids } = body;

    // Client sends 'published' for all publish intents (selective or full)
    // and 'draft' to unpublish. We derive the real persisted status server-side.
    if (!['draft', 'published'].includes(publish_status)) {
      return NextResponse.json(
        { error: 'publish_status must be "draft" or "published"' },
        { status: 400 }
      );
    }

    if (publish_status === 'published') {
      // ── Guard: must have at least one saved score ────────────────────────
      const { count: totalScored, error: countErr } = await supabase
        .from('activity_scores')
        .select('id', { count: 'exact', head: true })
        .eq('activity_id', id)
        .not('score', 'is', null);

      if (countErr) {
        return NextResponse.json({ error: countErr.message }, { status: 500 });
      }
      if (!totalScored || totalScored === 0) {
        return NextResponse.json(
          {
            error:
              'No scores have been saved yet. ' +
              'Enter and save at least one student\'s score before publishing.',
          },
          { status: 422 }
        );
      }

      const isSelective =
        Array.isArray(student_ref_ids) && student_ref_ids.length > 0;

      // If publishing a subset, confirm those students have scores
      if (isSelective) {
        const { count: selectedCount } = await supabase
          .from('activity_scores')
          .select('id', { count: 'exact', head: true })
          .eq('activity_id', id)
          .in('student_ref_id', student_ref_ids)
          .not('score', 'is', null);

        if (!selectedCount || selectedCount === 0) {
          return NextResponse.json(
            {
              error:
                'None of the selected students have scores saved yet. ' +
                'Save scores first, then publish.',
            },
            { status: 422 }
          );
        }
      }

      // ── Step 1: Mark the selected (or all) score rows as published ───────
      let scoreQ = supabase
        .from('activity_scores')
        .update({ is_published: true } as any)
        .eq('activity_id', id);

      if (isSelective) {
        // Only the chosen students — never touches any other row
        scoreQ = scoreQ.in('student_ref_id', student_ref_ids);
      }
      // else: publish every scored student (Publish to All path)

      const { error: scoreErr } = await scoreQ;
      if (scoreErr) {
        console.error('[activities PATCH publish scores]', scoreErr.message);
        return NextResponse.json({ error: scoreErr.message }, { status: 500 });
      }

      // ── Step 2: Derive the correct activity-level publish_status ─────────
      // Count how many scored students are now published vs total scored.
      // We read back the counts after the update so the status reflects
      // reality, not the client's intent.
      const [{ count: nowPublished }, { count: nowTotal }] = await Promise.all([
        supabase
          .from('activity_scores')
          .select('id', { count: 'exact', head: true })
          .eq('activity_id', id)
          .not('score', 'is', null)
          .eq('is_published', true),
        supabase
          .from('activity_scores')
          .select('id', { count: 'exact', head: true })
          .eq('activity_id', id)
          .not('score', 'is', null),
      ]);

      // draft            → 0 published
      // partially_published → some but not all published
      // published        → every scored student is published
      const derivedStatus: 'draft' | 'partially_published' | 'published' =
        !nowPublished || nowPublished === 0
          ? 'draft'
          : nowPublished < (nowTotal ?? 0)
          ? 'partially_published'
          : 'published';

      const { error: actErr } = await supabase
        .from('activities')
        .update({ publish_status: derivedStatus } as any)
        .eq('id', id)
        .eq('school_id', userId);

      if (actErr) {
        return NextResponse.json({ error: actErr.message }, { status: 500 });
      }

      // ── Notify every student whose score was just published ──────────────
      // Fire-and-forget: a notification failure must never block a publish.
      try {
        await createActivityPublishNotifications({
          activityId:     id,
          schoolId:       userId,
          studentRefIds:  isSelective ? student_ref_ids : null,
        });
      } catch (notifErr) {
        console.error('[activities PATCH] notification creation failed (non-fatal):', notifErr);
      }

      return NextResponse.json({
        ok: true,
        publish_status: derivedStatus,
        published_count: nowPublished ?? 0,
        total_scored:    nowTotal    ?? 0,
      });

    } else {
      // ── Unpublish: revert ALL score rows and reset to draft ──────────────
      const { error: unErr } = await supabase
        .from('activity_scores')
        .update({ is_published: false } as any)
        .eq('activity_id', id);
      if (unErr) {
        console.error('[activities PATCH unpublish]', unErr.message);
        return NextResponse.json({ error: unErr.message }, { status: 500 });
      }

      const { error: actErr } = await supabase
        .from('activities')
        .update({ publish_status: 'draft' } as any)
        .eq('id', id)
        .eq('school_id', userId);

      if (actErr) {
        return NextResponse.json({ error: actErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, publish_status: 'draft' });
    }
  }

  // ── Operation 2: Metadata edit ────────────────────────────────────────────
  const allowed = ['activity_type', 'name', 'subject', 'activity_date',
                   'max_score', 'description', 'teacher_comment'] as const;
  const update: Record<string, any> = {};

  for (const field of allowed) {
    if (!(field in body)) continue;
    if (field === 'activity_type') {
      if (!ACTIVITY_TYPES.includes(body.activity_type)) {
        return NextResponse.json(
          { error: `activity_type must be one of: ${ACTIVITY_TYPES.join(', ')}` },
          { status: 400 }
        );
      }
      update.activity_type = body.activity_type;
    } else if (field === 'max_score') {
      const v = Number(body.max_score);
      if (!Number.isFinite(v) || v <= 0) {
        return NextResponse.json({ error: 'max_score must be a positive number' }, { status: 400 });
      }
      update.max_score = v;
    } else {
      update[field] = body[field] ?? null;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('activities')
    .update(update as any)
    .eq('id', id)
    .eq('school_id', userId)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ activity: updated });
}

/**
 * DELETE /api/activities/[id]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const { id } = await params;

  const { error } = await supabase
    .from('activities')
    .delete()
    .eq('id', id)
    .eq('school_id', guard.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── Notification helper ───────────────────────────────────────────────────────
/**
 * Creates one notification per student who just had their activity score
 * published.
 *
 * studentRefIds:
 *   null            → publish-all path — notify every student with a newly
 *                     published is_published=true score row
 *   string[]        → selective path   — notify only those exact student UUIDs
 *                     (these are students.id values = activity_scores.student_ref_id)
 *
 * Uses the service client to bypass RLS for the insert.
 */
async function createActivityPublishNotifications({
  activityId,
  schoolId,
  studentRefIds,
}: {
  activityId:    string;
  schoolId:      string;
  studentRefIds: string[] | null;   // students.id values, or null for "all"
}) {
  const service = createServiceClient();

  // Load activity metadata for the notification body
  const { data: activity, error: actErr } = await (service as any)
    .from('activities')
    .select('name, activity_type, subject')
    .eq('id', activityId)
    .single();

  if (actErr || !activity) return;

  // Determine which student ref IDs to notify.
  // For selective publish, we use the caller-supplied list directly.
  // For publish-all, we read back all currently-published score rows.
  let targetRefIds: string[];

  if (studentRefIds !== null) {
    // Selective: notify only the provided students
    targetRefIds = studentRefIds;
  } else {
    // Publish-all: every student whose score is currently published
    const { data: publishedScores, error: scoresErr } = await (service as any)
      .from('activity_scores')
      .select('student_ref_id')
      .eq('activity_id', activityId)
      .eq('is_published', true)
      .not('score', 'is', null);

    if (scoresErr || !publishedScores || publishedScores.length === 0) return;
    targetRefIds = (publishedScores as any[]).map((s) => s.student_ref_id);
  }

  if (targetRefIds.length === 0) return;

  const actType  = activity.activity_type ?? 'Activity';
  const name     = activity.name          ? ` "${activity.name}"` : '';
  const subject  = activity.subject       ? ` for ${activity.subject}` : '';
  const title    = 'New Activity Published';
  const body     = `Your ${actType}${name}${subject} score is now available.`;

  const rows = targetRefIds.map((refId: string) => ({
    recipient_type:       'student',
    recipient_student_id: refId,
    recipient_school_id:  null,
    title,
    body,
    notification_type:    'activity_published',
    link_type:            'activity',
    link_id:              activityId,
    is_read:              false,
  }));

  const { error: insertErr } = await (service as any)
    .from('notifications')
    .insert(rows);

  if (insertErr) {
    throw new Error(`notifications insert: ${insertErr.message}`);
  }
}

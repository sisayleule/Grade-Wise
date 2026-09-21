import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';
import { computeResults } from 'lib/grades';
import { requireApproved } from 'lib/supabase/requireApproved';

/**
 * DELETE /api/batches/[id]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing batch id' }, { status: 400 });

  const { error } = await supabase
    .from('result_batches')
    .delete()
    .eq('id', id)
    .eq('school_id', guard.user.id);

  if (error) {
    console.error('[batches DELETE]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/batches/[id]
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const { id } = await params;
  const { data, error } = await supabase
    .from('result_batches')
    .select('*, result_students(*)')
    .eq('id', id)
    .eq('school_id', guard.user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ batch: data });
}

/**
 * PATCH /api/batches/[id]
 *
 * Two operations:
 *
 * 1. Publishing — body: { publish_status, published_student_ids? }
 *    publish_status: 'draft'|'processed'|'reviewed'|'published'|'archived'
 *    published_student_ids: string[] — if omitted + published, means all students.
 *
 * 2. Score edit — body: { student_id, scores, confirmed_published_edit? }
 *    Returns HTTP 428 if batch is published and confirmed_published_edit != true.
 *    On confirm, re-computes all ranks and saves.
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
  const { data: batch, error: fetchErr } = await supabase
    .from('result_batches')
    .select('id, publish_status, subjects, published_student_ids')
    .eq('id', id)
    .eq('school_id', userId)
    .single() as { data: any; error: any };

  if (fetchErr || !batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  // ── Operation 1: Publishing ───────────────────────────────────────────────
  if ('publish_status' in body) {
    const { publish_status, published_student_ids } = body;
    const VALID = ['draft', 'processed', 'reviewed', 'published', 'archived'];
    if (!VALID.includes(publish_status)) {
      return NextResponse.json({ error: `publish_status must be one of: ${VALID.join(', ')}` }, { status: 400 });
    }

    const update: Record<string, any> = { publish_status };
    if (publish_status === 'published' && !Array.isArray(published_student_ids)) {
      // Publish all — empty array means "everyone is published"
      update.published_student_ids = [];
    }
    if (Array.isArray(published_student_ids)) {
      update.published_student_ids = published_student_ids;
    }

    const { error: updateErr } = await supabase
      .from('result_batches')
      .update(update as any)
      .eq('id', id)
      .eq('school_id', userId);

    if (updateErr) {
      console.error('[batches PATCH publish]', updateErr.message);
      return NextResponse.json({ error: 'Failed to update publish status' }, { status: 500 });
    }

    // ── Notification creation (publish only, not draft/archive) ──────────
    // We only create notifications when actually publishing, never on status
    // rollbacks to draft/processed/etc.
    if (publish_status === 'published') {
      try {
        await createResultPublishNotifications({
          batchId:               id,
          schoolId:              userId,
          publishedStudentIds:   update.published_student_ids as string[],
          batch,
        });
      } catch (notifErr) {
        // Notification failure must never roll back a successful publish.
        // Log and continue — the teacher's publish already succeeded.
        console.error('[batches PATCH] notification creation failed (non-fatal):', notifErr);
      }
    }

    return NextResponse.json({ ok: true, publish_status, published_student_ids: update.published_student_ids ?? batch.published_student_ids });
  }

  // ── Operation 2: Score edit ───────────────────────────────────────────────
  if ('student_id' in body && 'scores' in body) {
    const { student_id, scores, confirmed_published_edit } = body;

    if (batch.publish_status === 'published' && !confirmed_published_edit) {
      return NextResponse.json(
        { error: 'requires_confirmation', message: 'This result has already been published to students. Save this change?' },
        { status: 428 }
      );
    }

    const { data: allStudents, error: studErr } = await supabase
      .from('result_students')
      .select('id, student_id, student_name, scores')
      .eq('batch_id', id) as { data: any[] | null; error: any };

    if (studErr || !allStudents) {
      return NextResponse.json({ error: 'Failed to load students' }, { status: 500 });
    }

    const subjects: string[] = Array.isArray(batch.subjects) ? batch.subjects : [];
    const recomputed = computeResults(
      allStudents.map((s) => ({
        id:     s.student_id,
        name:   s.student_name,
        scores: s.student_id === student_id ? scores : s.scores,
      })),
      subjects
    );

    // Delete all and re-insert with recomputed values
    const { error: delErr } = await supabase
      .from('result_students').delete().eq('batch_id', id);
    if (delErr) return NextResponse.json({ error: 'Failed to update scores' }, { status: 500 });

    const upsertRows = recomputed.map((r) => {
      const orig = allStudents.find((s) => s.student_id === r.id);
      return {
        id:           orig?.id,
        batch_id:     id,
        student_id:   r.id,
        student_name: r.name,
        scores:       r.scores,
        total:        r.total,
        average:      r.average,
        percentage:   r.percentage,
        rank:         r.rank,
      };
    });

    const { error: insertErr } = await supabase
      .from('result_students').insert(upsertRows as any);
    if (insertErr) return NextResponse.json({ error: 'Failed to save updated scores' }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'No valid operation in body' }, { status: 400 });
}

// ── Notification helper ───────────────────────────────────────────────────────
/**
 * Creates one notification per student who was actually published in this
 * batch publish action.
 *
 * published_student_ids semantics (from the batch update):
 *   []          → "publish all" — every student in the batch was published
 *   [id, id...] → selective — only the students whose student_code is in this
 *                 list were published
 *
 * We use the service client so the insert bypasses RLS (notifications have no
 * INSERT policy for anyone — only the server may create them).
 */
async function createResultPublishNotifications({
  batchId,
  schoolId,
  publishedStudentIds,
  batch,
}: {
  batchId:             string;
  schoolId:            string;
  publishedStudentIds: string[];   // student_code values, or [] for "all"
  batch:               { subjects: any; [k: string]: any };
}) {
  const service = createServiceClient();

  // Load all result_students for this batch that have a student_ref_id set,
  // joined to their canonical students row so we get the student UUID.
  // We need student_ref_id (students.id) to write recipient_student_id.
  const { data: resultStudents, error: rsErr } = await (service as any)
    .from('result_students')
    .select('student_id, student_ref_id')   // student_id = student_code; student_ref_id = students.id
    .eq('batch_id', batchId)
    .not('student_ref_id', 'is', null);

  if (rsErr || !resultStudents || resultStudents.length === 0) {
    // No matched roster rows — nothing to notify
    return;
  }

  // Determine which rows were actually published
  const isPublishAll = publishedStudentIds.length === 0;
  const publishedSet = new Set(publishedStudentIds);   // student_code values

  const targetRows: Array<{ student_ref_id: string }> = (resultStudents as any[]).filter(
    (r) => isPublishAll || publishedSet.has(r.student_id)
  );

  if (targetRows.length === 0) return;

  // Load the batch metadata once for the notification body
  const { data: batchMeta } = await (service as any)
    .from('result_batches')
    .select('semester, academic_year, grade, section')
    .eq('id', batchId)
    .single();

  const semester    = batchMeta?.semester     ?? 'Result';
  const year        = batchMeta?.academic_year ?? '';
  const title       = 'New Result Published';
  const body        = `Your ${semester}${year ? ` (${year})` : ''} result is now available.`;

  // Bulk-insert one notification per published student
  const rows = targetRows.map((r) => ({
    recipient_type:       'student',
    recipient_student_id: r.student_ref_id,
    recipient_school_id:  null,
    title,
    body,
    notification_type:    'result_published',
    link_type:            'result_batch',
    link_id:              batchId,
    is_read:              false,
  }));

  const { error: insertErr } = await (service as any)
    .from('notifications')
    .insert(rows);

  if (insertErr) {
    throw new Error(`notifications insert: ${insertErr.message}`);
  }
}

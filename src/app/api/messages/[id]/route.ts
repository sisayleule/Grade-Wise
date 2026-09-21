import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';

const VALID_STATUSES = ['pending', 'resolved', 'archived'] as const;

// ── Helper: resolve caller identity ──────────────────────────────────────────
// Returns either { role: 'student', studentId, schoolId, fullName } or
// { role: 'teacher', schoolId } or null if unauthenticated.
async function resolveIdentity(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  // Try student first (cheaper: one row lookup)
  const { data: student } = await supabase
    .from('students')
    .select('id, school_id, full_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (student) {
    return {
      role:      'student' as const,
      studentId: student.id as string,
      schoolId:  student.school_id as string,
      fullName:  (student.full_name as string) ?? '',
    };
  }

  // Assume teacher (school auth user)
  return {
    role:     'teacher' as const,
    schoolId: user.id,
    fullName: '',
  };
}

/**
 * GET /api/messages/[id]
 *
 * Returns the full thread: message metadata + all replies in chronological order.
 * Accessible by the student who owns the thread OR the teacher who owns the school.
 *
 * Response:
 *   { thread: { id, category, message, status, created_at, updated_at,
 *               student: { full_name, student_code, grade, section },
 *               replies: Reply[] } }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const identity = await resolveIdentity(supabase);
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Fetch the message + student info — RLS enforces ownership automatically
  const { data: msg, error: msgErr } = await supabase
    .from('student_messages')
    .select(`
      id, category, message, status, created_at, updated_at, student_ref_id,
      students!student_messages_student_ref_id_fkey ( id, full_name, student_code, grade, section )
    `)
    .eq('id', id)
    .maybeSingle() as { data: any; error: any };

  if (msgErr || !msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // Extra access check for students: confirm this thread belongs to them
  if (identity.role === 'student' && msg.student_ref_id !== identity.studentId) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // Fetch replies — RLS scopes to student's own or teacher's school
  const { data: replies, error: repliesErr } = await supabase
    .from('message_replies')
    .select('id, sender_type, reply_text, created_at')
    .eq('message_id', id)
    .order('created_at', { ascending: true });

  if (repliesErr) {
    console.error('[messages/[id] GET replies]', repliesErr.message);
    return NextResponse.json({ error: 'Failed to load replies' }, { status: 500 });
  }

  return NextResponse.json({
    thread: {
      id:         msg.id,
      category:   msg.category,
      message:    msg.message,
      status:     msg.status,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      student:    msg['students!student_messages_student_ref_id_fkey'] ?? msg.students ?? null,
      replies:    replies ?? [],
    },
  });
}

/**
 * PATCH /api/messages/[id]
 *
 * Two operations:
 *
 *   1. Teacher status update: { status: 'pending' | 'resolved' | 'archived' }
 *      Teacher-only. Student may not change status.
 *
 *   2. Reply (either side): { reply_text: string }
 *      Both student and teacher may post replies.
 *      sender_type is set automatically from the caller's identity.
 *      A teacher reply also triggers a student notification.
 *      A student reply re-opens to pending if currently resolved/archived
 *      and also notifies the teacher.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const identity = await resolveIdentity(supabase);
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  // Verify the message exists and is accessible to this caller via RLS
  const { data: msg, error: msgErr } = await supabase
    .from('student_messages')
    .select('id, school_id, student_ref_id, status, category')
    .eq('id', id)
    .maybeSingle() as { data: any; error: any };

  if (msgErr || !msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // ── Operation 1: Status update (teacher only) ─────────────────────────────
  if ('status' in body) {
    if (identity.role !== 'teacher') {
      return NextResponse.json({ error: 'Only the teacher may update message status' }, { status: 403 });
    }

    const { status } = body;
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from('student_messages')
      .update({ status } as any)
      .eq('id', id)
      .eq('school_id', identity.schoolId);

    if (updateErr) {
      console.error('[messages/[id] PATCH status]', updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status });
  }

  // ── Operation 2: Add reply ────────────────────────────────────────────────
  if ('reply_text' in body) {
    const { reply_text } = body;

    if (!reply_text || typeof reply_text !== 'string' || reply_text.trim().length === 0) {
      return NextResponse.json({ error: 'reply_text is required' }, { status: 400 });
    }
    if (reply_text.trim().length > 2000) {
      return NextResponse.json({ error: 'reply_text must be 2000 characters or fewer' }, { status: 400 });
    }

    const senderType = identity.role === 'teacher' ? 'teacher' : 'student';

    const { data: reply, error: replyErr } = await supabase
      .from('message_replies')
      .insert({
        message_id:  id,
        sender_type: senderType,
        reply_text:  reply_text.trim(),
      } as any)
      .select('id, sender_type, reply_text, created_at')
      .single();

    if (replyErr || !reply) {
      console.error('[messages/[id] PATCH reply]', replyErr?.message);
      return NextResponse.json({ error: 'Failed to save reply' }, { status: 500 });
    }

    // ── If student replies, bump status back to pending ───────────────────
    if (senderType === 'student' && msg.status !== 'pending') {
      await supabase
        .from('student_messages')
        .update({ status: 'pending' } as any)
        .eq('id', id);
    }

    // ── Notifications ─────────────────────────────────────────────────────
    try {
      const service = createServiceClient();

      if (senderType === 'teacher') {
        // Teacher replied → notify the student
        const categoryLabel = msg.category.charAt(0).toUpperCase() + msg.category.slice(1);
        await (service as any)
          .from('notifications')
          .insert({
            recipient_type:       'student',
            recipient_student_id: msg.student_ref_id,
            recipient_school_id:  null,
            title:                'Your teacher replied',
            body:                 `You have a new reply on your ${categoryLabel}.`,
            notification_type:    'message_reply',
            link_type:            null,
            link_id:              null,
            is_read:              false,
          });
      } else {
        // Student replied → notify the teacher
        // Resolve student name for the notification body
        const { data: studentRow } = await (service as any)
          .from('students')
          .select('full_name')
          .eq('id', msg.student_ref_id)
          .single();

        const studentName = (studentRow?.full_name as string)?.trim() || 'A student';
        const categoryLabel = msg.category.charAt(0).toUpperCase() + msg.category.slice(1);

        await (service as any)
          .from('notifications')
          .insert({
            recipient_type:       'teacher',
            recipient_student_id: null,
            recipient_school_id:  msg.school_id,
            title:                `${studentName} replied`,
            body:                 `New reply on ${categoryLabel}: ${reply_text.trim().slice(0, 100)}${reply_text.trim().length > 100 ? '…' : ''}`,
            notification_type:    'student_message',
            link_type:            null,
            link_id:              null,
            is_read:              false,
          });
      }
    } catch (notifErr) {
      // Non-fatal — reply was already saved
      console.error('[messages/[id] PATCH reply] notification failed:', notifErr);
    }

    return NextResponse.json({ reply });
  }

  return NextResponse.json({ error: 'No valid operation in body' }, { status: 400 });
}

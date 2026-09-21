import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { createServiceClient } from 'lib/supabase/service';

const VALID_CATEGORIES = ['complaint', 'recommendation', 'question', 'other'] as const;
const VALID_STATUSES   = ['pending', 'resolved', 'archived'] as const;

/**
 * POST /api/messages
 *
 * Student-only. Creates a new message thread.
 *
 * Body: { category, message }
 *
 * Response: { message: { id, category, message, status, created_at } }
 *
 * Side-effect: creates one 'student_message' notification for the teacher/school.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve canonical student row
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id, full_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr || !student) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { category, message } = body;

  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (message.trim().length > 2000) {
    return NextResponse.json({ error: 'message must be 2000 characters or fewer' }, { status: 400 });
  }

  // Insert the message — RLS "student_messages: student insert own" enforces
  // that school_id and student_ref_id match this student's own record.
  const { data: created, error: insertErr } = await supabase
    .from('student_messages')
    .insert({
      school_id:      student.school_id,
      student_ref_id: student.id,
      category,
      message:        message.trim(),
      status:         'pending',
    } as any)
    .select('id, category, message, status, created_at')
    .single();

  if (insertErr || !created) {
    console.error('[messages POST]', insertErr?.message);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }

  // ── Notify the teacher ────────────────────────────────────────────────────
  try {
    const service = createServiceClient();
    const categoryLabel =
      category.charAt(0).toUpperCase() + category.slice(1);
    const studentName = student.full_name?.trim() || 'A student';

    await (service as any)
      .from('notifications')
      .insert({
        recipient_type:      'teacher',
        recipient_student_id: null,
        recipient_school_id:  student.school_id,
        title:                `New ${categoryLabel} from ${studentName}`,
        body:                 message.trim().slice(0, 120) + (message.trim().length > 120 ? '…' : ''),
        notification_type:    'student_message',
        link_type:            null,
        link_id:              null,
        is_read:              false,
      });
  } catch (notifErr) {
    // Non-fatal — message was already saved
    console.error('[messages POST] teacher notification failed:', notifErr);
  }

  return NextResponse.json({ message: created }, { status: 201 });
}

/**
 * GET /api/messages
 *
 * Teacher-only. Returns all messages for this school.
 *
 * Query params (all optional):
 *   status   — filter by status ('pending' | 'resolved' | 'archived')
 *   category — filter by category
 *   limit    — max rows (default 50, cap 100)
 *
 * Response: { messages: MessageRow[] }
 *   Each MessageRow includes: id, category, message, status, created_at,
 *   updated_at, reply_count, student { full_name, student_code, grade, section }
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Confirm this is a teacher (has a schools row with id = auth.uid())
  // We use the same requireApproved pattern implicitly: only school users
  // can query student_messages by school_id = auth.uid() via RLS.
  const { searchParams } = request.nextUrl;
  const statusFilter   = searchParams.get('status');
  const categoryFilter = searchParams.get('category');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100);

  let q = supabase
    .from('student_messages')
    .select(`
      id,
      category,
      message,
      status,
      created_at,
      updated_at,
      students!student_messages_student_ref_id_fkey (
        id,
        full_name,
        student_code,
        grade,
        section
      ),
      message_replies ( id )
    `)
    .eq('school_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (statusFilter && VALID_STATUSES.includes(statusFilter as any)) {
    q = q.eq('status', statusFilter);
  }
  if (categoryFilter && VALID_CATEGORIES.includes(categoryFilter as any)) {
    q = q.eq('category', categoryFilter);
  }

  const { data, error } = await q;

  if (error) {
    console.error('[messages GET teacher]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Shape: flatten reply_count from the joined array length
  const messages = (data ?? []).map((m: any) => ({
    id:          m.id,
    category:    m.category,
    message:     m.message,
    status:      m.status,
    created_at:  m.created_at,
    updated_at:  m.updated_at,
    reply_count: Array.isArray(m.message_replies) ? m.message_replies.length : 0,
    student:     m['students!student_messages_student_ref_id_fkey'] ?? m.students ?? null,
  }));

  return NextResponse.json({ messages });
}

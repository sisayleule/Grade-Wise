import { NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';

/**
 * GET /api/student/messages
 *
 * Returns all message threads the authenticated student has sent,
 * newest first, with reply count.
 *
 * Response:
 *   { messages: Array<{ id, category, message, status, created_at,
 *                        updated_at, reply_count }> }
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve student row
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr || !student) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('student_messages')
    .select(`
      id, category, message, status, created_at, updated_at,
      message_replies ( id )
    `)
    .eq('student_ref_id', student.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[student/messages GET]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = (data ?? []).map((m: any) => ({
    id:          m.id,
    category:    m.category,
    message:     m.message,
    status:      m.status,
    created_at:  m.created_at,
    updated_at:  m.updated_at,
    reply_count: Array.isArray(m.message_replies) ? m.message_replies.length : 0,
  }));

  return NextResponse.json({ messages });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';

/**
 * GET /api/student/notifications
 *
 * Returns the authenticated student's notifications, newest first.
 *
 * Query params:
 *   limit  — max rows (default 50, cap 100)
 *   unread — "true" to return only unread rows
 *
 * Response:
 *   { notifications: Notification[], unread_count: number }
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

  // Resolve the canonical students row so we have the student UUID
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr) {
    console.error('[student/notifications GET] students:', studentErr.message);
    return NextResponse.json({ error: 'Failed to load student record' }, { status: 500 });
  }
  if (!studentRow) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100);
  const unreadOnly = searchParams.get('unread') === 'true';

  // Fetch notifications — RLS "notifications: student read own" is applied
  let q = supabase
    .from('notifications')
    .select('id, title, body, notification_type, link_type, link_id, is_read, created_at')
    .eq('recipient_type', 'student')
    .eq('recipient_student_id', studentRow.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) q = q.eq('is_read', false);

  const { data: notifications, error } = await q;
  if (error) {
    console.error('[student/notifications GET]', error.message);
    // If the notifications table doesn't exist yet (pre-migration), return
    // an empty result instead of a 500 — the badge simply stays at 0.
    if (
      error.message?.includes("relation") ||
      error.message?.includes("does not exist") ||
      error.message?.includes("schema cache") ||
      error.code === 'PGRST200' ||
      error.code === '42P01'
    ) {
      return NextResponse.json({ notifications: [], unread_count: 0 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Unread count
  const { count: unreadCount, error: countErr } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_type', 'student')
    .eq('recipient_student_id', studentRow.id)
    .eq('is_read', false);

  if (countErr) {
    console.error('[student/notifications GET count]', countErr.message);
    // Non-fatal — return 0 count
  }

  return NextResponse.json({
    notifications: notifications ?? [],
    unread_count:  unreadCount ?? 0,
  });
}

/**
 * PATCH /api/student/notifications
 *
 * Two operations:
 *
 *   1. Mark single read:   { id: string, is_read: true }
 *   2. Mark all read:      { mark_all_read: true }
 *
 * Scoped exclusively to the authenticated student's own rows.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (studentErr || !studentRow) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  // ── Mark all read ─────────────────────────────────────────────────────────
  if (body.mark_all_read === true) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true } as any)
      .eq('recipient_type', 'student')
      .eq('recipient_student_id', studentRow.id)
      .eq('is_read', false);

    if (error) {
      console.error('[student/notifications PATCH mark-all]', error.message);
      // Table doesn't exist yet — treat as no-op
      if (error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01') {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Mark single read ──────────────────────────────────────────────────────
  if (body.id && body.is_read === true) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true } as any)
      .eq('id', body.id)
      .eq('recipient_type', 'student')
      .eq('recipient_student_id', studentRow.id);

    if (error) {
      console.error('[student/notifications PATCH mark-one]', error.message);
      // Table doesn't exist yet — treat as no-op
      if (error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01') {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'No valid operation in body' }, { status: 400 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
import { requireApproved } from 'lib/supabase/requireApproved';

/**
 * GET /api/notifications
 *
 * Returns the teacher's notifications, newest first.
 * Also returns the unread count as a convenience field.
 *
 * Query params:
 *   limit  — max rows to return (default 50)
 *   unread — if "true", only return unread rows
 *
 * Response:
 *   { notifications: Notification[], unread_count: number }
 */
export async function GET(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const userId = guard.user.id;

  const { searchParams } = request.nextUrl;
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100);
  const unreadOnly = searchParams.get('unread') === 'true';

  // Build the main query
  let q = supabase
    .from('notifications')
    .select('id, title, body, notification_type, link_type, link_id, is_read, created_at')
    .eq('recipient_type', 'teacher')
    .eq('recipient_school_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) q = q.eq('is_read', false);

  const { data: notifications, error } = await q;
  if (error) {
    console.error('[notifications GET teacher]', error.message);
    // Table doesn't exist yet (pre-migration) — return empty rather than 500
    if (
      error.message?.includes('relation') ||
      error.message?.includes('does not exist') ||
      error.message?.includes('schema cache') ||
      error.code === 'PGRST200' ||
      error.code === '42P01'
    ) {
      return NextResponse.json({ notifications: [], unread_count: 0 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Unread count (separate lightweight query so it's always accurate)
  const { count: unreadCount, error: countErr } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_type', 'teacher')
    .eq('recipient_school_id', userId)
    .eq('is_read', false);

  if (countErr) {
    console.error('[notifications GET teacher count]', countErr.message);
  }

  return NextResponse.json({
    notifications: notifications ?? [],
    unread_count:  unreadCount ?? 0,
  });
}

/**
 * PATCH /api/notifications
 *
 * Two operations depending on body:
 *
 *   1. Mark single notification read:
 *      { id: string, is_read: true }
 *
 *   2. Mark all notifications read:
 *      { mark_all_read: true }
 *
 * Both operations are scoped to the authenticated teacher's school.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  const supabase = await createClient();
  const userId = guard.user.id;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  // ── Operation 1: mark all read ────────────────────────────────────────────
  if (body.mark_all_read === true) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true } as any)
      .eq('recipient_type', 'teacher')
      .eq('recipient_school_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('[notifications PATCH mark-all teacher]', error.message);
      if (error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01') {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Operation 2: mark single read ────────────────────────────────────────
  if (body.id && body.is_read === true) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true } as any)
      .eq('id', body.id)
      .eq('recipient_type', 'teacher')
      .eq('recipient_school_id', userId);

    if (error) {
      console.error('[notifications PATCH mark-one teacher]', error.message);
      if (error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01') {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'No valid operation in body' }, { status: 400 });
}

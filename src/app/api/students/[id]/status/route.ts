/**
 * PATCH /api/students/[id]/status
 * Body: { portal_status: 'active' | 'rejected' | 'inactive' }
 *
 * Teacher-only: approve or reject a student's portal account request.
 * The student row must belong to the teacher's own school (RLS enforces this,
 * and we double-check via the service client for safety).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApproved } from 'lib/supabase/requireApproved';
import { createServiceClient } from 'lib/supabase/service';

const ALLOWED_STATUSES = ['active', 'rejected', 'inactive', 'pending'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const guard = await requireApproved();
  if (guard.error) return guard.error;
  const teacherId = guard.user.id;

  const body = await request.json().catch(() => null);
  const status = body?.portal_status;

  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `portal_status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Verify the student belongs to this teacher's school before updating
  const { data: student, error: fetchErr } = await (service as any)
    .from('students')
    .select('id, school_id, portal_status')
    .eq('id', id)
    .eq('school_id', teacherId)
    .single() as { data: any; error: any };

  if (fetchErr || !student) {
    return NextResponse.json(
      { error: 'Student not found or does not belong to your school.' },
      { status: 404 }
    );
  }

  const { error: updateErr } = await (service as any)
    .from('students')
    .update({ portal_status: status })
    .eq('id', id);

  if (updateErr) {
    console.error('[student status PATCH]', updateErr.message);
    return NextResponse.json({ error: 'Failed to update status.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, portal_status: status });
}

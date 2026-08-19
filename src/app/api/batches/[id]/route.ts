import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';
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

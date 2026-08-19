/**
 * Server-side helper: fetches the logged-in school's status and is_admin flag.
 * Uses the session-scoped (anon) client — covered by RLS "read own row" policy.
 *
 * Returns null when the user is not authenticated or the schools row doesn't
 * exist yet (e.g. trigger hasn't fired).
 */
import { createClient } from './server';

export type SchoolStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface SchoolProfile {
  id: string;
  status: SchoolStatus;
  is_admin: boolean;
}

export async function getSchoolProfile(): Promise<SchoolProfile | null> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('schools')
    .select('id, status, is_admin')
    .eq('id', user.id)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    status: data.status as SchoolStatus,
    is_admin: data.is_admin ?? false,
  };
}

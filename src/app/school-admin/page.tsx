'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import {
  MdCheckCircle, MdDoNotDisturbOn, MdHourglassTop,
  MdRefresh, MdSchool, MdAdminPanelSettings, MdBlock,
  MdWarningAmber, MdPeople, MdLogout,
} from 'react-icons/md';

type School = {
  id: string;
  name: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  is_admin: boolean;
  created_at: string;
};

type Tab = 'pending' | 'approved' | 'all';

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: any }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/40',                                                icon: MdHourglassTop },
  approved:  { label: 'Approved',  cls: 'bg-horizonGreen-50 text-horizonGreen-700 border-horizonGreen-200 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300 dark:border-horizonGreen-700/40', icon: MdCheckCircle  },
  rejected:  { label: 'Rejected',  cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',                                                       icon: MdDoNotDisturbOn },
  suspended: { label: 'Suspended', cls: 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-navy-700 dark:text-gray-400 dark:border-navy-600',                                                      icon: MdBlock         },
};

export default function SchoolAdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pending');
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/schools');
      if (res.status === 403 || res.status === 401) {
        router.replace('/');
        return;
      }
      if (!res.ok) throw new Error('Failed to load schools');
      const data = await res.json();
      setSchools(data.schools ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: School['status']) => {
    setActionId(id);
    setError('');
    try {
      const res = await fetch('/api/admin/schools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed');
      setSchools(old => old.map(s => s.id === id ? { ...s, status } : s));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionId(null);
    }
  };

  const visible = schools.filter(s => {
    if (tab === 'pending')  return s.status === 'pending';
    if (tab === 'approved') return s.status === 'approved' || s.status === 'suspended';
    return true;
  });

  const pendingCount  = schools.filter(s => s.status === 'pending').length;
  const approvedCount = schools.filter(s => s.status === 'approved' || s.status === 'suspended').length;

  return (
    <div className="min-h-screen bg-lightPrimary font-dm text-navy-900 dark:bg-navy-900 dark:text-white">
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="mb-8 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-blueSecondary text-2xl text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)]">
              <MdAdminPanelSettings />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-brand-500">
                GradeWise Admin
              </p>
              <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
                School approvals
              </h1>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              title="Refresh"
              className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-xl text-gray-600 transition hover:bg-white disabled:opacity-50 dark:border-navy-700 dark:text-gray-400 dark:hover:bg-navy-800"
            >
              <MdRefresh className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                router.push('/auth/sign-in');
                router.refresh();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 transition hover:bg-white dark:border-navy-700 dark:text-gray-400 dark:hover:bg-navy-800"
            >
              <MdLogout className="text-base" /> Sign out
            </button>
          </div>
        </div>

        {/* ── Error banner ───────────────────────────────────────────────── */}
        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
            <MdWarningAmber className="shrink-0 text-lg" /> {error}
          </div>
        )}

        {/* ── Stats row ──────────────────────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(['pending', 'approved', 'rejected', 'suspended'] as const).map(s => {
            const count = schools.filter(x => x.status === s).length;
            const badge = STATUS_BADGE[s];
            const Icon = badge.icon;
            return (
              <div
                key={s}
                className="rounded-2xl border border-gray-200/70 bg-white p-4 shadow-[0_8px_20px_rgba(112,144,176,0.08)] dark:border-navy-700 dark:bg-navy-800"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {badge.label}
                  </p>
                  <Icon className="text-lg opacity-40" />
                </div>
                <p className="mt-1 text-3xl font-bold text-navy-900 dark:text-white">
                  {count}
                </p>
              </div>
            );
          })}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <div className="mb-5 flex gap-1 rounded-2xl border border-gray-200/70 bg-white p-1 shadow-[0_8px_20px_rgba(112,144,176,0.08)] dark:border-navy-700 dark:bg-navy-800">
          {([
            { id: 'pending'  as Tab, label: 'Pending',      icon: MdHourglassTop, count: pendingCount  },
            { id: 'approved' as Tab, label: 'Active',        icon: MdPeople,       count: approvedCount },
            { id: 'all'      as Tab, label: 'All schools',   icon: MdSchool,       count: schools.length },
          ]).map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold transition ${
                tab === id
                  ? 'bg-lightPrimary text-brand-500 dark:bg-navy-700 dark:text-white'
                  : 'text-gray-500 hover:text-navy-900 dark:hover:text-white'
              }`}
            >
              <Icon className="text-base" />
              <span className="hidden sm:inline">{label}</span>
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  tab === id
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-200 text-gray-600 dark:bg-navy-600 dark:text-gray-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── School list ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200/70 bg-white shadow-[0_8px_20px_rgba(112,144,176,0.08)] dark:border-navy-700 dark:bg-navy-800">
          {loading ? (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-lightPrimary dark:bg-navy-700" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <MdSchool className="mx-auto mb-3 text-4xl text-gray-300 dark:text-navy-600" />
              <p className="text-sm font-bold text-gray-400 dark:text-gray-500">
                No schools in this category
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-navy-700">
              {visible.map(school => {
                const badge = STATUS_BADGE[school.status];
                const BadgeIcon = badge.icon;
                const busy = actionId === school.id;

                return (
                  <div
                    key={school.id}
                    className="flex flex-col gap-3 p-5 transition hover:bg-lightPrimary/40 dark:hover:bg-navy-700/30 sm:flex-row sm:items-center"
                  >
                    {/* Identity */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-lg text-brand-500 dark:bg-navy-700 dark:text-brand-300">
                        <MdSchool />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-navy-900 dark:text-white">
                            {school.name || '(unnamed)'}
                          </p>
                          {school.is_admin && (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                              ADMIN
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {school.email || '—'}&ensp;·&ensp;Signed up{' '}
                          {new Date(school.created_at).toLocaleDateString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Status badge */}
                    <span className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full border px-2.5 py-1 text-xs font-bold sm:self-auto ${badge.cls}`}>
                      <BadgeIcon className="text-sm" />
                      {badge.label}
                    </span>

                    {/* Action buttons — hidden for own admin row */}
                    {!school.is_admin && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {school.status !== 'approved' && (
                          <button
                            onClick={() => setStatus(school.id, 'approved')}
                            disabled={busy}
                            className="rounded-xl bg-horizonGreen-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-horizonGreen-600 disabled:opacity-50"
                          >
                            {busy ? '…' : 'Approve'}
                          </button>
                        )}
                        {school.status !== 'rejected' && (
                          <button
                            onClick={() => setStatus(school.id, 'rejected')}
                            disabled={busy}
                            className="rounded-xl border border-red-200 px-4 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-700/40 dark:hover:bg-red-900/20"
                          >
                            {busy ? '…' : 'Reject'}
                          </button>
                        )}
                        {school.status === 'approved' && (
                          <button
                            onClick={() => setStatus(school.id, 'suspended')}
                            disabled={busy}
                            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 transition hover:bg-lightPrimary disabled:opacity-50 dark:border-navy-600 dark:hover:bg-navy-700"
                          >
                            {busy ? '…' : 'Suspend'}
                          </button>
                        )}
                        {(school.status === 'suspended' || school.status === 'rejected') && (
                          <button
                            onClick={() => setStatus(school.id, 'pending')}
                            disabled={busy}
                            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 transition hover:bg-lightPrimary disabled:opacity-50 dark:border-navy-600 dark:hover:bg-navy-700"
                          >
                            {busy ? '…' : 'Set pending'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-600">
          GradeWise Admin · changes take effect immediately
        </p>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MdPerson,
  MdBadge,
  MdClass,
  MdCalendarToday,
  MdSchool,
  MdBarChart,
  MdHistory,
  MdArrowForward,
} from 'react-icons/md';
import { useStudent } from './StudentContext';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SchoolProfile {
  name: string;
  logo: string;
  period_system: string;
}

// ── Helper: field card ────────────────────────────────────────────────────────
function ProfileField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-lightPrimary p-4 dark:border-navy-700 dark:bg-navy-900/60">
      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-500 dark:bg-navy-700 dark:text-brand-400">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-bold text-navy-900 dark:text-white">
          {value || '—'}
        </p>
      </div>
    </div>
  );
}

// ── Quick-link card ───────────────────────────────────────────────────────────
function QuickLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md dark:border-navy-700 dark:bg-navy-800 dark:hover:border-brand-600"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-2xl text-brand-500 transition group-hover:bg-brand-100 dark:bg-navy-700 dark:text-brand-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-navy-900 dark:text-white">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{desc}</p>
      </div>
      <MdArrowForward
        size={18}
        className="shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-gray-500"
      />
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StudentProfilePage() {
  // Student data comes from shared context — no extra fetch needed.
  const { student, loading: studentLoading, error: studentError } = useStudent();
  const [school, setSchool]       = useState<SchoolProfile | null>(null);
  const [schoolLoading, setSchoolLoading] = useState(true);
  const [schoolError,   setSchoolError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/student/school-profile')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load school')))
      .then((d) => { if (!cancelled) setSchool(d.school); })
      .catch((e: Error) => { if (!cancelled) setSchoolError(e.message); })
      .finally(() => { if (!cancelled) setSchoolLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loading = studentLoading || schoolLoading;
  const error   = studentError   || schoolError;

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-8" aria-busy="true" aria-label="Loading profile…">
        {/* Header card skeleton */}
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-8 shadow-[0_8px_24px_rgba(112,144,176,0.10)] dark:border-navy-700 dark:bg-navy-800 sm:flex-row">
          <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
            <div className="h-7 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
            <div className="h-4 w-32 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
          </div>
        </div>
        {/* Details grid skeleton */}
        <div>
          <div className="mb-3 h-3 w-20 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl border border-gray-100 bg-lightPrimary p-4 dark:border-navy-700 dark:bg-navy-900/60"
              >
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-2.5 w-14 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                  <div className="h-4 w-28 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Quick links skeleton */}
        <div>
          <div className="mb-3 h-3 w-24 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800"
              >
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-28 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
                  <div className="h-3 w-48 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !student) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        {error || 'Could not load your profile. Please refresh the page.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center shadow-[0_8px_24px_rgba(112,144,176,0.10)] dark:border-navy-700 dark:bg-navy-800 sm:flex-row sm:text-left">
        {/* School logo / initials */}
        <div className="shrink-0">
          {school?.logo ? (
            <img
              src={school.logo}
              alt={school.name}
              className="h-16 w-16 rounded-full object-cover ring-2 ring-brand-100 dark:ring-navy-600"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blueSecondary text-2xl font-black text-white shadow">
              {school?.name?.slice(0, 1) ?? <MdSchool />}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {school?.name ?? 'School'}
          </p>
          <h1 className="mt-1 text-2xl font-black text-navy-900 dark:text-white">
            {student.full_name}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Student ID: <span className="font-mono font-semibold text-navy-900 dark:text-white">{student.student_code}</span>
          </p>
        </div>
      </div>

      {/* ── Profile fields ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          My Details
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ProfileField
            icon={<MdBadge size={20} />}
            label="Student ID"
            value={student.student_code}
          />
          <ProfileField
            icon={<MdPerson size={20} />}
            label="Full Name"
            value={student.full_name}
          />
          <ProfileField
            icon={<MdClass size={20} />}
            label="Grade"
            value={student.grade}
          />
          <ProfileField
            icon={<MdClass size={20} />}
            label="Section"
            value={student.section}
          />
          <ProfileField
            icon={<MdCalendarToday size={20} />}
            label="Academic Year"
            value={student.academic_year}
          />
          <ProfileField
            icon={<MdSchool size={20} />}
            label="School"
            value={school?.name ?? ''}
          />
        </div>
      </section>

      {/* ── Quick links ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Quick Access
        </h2>
        <div className="space-y-3">
          <QuickLink
            href="/student/results"
            icon={<MdBarChart />}
            title="My Results"
            desc="View your published scores, grades, and rankings"
          />
          <QuickLink
            href="/student/history"
            icon={<MdHistory />}
            title="Academic History"
            desc="A timeline of all your published periods"
          />
        </div>
      </section>
    </div>
  );
}

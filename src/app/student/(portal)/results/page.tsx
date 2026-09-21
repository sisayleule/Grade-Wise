'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MdBarChart,
  MdArrowForward,
  MdSchool,
  MdCalendarToday,
  MdClass,
} from 'react-icons/md';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Period {
  batchId:      string;
  semester:     string;
  year:         string;
  grade:        string;
  section:      string;
  publishedAt:  string;
  subjectCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Encode a batchId (which may contain | for Full Year) safely in a URL segment. */
function encodeBatchId(id: string) {
  return encodeURIComponent(id);
}

/** Colour + label for each period type */
function periodBadge(semester: string) {
  if (semester === 'Full Year') {
    return { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-400' };
  }
  if (semester.startsWith('Quarter')) {
    return { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-300', dot: 'bg-purple-400' };
  }
  return { bg: 'bg-brand-50 dark:bg-navy-700', text: 'text-brand-600 dark:text-brand-300', dot: 'bg-brand-500' };
}

// ── Period card ───────────────────────────────────────────────────────────────
function PeriodCard({ period }: { period: Period }) {
  const badge = periodBadge(period.semester);

  return (
    <Link
      href={`/student/results/${encodeBatchId(period.batchId)}`}
      className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md dark:border-navy-700 dark:bg-navy-800 dark:hover:border-brand-600"
    >
      {/* Icon */}
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-2xl text-brand-500 transition group-hover:bg-brand-100 dark:bg-navy-700 dark:text-brand-400">
        <MdBarChart />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-navy-900 dark:text-white">
            {period.semester}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.bg} ${badge.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
            {period.semester === 'Full Year' ? 'Full Year' : period.semester.startsWith('Quarter') ? 'Quarter' : 'Semester'}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <MdCalendarToday size={12} />
            {period.year}
          </span>
          <span className="flex items-center gap-1">
            <MdClass size={12} />
            Grade {period.grade} — Section {period.section}
          </span>
          <span className="flex items-center gap-1">
            <MdSchool size={12} />
            {period.subjectCount} subject{period.subjectCount !== 1 ? 's' : ''}
          </span>
        </div>

        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Published {formatDate(period.publishedAt)}
        </p>
      </div>

      <MdArrowForward
        size={18}
        className="shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-gray-500"
      />
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StudentResultsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/student/results')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load results')))
      .then((d) => { if (!cancelled) setPeriods(d.periods ?? []); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading results…">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-36 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
        </div>
        {/* Card skeletons */}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800"
          >
            <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
              <div className="h-3 w-48 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
              <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
            </div>
            <div className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
          </div>
        ))}
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-navy-900 dark:text-white">My Results</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Select a period to view your full result report.
        </p>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {periods.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-navy-700 dark:bg-navy-800">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-3xl text-brand-400 dark:bg-navy-700">
            <MdBarChart />
          </div>
          <h2 className="mt-5 text-lg font-bold text-navy-900 dark:text-white">
            No results published yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            No results have been published yet. Check back once your teacher publishes your results.
          </p>
        </div>
      ) : (
        /* ── Period list ─────────────────────────────────────────────────── */
        <div className="space-y-3">
          {periods.map((p) => (
            <PeriodCard key={p.batchId} period={p} />
          ))}
        </div>
      )}
    </div>
  );
}

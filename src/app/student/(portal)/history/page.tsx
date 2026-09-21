'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MdHistory,
  MdArrowForward,
  MdCheckCircle,
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

function encodeBatchId(id: string) {
  return encodeURIComponent(id);
}

/** Group periods by academic year, preserving chronological order within year */
function groupByYear(periods: Period[]): Map<string, Period[]> {
  const map = new Map<string, Period[]>();
  for (const p of periods) {
    if (!map.has(p.year)) map.set(p.year, []);
    map.get(p.year)!.push(p);
  }
  return map;
}

/** Dot colour per period type */
function dotColour(semester: string) {
  if (semester === 'Full Year')          return 'bg-amber-400';
  if (semester.startsWith('Quarter'))    return 'bg-purple-500';
  return 'bg-brand-500';
}

// ── Timeline item ─────────────────────────────────────────────────────────────
function TimelineItem({
  period,
  isLast,
}: {
  period: Period;
  isLast: boolean;
}) {
  return (
    <div className="relative flex gap-4">
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[17px] top-9 h-[calc(100%+4px)] w-0.5 bg-gray-200 dark:bg-navy-700" />
      )}

      {/* Dot */}
      <div className="relative z-10 mt-1 flex h-9 w-9 shrink-0 items-center justify-center">
        <span className={`h-3 w-3 rounded-full ring-4 ring-white dark:ring-navy-800 ${dotColour(period.semester)}`} />
      </div>

      {/* Card */}
      <Link
        href={`/student/results/${encodeBatchId(period.batchId)}`}
        className="group mb-4 flex flex-1 items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-brand-300 hover:shadow-md dark:border-navy-700 dark:bg-navy-800 dark:hover:border-brand-600"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-navy-900 dark:text-white">
              {period.semester}
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <MdCheckCircle size={13} />
              Published
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Grade {period.grade} — Section {period.section}
            &nbsp;·&nbsp;
            {period.subjectCount} subject{period.subjectCount !== 1 ? 's' : ''}
            &nbsp;·&nbsp;
            {formatDate(period.publishedAt)}
          </p>
        </div>
        <MdArrowForward
          size={17}
          className="mt-1 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-gray-500"
        />
      </Link>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AcademicHistoryPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/student/results')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load history')))
      .then((d) => { if (!cancelled) setPeriods(d.periods ?? []); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-8" aria-busy="true" aria-label="Loading academic history…">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-44 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          <div className="h-4 w-72 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
        </div>
        {/* Year group skeleton */}
        <div className="space-y-4">
          {/* Year badge row */}
          <div className="flex items-center gap-3">
            <div className="h-6 w-24 animate-pulse rounded-lg bg-gray-300 dark:bg-navy-600" />
            <div className="h-px flex-1 bg-gray-200 dark:bg-navy-700" />
          </div>
          {/* Timeline items */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="relative flex gap-4">
              <div className="relative z-10 mt-1 flex h-9 w-9 shrink-0 items-center justify-center">
                <span className="h-3 w-3 animate-pulse rounded-full bg-gray-300 ring-4 ring-white dark:bg-navy-600 dark:ring-navy-800" />
              </div>
              <div className="mb-4 flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm dark:border-navy-700 dark:bg-navy-800">
                <div className="space-y-2">
                  <div className="h-4 w-28 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
                  <div className="h-3 w-56 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
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

  const grouped = groupByYear(periods);
  // Sort years descending (most recent first)
  const sortedYears = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-navy-900 dark:text-white">Academic History</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          A chronological record of all your published periods.
        </p>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {periods.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-navy-700 dark:bg-navy-800">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-3xl text-brand-400 dark:bg-navy-700">
            <MdHistory />
          </div>
          <h2 className="mt-5 text-lg font-bold text-navy-900 dark:text-white">
            No results published yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            No results have been published yet. Check back once your teacher publishes your results.
          </p>
        </div>
      ) : (
        /* ── Timeline ────────────────────────────────────────────────────── */
        <div className="space-y-8">
          {sortedYears.map((year) => {
            const yearPeriods = grouped.get(year)!;
            return (
              <section key={year}>
                {/* Year badge */}
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-lg bg-navy-900 px-3 py-1 text-xs font-bold tracking-wide text-white dark:bg-navy-700">
                    {year}
                  </div>
                  <div className="h-px flex-1 bg-gray-200 dark:bg-navy-700" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {yearPeriods.length} period{yearPeriods.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Items for this year */}
                <div>
                  {yearPeriods.map((p, i) => (
                    <TimelineItem
                      key={p.batchId}
                      period={p}
                      isLast={i === yearPeriods.length - 1}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { MdArrowBack, MdDownload, MdPrint } from 'react-icons/md';
import { getLetterGrade, statusFor } from 'lib/grades';

// ── Types ─────────────────────────────────────────────────────────────────────
interface StudentResult {
  id:          string;
  name:        string;
  scores:      Record<string, number | string>;
  total:       number;
  maximum:     number;
  average:     number;
  percentage:  number;
  rank:        number;
  status:      string;
  letterGrade: string;
}

interface PeriodDetail {
  batchId:     string;
  semester:    string;
  year:        string;
  grade:       string;
  section:     string;
  subjects:    string[];
  publishedAt: string;
  student:     StudentResult;
}

interface SchoolProfile {
  name:          string;
  teacher:       string;
  principal:     string;
  logo:          string;
  footer:        string;
  period_system: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Grade badge colours matching the teacher report aesthetic */
function gradeBg(grade: string) {
  if (['A+', 'A'].includes(grade))       return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (['B+', 'B'].includes(grade))       return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
  if (['C+', 'C'].includes(grade))       return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (['D+', 'D'].includes(grade))       return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${
        highlight
          ? 'bg-navy-900 dark:bg-navy-950'
          : 'border border-gray-100 bg-lightPrimary dark:border-navy-700 dark:bg-navy-900/60'
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          highlight ? 'text-white/60' : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-black ${
          highlight ? 'text-white' : 'text-navy-900 dark:text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PeriodDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = use(params);

  const [detail, setDetail]       = useState<PeriodDetail | null>(null);
  const [school, setSchool]       = useState<SchoolProfile | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;

    // batchId may contain '|' (Full Year); it was encoded with encodeURIComponent
    // by the results list. Next.js decodes it before passing to params, so we
    // re-encode for the API call.
    const apiId = encodeURIComponent(batchId);

    Promise.all([
      fetch(`/api/student/results/${apiId}`).then((r) =>
        r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error || 'Not found')))
      ),
      fetch('/api/student/school-profile').then((r) =>
        r.ok ? r.json() : Promise.reject(new Error('Failed to load school profile'))
      ),
    ])
      .then(([resultData, schoolData]) => {
        if (cancelled) return;
        setDetail(resultData.result);
        setSchool(schoolData.school);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [batchId]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !detail) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link
          href="/student/results"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-500 hover:underline"
        >
          <MdArrowBack /> Back to Results
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          {error || 'Result not found or not yet published.'}
        </div>
      </div>
    );
  }

  const { student, subjects } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* ── Back + actions ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/student/results"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-500 hover:underline"
        >
          <MdArrowBack size={18} /> Back to Results
        </Link>
        <div className="flex items-center gap-2">
          {/* Download DOCX — runs entirely client-side using data already on screen */}
          <button
            disabled={downloading}
            onClick={async () => {
              if (!detail || !school) return;
              setDownloading(true);
              try {
                const { generateStudentReportDoc } = await import('lib/docx/generators');
                const periodSystem = (school.period_system === 'quarter' ? 'quarter' : 'semester') as 'quarter' | 'semester';
                const isFullYear   = detail.semester === 'Full Year';

                // For Full Year we need per-period raw scores.
                // Re-use the same batchId segments the server used to compute the merged result.
                let periodScores: Array<{ periodLabel: string; scores: Record<string, string | number> }> | undefined;
                if (isFullYear) {
                  const rawIds = decodeURIComponent(batchId).split('|').filter(Boolean);
                  const periodLabels = periodSystem === 'quarter'
                    ? ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']
                    : ['Semester 1', 'Semester 2'];
                  // Fetch each individual period result in parallel for per-period scores
                  const fetches = await Promise.all(
                    rawIds.map((id) =>
                      fetch(`/api/student/results/${encodeURIComponent(id)}`)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null)
                    )
                  );
                  periodScores = fetches.flatMap((d, i) =>
                    d?.result ? [{ periodLabel: periodLabels[i] ?? `Period ${i + 1}`, scores: d.result.student.scores }] : []
                  );
                }

                await generateStudentReportDoc({
                  student: {
                    ...detail.student,
                    letterGrade: detail.student.letterGrade,
                    status:      detail.student.status,
                  } as any,
                  subjects:     detail.subjects,
                  school: {
                    name:      school.name,
                    teacher:   school.teacher,
                    principal: school.principal,
                    logo:      school.logo,
                    footer:    school.footer,
                  },
                  year:         detail.year,
                  grade:        detail.grade,
                  section:      detail.section,
                  semester:     detail.semester,
                  periodSystem,
                  periodScores,
                });
              } catch (e) {
                console.error('[student download report]', e);
              } finally {
                setDownloading(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(67,24,255,0.25)] transition hover:opacity-90 disabled:opacity-50"
          >
            <MdDownload size={18} />
            {downloading ? 'Generating…' : 'Download Report'}
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-white dark:border-navy-600 dark:text-gray-400 dark:hover:bg-navy-800"
          >
            <MdPrint size={18} /> Print
          </button>
        </div>
      </div>

      {/* ── Report card ──────────────────────────────────────────────────── */}
      <article className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_32px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">

        {/* Header */}
        <div className="border-b-2 border-brand-500 px-4 py-6 text-center sm:px-8">
          {school?.logo ? (
            <img
              src={school.logo}
              alt={school.name}
              className="mx-auto mb-3 h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blueSecondary text-xl font-black text-white">
              {school?.name?.slice(0, 1) ?? 'S'}
            </div>
          )}
          <h1 className="text-xl font-black text-navy-900 dark:text-white">
            {school?.name ?? 'School'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Official Academic Progress Report
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-600 dark:bg-navy-700 dark:text-brand-300">
            {detail.semester} · {detail.year}
          </div>
        </div>

        {/* Student meta */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-5 text-sm sm:grid-cols-2 sm:px-8 md:grid-cols-3">
          {[
            ['Student',       student.name],
            ['Student ID',    student.id],
            ['Grade',         detail.grade],
            ['Section',       detail.section],
            ['Academic Year', detail.year],
            ['Class Rank',    `#${student.rank}`],
          ].map(([label, value]) => (
            <p key={label}>
              <span className="font-semibold text-gray-500 dark:text-gray-400">{label}: </span>
              <span className="font-bold text-navy-900 dark:text-white">{value}</span>
            </p>
          ))}
        </div>

        {/* Subject table */}
        <div className="overflow-x-auto px-4 pb-2 sm:px-8">
          <table className="w-full min-w-[340px] border-collapse text-sm">
            <thead>
              <tr className="rounded-xl bg-navy-900 text-left text-white dark:bg-navy-950">
                <th className="rounded-l-lg p-3 font-bold">Subject</th>
                <th className="p-3 text-right font-bold">Score</th>
                <th className="p-3 text-right font-bold">Grade</th>
                <th className="rounded-r-lg p-3 text-right font-bold">Maximum</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject, i) => {
                const raw    = student.scores[subject];
                const score  = raw !== undefined && raw !== '' ? Number(raw) : null;
                const letter = score !== null ? getLetterGrade(score) : '—';
                return (
                  <tr
                    key={subject}
                    className={`border-b border-gray-100 dark:border-navy-700 ${
                      i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-navy-900/20'
                    }`}
                  >
                    <td className="p-3 font-medium text-navy-900 dark:text-white">
                      {subject}
                    </td>
                    <td className="p-3 text-right font-bold text-navy-900 dark:text-white">
                      {score !== null ? score : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${gradeBg(letter)}`}>
                        {letter}
                      </span>
                    </td>
                    <td className="p-3 text-right text-gray-500 dark:text-gray-400">100</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 px-4 py-6 sm:grid-cols-3 sm:px-8 lg:grid-cols-5">
          <Stat label="Total"      value={`${student.total}/${student.maximum}`} />
          <Stat label="Average"    value={student.average.toFixed(1)} />
          <Stat label="Percentage" value={`${student.percentage.toFixed(1)}%`} />
          <Stat label="Grade"      value={student.letterGrade} highlight />
          <Stat label="Remark"     value={student.status} />
        </div>

        {/* Footer signatures */}
        {(school?.teacher || school?.principal) && (
          <div className="grid grid-cols-2 gap-4 border-t border-gray-100 px-4 py-6 text-center text-sm sm:gap-10 sm:px-8 dark:border-navy-700">
            <div className="border-t-2 border-gray-200 pt-2 dark:border-navy-600">
              <p className="font-semibold text-navy-900 dark:text-white">
                {school.teacher || '_______________'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Class Teacher</p>
            </div>
            <div className="border-t-2 border-gray-200 pt-2 dark:border-navy-600">
              <p className="font-semibold text-navy-900 dark:text-white">
                {school.principal || '_______________'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Principal / Authorised Person</p>
            </div>
          </div>
        )}

        {/* Footer text */}
        {school?.footer && (
          <p className="border-t border-gray-100 px-4 py-4 text-center text-xs text-gray-500 sm:px-8 dark:border-navy-700 dark:text-gray-400">
            {school.footer} · Published {formatDate(detail.publishedAt)}
          </p>
        )}
      </article>
    </div>
  );
}

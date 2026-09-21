'use client';
import { useEffect, useState } from 'react';
import { MdAssignment, MdCalendarToday, MdCheckCircle, MdDownload } from 'react-icons/md';
import { useStudent } from '../StudentContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityScore {
  score_id:        string;
  activity_id:     string;
  activity_type:   string;
  name:            string;
  subject:         string;
  activity_date:   string | null;
  max_score:       number;
  teacher_comment: string | null;
  score:           number | null;
  published_at:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(d + 'T00:00:00'));
  } catch { return d; }
}

function typeBadgeCls(t: string) {
  switch (t) {
    case 'Quiz':         return 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300';
    case 'Test':         return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300';
    case 'Assessment':   return 'bg-brand-50 text-brand-700 dark:bg-navy-700 dark:text-brand-300';
    case 'Assignment':   return 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300';
    case 'Midterm Exam':
    case 'Final Exam':   return 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300';
    default:             return 'bg-gray-100 text-gray-700 dark:bg-navy-700 dark:text-gray-300';
  }
}

/** Colour bar behind the score fraction */
function scorePercent(score: number | null, max: number) {
  if (score === null || max <= 0) return 0;
  return Math.min(100, Math.round((score / max) * 100));
}

function scoreColour(pct: number) {
  if (pct >= 80) return 'bg-horizonGreen-500';
  if (pct >= 60) return 'bg-brand-500';
  if (pct >= 40) return 'bg-amber-400';
  return 'bg-rose-400';
}

// ── Activity card ─────────────────────────────────────────────────────────────

function ActivityCard({
  item,
  schoolName,
  schoolTeacher,
  schoolPrincipal,
  schoolFooter,
  studentName,
  studentCode,
  grade,
  section,
  year,
}: {
  item:            ActivityScore;
  schoolName:      string;
  schoolTeacher:   string;
  schoolPrincipal: string;
  schoolFooter:    string;
  studentName:     string;
  studentCode:     string;
  grade:           string;
  section:         string;
  year:            string;
}) {
  const [downloading, setDownloading] = useState(false);
  const pct = scorePercent(item.score, item.max_score);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${typeBadgeCls(item.activity_type)}`}>
              {item.activity_type}
            </span>
            {item.activity_date && (
              <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <MdCalendarToday size={11} /> {fmtDate(item.activity_date)}
              </span>
            )}
          </div>
          <p className="mt-1.5 font-bold text-navy-900 dark:text-white">{item.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{item.subject}</p>
        </div>

        {/* Score badge */}
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black text-navy-900 dark:text-white">
            {item.score !== null ? item.score : '—'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            out of {item.max_score}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {item.score !== null && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>{pct}%</span>
            <span className="flex items-center gap-1 text-horizonGreen-600 dark:text-horizonGreen-400 font-semibold">
              <MdCheckCircle size={12} /> Published
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
            <div
              className={`h-full rounded-full transition-all ${scoreColour(pct)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Teacher comment */}
      {item.teacher_comment && (
        <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800 dark:border-navy-600 dark:bg-navy-700/60 dark:text-brand-300">
          <span className="font-semibold">Teacher: </span>
          {item.teacher_comment}
        </div>
      )}

      {/* Download DOCX — only when there is a published score */}
      {item.score !== null && (
        <div className="mt-4 flex justify-end">
          <button
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                const { generateActivityReportDoc } = await import('lib/docx/generators');
                await generateActivityReportDoc({
                  activity: {
                    activity_type:   item.activity_type,
                    name:            item.name,
                    subject:         item.subject,
                    activity_date:   item.activity_date,
                    max_score:       item.max_score,
                    description:     null,
                    teacher_comment: item.teacher_comment ?? null,
                  },
                  // Student's own single published score row
                  scores: [{
                    student_code: studentCode,
                    full_name:    studentName,
                    roll_number:  null,
                    score:        item.score,
                  }],
                  school: {
                    name:      schoolName,
                    teacher:   schoolTeacher,
                    principal: schoolPrincipal,
                    logo:      '',
                    footer:    schoolFooter,
                  },
                  year,
                  grade,
                  section,
                });
              } catch (e) {
                console.error('[student download activity]', e);
              } finally {
                setDownloading(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-navy-600 dark:text-gray-400 dark:hover:bg-navy-700"
          >
            <MdDownload size={14} />
            {downloading ? 'Generating…' : 'Download Report'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface SchoolProfile {
  name:      string;
  teacher:   string;
  principal: string;
  footer:    string;
}

export default function StudentActivitiesPage() {
  const { student } = useStudent();

  const [items,   setItems]   = useState<ActivityScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const [school,  setSchool]  = useState<SchoolProfile>({ name: '', teacher: '', principal: '', footer: '' });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/student/activities')
        .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load activities'))),
      fetch('/api/student/school-profile')
        .then(r => r.ok ? r.json() : null),
    ])
      .then(([actData, schoolData]) => {
        if (cancelled) return;
        setItems(actData.activities ?? []);
        if (schoolData?.school) {
          setSchool({
            name:      schoolData.school.name      ?? '',
            teacher:   schoolData.school.teacher   ?? '',
            principal: schoolData.school.principal ?? '',
            footer:    schoolData.school.footer    ?? '',
          });
        }
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading activities…">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
        </div>
        {/* Card skeletons */}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <div className="h-5 w-14 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                  <div className="h-5 w-20 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
                </div>
                <div className="h-4 w-48 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
                <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
              </div>
              <div className="shrink-0 space-y-1 text-right">
                <div className="h-8 w-10 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
                <div className="h-3 w-14 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
              </div>
            </div>
            <div className="mt-4 space-y-1">
              <div className="h-2 w-full animate-pulse rounded-full bg-gray-100 dark:bg-navy-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }

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
        <h1 className="text-2xl font-black text-navy-900 dark:text-white">My Activities</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Your published quiz, test, assignment and exam scores.
        </p>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-navy-700 dark:bg-navy-800">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-3xl text-brand-400 dark:bg-navy-700">
            <MdAssignment />
          </div>
          <h2 className="mt-5 text-lg font-bold text-navy-900 dark:text-white">
            No activities published yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            No activity scores have been published yet. Check back once your
            teacher publishes your quiz, test, or assignment scores.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <ActivityCard
              key={item.score_id}
              item={item}
              schoolName={school.name}
              schoolTeacher={school.teacher}
              schoolPrincipal={school.principal}
              schoolFooter={school.footer}
              studentName={student?.full_name ?? ''}
              studentCode={student?.student_code ?? ''}
              grade={student?.grade ?? ''}
              section={student?.section ?? ''}
              year={student?.academic_year ?? ''}
            />
          ))}
        </div>
      )}
    </div>
  );
}

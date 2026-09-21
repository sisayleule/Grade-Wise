'use client';
/**
 * Assessments component — teacher-facing Activities & Assessments management.
 *
 * Three views rendered inline (no routing):
 *   'list'   — table of all activities for the selected class + Create button
 *   'create' — form to create a new activity
 *   'scores' — score entry table for a selected activity, with CSV import +
 *              publish controls
 *
 * This module is entirely independent of quarter/semester result_batches.
 * Activity scores NEVER affect any student's total, average, rank, or grade.
 */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdArrowBack,
  MdAssignment,
  MdCheckCircle,
  MdChevronRight,
  MdClose,
  MdDeleteOutline,
  MdDownload,
  MdErrorOutline,
  MdGridOn,
  MdPublish,
  MdSave,
  MdWarningAmber,
} from 'react-icons/md';
import { ACTIVITY_TYPES } from 'lib/activityTypes';
import type { ActivityType } from 'lib/activityTypes';

// ── Constants ─────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

type PublishStatus = 'draft' | 'partially_published' | 'published';

interface Activity {
  id:              string;
  activity_type:   ActivityType;
  name:            string;
  subject:         string;
  academic_year:   string;
  grade:           string;
  section:         string;
  activity_date:   string | null;
  max_score:       number;
  description:     string | null;
  teacher_comment: string | null;
  publish_status:  PublishStatus;
  created_at:      string;
  // Counts returned by GET /api/activities (derived from activity_scores)
  published_count: number;
  scored_count:    number;
}

interface StudentScoreRow {
  student_ref_id: string;
  student_code:   string;
  full_name:      string;
  roll_number:    string | null;
  score_id:       string | null;
  score:          number | null;
  is_published:   boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      .format(new Date(d + 'T00:00:00'));
  } catch { return d; }
}

function typeBadgeCls(t: string) {
  switch (t) {
    case 'Quiz':        return 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300';
    case 'Test':        return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300';
    case 'Assessment':  return 'bg-brand-50 text-brand-700 dark:bg-navy-700 dark:text-brand-300';
    case 'Assignment':  return 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300';
    case 'Midterm Exam':
    case 'Final Exam':  return 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300';
    default:            return 'bg-gray-100 text-gray-700 dark:bg-navy-700 dark:text-gray-300';
  }
}

/** Render the right status badge for the list view based on publish_status + counts */
function PublishBadge({
  status,
  publishedCount,
  scoredCount,
}: {
  status:         PublishStatus;
  publishedCount: number;
  scoredCount:    number;
}) {
  if (status === 'published') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-horizonGreen-50 px-2.5 py-0.5 text-xs font-bold text-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300">
        <MdCheckCircle size={11} /> Published
      </span>
    );
  }
  if (status === 'partially_published') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-600 dark:bg-navy-700 dark:text-brand-300">
        <MdPublish size={11} /> {publishedCount} of {scoredCount}
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
      Draft
    </span>
  );
}

/** CSV template download for score import */
function downloadScoreTemplate(students: StudentScoreRow[], maxScore: number) {
  const header = 'student_id,full_name,score\n';
  const rows = students.map(s =>
    `${s.student_code},${s.full_name.replace(/,/g, ' ')},`
  ).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `scores_template_max${maxScore}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse a CSV/XLSX file into { student_code → score } map */
async function parseScoreFile(
  file: File
): Promise<{ map: Map<string, number | null>; warnings: string[] }> {
  const map      = new Map<string, number | null>();
  const warnings: string[] = [];
  const name     = file.name.toLowerCase();

  let rows2d: string[][] = [];

  if (name.endsWith('.csv')) {
    const text = new TextDecoder().decode(await file.arrayBuffer());
    const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
    rows2d = lines.map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    rows2d = raw.map(r => r.map(c => String(c ?? '').trim()));
  } else {
    return { map, warnings: ['Only .csv, .xlsx, and .xls files are supported.'] };
  }

  if (!rows2d.length) return { map, warnings: ['File is empty.'] };

  // Detect header row — look for "student_id" or "id" and "score" columns
  const ID_HDR    = /^(student[\s_]?id|student[\s_]?code|id|code)$/i;
  const SCORE_HDR = /^score$/i;

  let idCol = -1, scoreCol = -1, dataStart = 0;

  for (let ri = 0; ri < Math.min(rows2d.length, 5); ri++) {
    const cells = rows2d[ri];
    cells.forEach((c, ci) => {
      if (ID_HDR.test(c)    && idCol    === -1) idCol    = ci;
      if (SCORE_HDR.test(c) && scoreCol === -1) scoreCol = ci;
    });
    if (idCol !== -1 && scoreCol !== -1) { dataStart = ri + 1; break; }
  }

  // Fallback: assume col 0 = id, col 2 = score (matches downloaded template)
  if (idCol === -1)    idCol    = 0;
  if (scoreCol === -1) scoreCol = 2;

  for (let ri = dataStart; ri < rows2d.length; ri++) {
    const cells = rows2d[ri];
    const code  = (cells[idCol] ?? '').trim();
    const raw   = (cells[scoreCol] ?? '').trim();
    if (!code) continue;
    if (!raw) { map.set(code, null); continue; }
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      warnings.push(`Row ${ri + 1}: "${raw}" is not a valid score for ${code} — skipped.`);
      continue;
    }
    map.set(code, v);
  }

  return { map, warnings };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[20px] border border-gray-200/70 bg-white p-12 text-center shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700">
        <MdAssignment />
      </div>
      <p className="mt-4 font-bold text-navy-900 dark:text-white">No activities yet</p>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Create a Quiz, Test, Assignment or other activity for this class.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90"
      >
        <MdAdd /> Create Activity
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Assessments({
  year,
  grade,
  section,
  school,
  periodSystem,
}: {
  year:         string;
  grade:        string;
  section:      string;
  school:       { name: string; teacher: string; principal: string; logo?: string; footer: string };
  periodSystem: 'semester' | 'quarter';
}) {
  // ── View state ─────────────────────────────────────────────────────────────
  type View = 'list' | 'create' | 'scores';
  const [view,            setView]           = useState<View>('list');
  const [selectedId,      setSelectedId]     = useState<string | null>(null);

  // ── Activity list ──────────────────────────────────────────────────────────
  const [activities,      setActivities]     = useState<Activity[]>([]);
  const [listLoading,     setListLoading]    = useState(false);
  const [listError,       setListError]      = useState('');

  // ── Create form ────────────────────────────────────────────────────────────
  const [cType,           setCType]          = useState<ActivityType>('Quiz');
  const [cName,           setCName]          = useState('');
  const [cSubject,        setCSubject]       = useState('');
  const [cDate,           setCDate]          = useState('');
  const [cMaxScore,       setCMaxScore]      = useState('100');
  const [cDesc,           setCDesc]          = useState('');
  const [cComment,        setCComment]       = useState('');
  const [creating,        setCreating]       = useState(false);
  const [createError,     setCreateError]    = useState('');

  // ── Score entry ────────────────────────────────────────────────────────────
  const [scoreActivity,   setScoreActivity]  = useState<Activity | null>(null);
  const [students,        setStudents]       = useState<StudentScoreRow[]>([]);
  const [draftScores,     setDraftScores]    = useState<Map<string, string>>(new Map());
  const [scoresLoading,   setScoresLoading]  = useState(false);
  const [scoresError,     setScoresError]    = useState('');
  const [savingScores,    setSavingScores]   = useState(false);
  const [saveScoreMsg,    setSaveScoreMsg]   = useState('');
  const [publishing,      setPublishing]     = useState(false);
  const [publishMsg,      setPublishMsg]     = useState('');
  const [selectMode,      setSelectMode]     = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [importWarn,      setImportWarn]     = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const classLabel = `${grade}${section}`;

  // ── Load activity list ─────────────────────────────────────────────────────
  const loadActivities = () => {
    if (!year || !grade || !section) return;
    setListLoading(true);
    setListError('');
    fetch(
      `/api/activities?year=${encodeURIComponent(year)}&grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}`
    )
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load activities')))
      .then(d => setActivities(d.activities ?? []))
      .catch((e: Error) => setListError(e.message))
      .finally(() => setListLoading(false));
  };

  useEffect(() => {
    loadActivities();
    setView('list');
    setSelectedId(null);
  }, [year, grade, section]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load scores for selected activity ─────────────────────────────────────
  useEffect(() => {
    if (view !== 'scores' || !selectedId) return;
    setScoresLoading(true);
    setScoresError('');
    setDraftScores(new Map());
    setImportWarn([]);
    setSaveScoreMsg('');
    setPublishMsg('');
    setSelectMode(false);
    setSelectedStudents(new Set());

    fetch(`/api/activities/${selectedId}/scores`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load scores')))
      .then(d => {
        setScoreActivity(d.activity);
        setStudents(d.students ?? []);
        // Initialise draft from saved scores
        const m = new Map<string, string>();
        for (const s of d.students ?? []) {
          m.set(s.student_ref_id, s.score !== null ? String(s.score) : '');
        }
        setDraftScores(m);
      })
      .catch((e: Error) => setScoresError(e.message))
      .finally(() => setScoresLoading(false));
  }, [view, selectedId]);

  // ── Validation: scores in draft ────────────────────────────────────────────
  const scoreErrors = useMemo(() => {
    if (!scoreActivity) return new Map<string, string>();
    const errs = new Map<string, string>();
    draftScores.forEach((val, ref) => {
      if (val === '') return;
      const v = Number(val);
      if (!Number.isFinite(v))            errs.set(ref, 'Not a valid number');
      else if (v < 0)                     errs.set(ref, 'Cannot be negative');
      else if (v > scoreActivity.max_score) errs.set(ref, `Exceeds max (${scoreActivity.max_score})`);
    });
    return errs;
  }, [draftScores, scoreActivity]);

  const hasScoreErrors = scoreErrors.size > 0;

  // ── Create activity ────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_type:   cType,
          name:            cName.trim(),
          subject:         cSubject.trim(),
          academic_year:   year,
          grade,
          section,
          activity_date:   cDate || null,
          max_score:       Number(cMaxScore) || 100,
          description:     cDesc.trim() || null,
          teacher_comment: cComment.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create activity');
      // Reset form
      setCName(''); setCSubject(''); setCDate(''); setCMaxScore('100');
      setCDesc(''); setCComment(''); setCType('Quiz');
      loadActivities();
      setView('list');
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // ── Save scores as draft ───────────────────────────────────────────────────
  const handleSaveScores = async () => {
    if (hasScoreErrors || !selectedId) return;
    setSavingScores(true);
    setSaveScoreMsg('');
    try {
      const scores = students.map(s => ({
        student_ref_id: s.student_ref_id,
        score: draftScores.get(s.student_ref_id) !== ''
          ? Number(draftScores.get(s.student_ref_id))
          : null,
      }));
      const res = await fetch(`/api/activities/${selectedId}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save scores');
      setSaveScoreMsg(`Saved ${data.saved} scores as draft.`);
      setTimeout(() => setSaveScoreMsg(''), 4000);
      // Refresh
      const refreshed = await fetch(`/api/activities/${selectedId}/scores`).then(r => r.json());
      setStudents(refreshed.students ?? []);
    } catch (e: any) {
      setSaveScoreMsg('Error: ' + e.message);
    } finally {
      setSavingScores(false);
    }
  };

  // ── Publish ────────────────────────────────────────────────────────────────
  const handlePublish = async (studentRefIds?: string[]) => {
    if (!selectedId) return;
    setPublishing(true);
    setPublishMsg('');
    try {
      const body: Record<string, any> = { publish_status: 'published' };
      if (studentRefIds) body.student_ref_ids = studentRefIds;

      const res = await fetch(`/api/activities/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');

      setPublishMsg(
        studentRefIds
          ? `Published to ${studentRefIds.length} student${studentRefIds.length !== 1 ? 's' : ''}.`
          : 'Published to all students.'
      );
      setSelectMode(false);
      setSelectedStudents(new Set());
      // Refresh activity status and score rows
      loadActivities();
      const refreshed = await fetch(`/api/activities/${selectedId}/scores`).then(r => r.json());
      setScoreActivity(refreshed.activity);
      setStudents(refreshed.students ?? []);
      setTimeout(() => setPublishMsg(''), 5000);
    } catch (e: any) {
      setPublishMsg('Error: ' + e.message);
    } finally {
      setPublishing(false);
    }
  };

  // ── Delete activity ────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this activity and all its scores? This cannot be undone.')) return;
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
    loadActivities();
  };

  // ── CSV import ─────────────────────────────────────────────────────────────
  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !scoreActivity) return;
    e.target.value = '';
    setImportWarn([]);

    const { map, warnings } = await parseScoreFile(file);
    setImportWarn(warnings);

    if (!map.size) return;

    // Match imported codes to roster students
    const newDraft = new Map(draftScores);
    let matched = 0;
    for (const s of students) {
      if (map.has(s.student_code)) {
        const v = map.get(s.student_code);
        newDraft.set(s.student_ref_id, v !== null && v !== undefined ? String(v) : '');
        matched++;
      }
    }
    setDraftScores(newDraft);
    if (matched === 0) {
      setImportWarn(w => [...w, 'No student IDs in the file matched this class roster.']);
    } else {
      setImportWarn(w => [...w, `Imported scores for ${matched} student${matched !== 1 ? 's' : ''}.`]);
    }
  };

  // ── Render: LIST ───────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-brand-500">ASSESSMENTS & ACTIVITIES</p>
            <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
              {classLabel} · {year}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Quizzes, tests, assignments and exams — independent of semester results.
            </p>
          </div>
          <button
            onClick={() => setView('create')}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90"
          >
            <MdAdd /> Create Activity
          </button>
        </div>

        {listError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
            {listError}
          </div>
        )}

        {listLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : activities.length === 0 ? (
          <EmptyState onCreate={() => setView('create')} />
        ) : (
          <div className="rounded-[20px] border border-gray-200/70 bg-white shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-lightPrimary/60 text-left text-xs uppercase tracking-wide text-gray-600 dark:bg-navy-700 dark:text-gray-400">
                  <tr>
                    <th className="p-3.5 font-bold">Type</th>
                    <th className="p-3.5 font-bold">Name</th>
                    <th className="p-3.5 font-bold">Subject</th>
                    <th className="p-3.5 font-bold">Date</th>
                    <th className="p-3.5 font-bold">Max Score</th>
                    <th className="p-3.5 font-bold">Status</th>
                    <th className="p-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t border-gray-100 transition hover:bg-lightPrimary/40 dark:border-navy-700 dark:hover:bg-navy-700/30"
                    >
                      <td className="p-3.5">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${typeBadgeCls(a.activity_type)}`}>
                          {a.activity_type}
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-navy-900 dark:text-white">
                        {a.name}
                      </td>
                      <td className="p-3.5 text-gray-600 dark:text-gray-400">{a.subject}</td>
                      <td className="p-3.5 text-gray-600 dark:text-gray-400">{fmtDate(a.activity_date)}</td>
                      <td className="p-3.5 font-bold text-navy-900 dark:text-white">{a.max_score}</td>
                      <td className="p-3.5">
                        <PublishBadge
                          status={a.publish_status}
                          publishedCount={a.published_count ?? 0}
                          scoredCount={a.scored_count ?? 0}
                        />
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => { setSelectedId(a.id); setView('scores'); }}
                            className="inline-flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-500 transition hover:bg-brand-50 dark:hover:bg-navy-700"
                          >
                            Enter Scores <MdChevronRight className="text-base" />
                          </button>
                          <button
                            onClick={() => handleDelete(a.id)}
                            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                            title="Delete activity"
                          >
                            <MdDeleteOutline size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: CREATE ─────────────────────────────────────────────────────────
  if (view === 'create') {
    const inputCls = 'h-10 w-full rounded-xl border border-gray-200 bg-lightPrimary px-3.5 text-sm text-navy-900 outline-none transition focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:focus:bg-navy-600';
    const labelCls = 'block text-sm font-bold text-navy-900 dark:text-white';

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setView('list'); setCreateError(''); }}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 hover:underline"
          >
            <MdArrowBack size={18} /> Back
          </button>
          <div>
            <p className="text-sm font-bold text-brand-500">NEW ACTIVITY</p>
            <h2 className="text-xl font-bold text-navy-900 dark:text-white">
              Create Activity — {classLabel} · {year}
            </h2>
          </div>
        </div>

        <div className="rounded-[20px] border border-gray-200/70 bg-white p-6 shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800 sm:p-8">
          {createError && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              <MdErrorOutline className="mt-0.5 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Activity Type */}
            <label className={labelCls}>
              Activity Type <span className="text-brand-500">*</span>
              <select
                value={cType}
                onChange={e => setCType(e.target.value as ActivityType)}
                className={`mt-1.5 ${inputCls}`}
              >
                {ACTIVITY_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>

            {/* Name */}
            <label className={labelCls}>
              Name <span className="text-brand-500">*</span>
              <input
                type="text"
                value={cName}
                onChange={e => setCName(e.target.value)}
                placeholder="e.g. Quiz 1, Midterm"
                className={`mt-1.5 ${inputCls}`}
              />
            </label>

            {/* Subject */}
            <label className={labelCls}>
              Subject <span className="text-brand-500">*</span>
              <input
                type="text"
                value={cSubject}
                onChange={e => setCSubject(e.target.value)}
                placeholder="e.g. Mathematics"
                className={`mt-1.5 ${inputCls}`}
              />
            </label>

            {/* Date */}
            <label className={labelCls}>
              Activity Date
              <input
                type="date"
                value={cDate}
                onChange={e => setCDate(e.target.value)}
                className={`mt-1.5 ${inputCls}`}
              />
            </label>

            {/* Max Score */}
            <label className={labelCls}>
              Maximum Score <span className="text-brand-500">*</span>
              <input
                type="number"
                min={1}
                value={cMaxScore}
                onChange={e => setCMaxScore(e.target.value)}
                className={`mt-1.5 ${inputCls}`}
              />
            </label>

            {/* Description */}
            <label className={`${labelCls} sm:col-span-2`}>
              Description (optional)
              <textarea
                value={cDesc}
                onChange={e => setCDesc(e.target.value)}
                rows={2}
                placeholder="Brief description of this activity…"
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-lightPrimary px-3.5 py-2.5 text-sm text-navy-900 outline-none transition focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:focus:bg-navy-600"
              />
            </label>

            {/* Teacher Comment */}
            <label className={`${labelCls} sm:col-span-2`}>
              Teacher Comment (shown to students after publishing)
              <textarea
                value={cComment}
                onChange={e => setCComment(e.target.value)}
                rows={2}
                placeholder="Great work overall. Review chapter 4 for the next quiz."
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-lightPrimary px-3.5 py-2.5 text-sm text-navy-900 outline-none transition focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:focus:bg-navy-600"
              />
            </label>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => { setView('list'); setCreateError(''); }}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-700"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !cName.trim() || !cSubject.trim() || !cMaxScore}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating…' : <><MdAdd /> Create Activity</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: SCORES ─────────────────────────────────────────────────────────
  // An activity is only "fully done" when publish_status === 'published'.
  // 'partially_published' means some students are still unpublished — publish
  // controls must stay enabled so the teacher can continue publishing.
  const isFullyPublished   = scoreActivity?.publish_status === 'published';
  const isPartialPublished = scoreActivity?.publish_status === 'partially_published';

  // Count students who already have a saved (non-null) score in the DB.
  const savedScoreCount     = students.filter(s => s.score !== null).length;
  const publishedCount      = students.filter(s => s.is_published).length;
  // Students with a score who are NOT yet published — these are the candidates
  // for selective publish.
  const unpublishedScored   = students.filter(s => s.score !== null && !s.is_published);
  const canPublish          = savedScoreCount > 0;
  // Publish controls should be shown unless fully published to everyone
  const showPublishControls = !isFullyPublished;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            onClick={() => { setView('list'); setSelectedId(null); }}
            className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline"
          >
            <MdArrowBack size={18} /> Back
          </button>
          <div>
            <p className="text-sm font-bold text-brand-500">
              {scoreActivity?.activity_type?.toUpperCase() ?? 'ACTIVITY'} · {scoreActivity?.subject}
            </p>
            <h2 className="text-xl font-bold text-navy-900 dark:text-white">
              {scoreActivity?.name ?? '…'} — {classLabel}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {scoreActivity ? `Max score: ${scoreActivity.max_score}` : ''}
              {scoreActivity?.activity_date ? ` · ${fmtDate(scoreActivity.activity_date)}` : ''}
            </p>
          </div>
        </div>

        {/* Publish controls */}
        {scoreActivity && (
          <div className="flex flex-wrap items-center gap-2">
            {/* ── Partial-publish progress indicator ──────────────────── */}
            {isPartialPublished && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-600 dark:bg-navy-700 dark:text-brand-300">
                <MdPublish size={14} />
                {publishedCount} of {savedScoreCount} published
              </span>
            )}

            {/* ── Fully published badge ────────────────────────────────── */}
            {isFullyPublished && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-horizonGreen-50 px-3 py-2 text-xs font-bold text-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300">
                <MdCheckCircle /> All {savedScoreCount} published
              </span>
            )}

            {showPublishControls && canPublish && (
              <>
                {/* Publish to All un-published scored students */}
                {!selectMode && unpublishedScored.length > 0 && (
                  <button
                    disabled={publishing}
                    onClick={() => handlePublish()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-xs font-bold text-white shadow-[0_4px_12px_rgba(67,24,255,0.3)] transition hover:bg-brand-600 disabled:opacity-50"
                  >
                    <MdPublish />
                    {publishing
                      ? 'Publishing…'
                      : isPartialPublished
                      ? `Publish remaining (${unpublishedScored.length})`
                      : `Publish to All (${savedScoreCount})`}
                  </button>
                )}

                {/* Toggle select mode — always available while not fully published */}
                <button
                  onClick={() => {
                    setSelectMode(!selectMode);
                    setSelectedStudents(new Set());
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                    selectMode
                      ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-900/20'
                      : 'border-gray-200 text-navy-900 hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700'
                  }`}
                >
                  {selectMode ? 'Cancel selection' : 'Select students'}
                </button>

                {/* Publish selected — shown when in select mode */}
                {selectMode && (
                  <button
                    disabled={publishing || selectedStudents.size === 0}
                    onClick={() => handlePublish(Array.from(selectedStudents))}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-xs font-bold text-white shadow-[0_4px_12px_rgba(67,24,255,0.3)] transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <MdPublish />
                    {publishing
                      ? 'Publishing…'
                      : selectedStudents.size > 0
                      ? `Publish ${selectedStudents.size} selected`
                      : 'Select students below'}
                  </button>
                )}
              </>
            )}

            {showPublishControls && !canPublish && (
              /* No scores saved yet */
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
                <MdWarningAmber size={15} className="shrink-0" />
                Save scores first before publishing
              </div>
            )}
          </div>
        )}
      </div>

      {publishMsg && (
        <p className={`text-xs font-medium ${publishMsg.startsWith('Error') ? 'text-red-600 dark:text-red-400' : 'text-horizonGreen-700 dark:text-horizonGreen-300'}`}>
          {publishMsg}
        </p>
      )}

      {/* Score entry card */}
      <div className="rounded-[20px] border border-gray-200/70 bg-white shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-navy-700">
          <div>
            <p className="text-sm font-bold text-brand-500">SCORE ENTRY</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {students.length} student{students.length !== 1 ? 's' : ''} · auto-loaded from class roster
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* CSV import */}
            <button
              onClick={() => scoreActivity && downloadScoreTemplate(students, scoreActivity.max_score)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
              title="Download score template CSV"
            >
              <MdDownload size={14} /> Template
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700">
              <MdGridOn size={14} /> Import CSV
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleImportFile}
              />
            </label>
            {/* Save draft */}
            <button
              disabled={savingScores || hasScoreErrors || !selectedId}
              onClick={handleSaveScores}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-3 py-2.5 text-xs font-bold text-white shadow-[0_4px_12px_rgba(67,24,255,0.25)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MdSave size={14} /> {savingScores ? 'Saving…' : 'Save Draft'}
            </button>
            {/* Download activity DOCX — only when at least one published score exists */}
            {scoreActivity && students.some(s => s.is_published && s.score !== null) && (
              <button
                onClick={async () => {
                  const { generateActivityReportDoc } = await import('lib/docx/generators');
                  const publishedRows = students
                    .filter(s => s.is_published && s.score !== null)
                    .map(s => ({
                      student_code: s.student_code,
                      full_name:    s.full_name,
                      roll_number:  s.roll_number ?? null,
                      score:        s.score,
                    }));
                  await generateActivityReportDoc({
                    activity: {
                      activity_type:   scoreActivity.activity_type,
                      name:            scoreActivity.name,
                      subject:         scoreActivity.subject,
                      activity_date:   scoreActivity.activity_date,
                      max_score:       scoreActivity.max_score,
                      description:     scoreActivity.description,
                      teacher_comment: scoreActivity.teacher_comment,
                    },
                    scores:  publishedRows,
                    school,
                    year,
                    grade,
                    section,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
                title="Download published scores as DOCX"
              >
                <MdDownload size={14} /> Activity Report
              </button>
            )}
          </div>
        </div>

        {/* Import warnings */}
        {importWarn.length > 0 && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
            <MdWarningAmber className="mt-0.5 shrink-0" />
            <span>{importWarn.join(' ')}</span>
            <button onClick={() => setImportWarn([])} className="ml-auto shrink-0">
              <MdClose size={14} />
            </button>
          </div>
        )}

        {saveScoreMsg && (
          <div className={`border-b px-5 py-2.5 text-xs font-medium ${
            saveScoreMsg.startsWith('Error')
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300'
              : 'border-horizonGreen-200 bg-horizonGreen-50 text-horizonGreen-700 dark:border-horizonGreen-700/40 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300'
          }`}>
            {saveScoreMsg}
          </div>
        )}

        {scoresLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : scoresError ? (
          <p className="px-5 py-6 text-sm text-red-600 dark:text-red-400">{scoresError}</p>
        ) : students.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            No roster students found for {classLabel}. Upload the roster first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead className="bg-lightPrimary/60 text-left text-xs uppercase tracking-wide text-gray-600 dark:bg-navy-700 dark:text-gray-400">
                <tr>
                  {/* Select-all header: only targets un-published scored students */}
                  {selectMode && (
                    <th className="w-10 p-3.5">
                      <input
                        type="checkbox"
                        title="Select all un-published scored students"
                        checked={
                          unpublishedScored.length > 0 &&
                          unpublishedScored.every(s => selectedStudents.has(s.student_ref_id))
                        }
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedStudents(new Set(unpublishedScored.map(s => s.student_ref_id)));
                          } else {
                            setSelectedStudents(new Set());
                          }
                        }}
                        className="h-4 w-4 cursor-pointer accent-brand-500"
                      />
                    </th>
                  )}
                  <th className="p-3.5 font-bold">Roll</th>
                  <th className="p-3.5 font-bold">Student</th>
                  <th className="p-3.5 font-bold">Student ID</th>
                  <th className="p-3.5 font-bold">Score / {scoreActivity?.max_score ?? '—'}</th>
                  <th className="p-3.5 font-bold">Published</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const val = draftScores.get(s.student_ref_id) ?? '';
                  const err = scoreErrors.get(s.student_ref_id);
                  return (
                    <tr
                      key={s.student_ref_id}
                      className="border-t border-gray-100 dark:border-navy-700"
                    >
                      {selectMode && (
                        <td className="p-3.5">
                          {s.is_published ? (
                            /* Already published — greyed out, not selectable */
                            <span
                              title="Already published to this student"
                              className="inline-flex h-4 w-4 items-center justify-center rounded text-horizonGreen-500"
                            >
                              <MdCheckCircle size={16} />
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              disabled={s.score === null}
                              title={
                                s.score === null
                                  ? 'Save a score for this student before selecting'
                                  : 'Select to publish this student'
                              }
                              checked={selectedStudents.has(s.student_ref_id)}
                              onChange={() => {
                                if (s.score === null || s.is_published) return;
                                setSelectedStudents(prev => {
                                  const n = new Set(prev);
                                  n.has(s.student_ref_id) ? n.delete(s.student_ref_id) : n.add(s.student_ref_id);
                                  return n;
                                });
                              }}
                              className="h-4 w-4 cursor-pointer accent-brand-500 disabled:cursor-not-allowed disabled:opacity-30"
                            />
                          )}
                        </td>
                      )}
                      <td className="p-3.5 text-gray-500 dark:text-gray-400">
                        {s.roll_number || '—'}
                      </td>
                      <td className="p-3.5 font-medium text-navy-900 dark:text-white">
                        {s.full_name}
                      </td>
                      <td className="p-3.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {s.student_code}
                      </td>
                      <td className="p-3 w-36">
                        <input
                          type="number"
                          min={0}
                          max={scoreActivity?.max_score ?? 100}
                          step="any"
                          value={val}
                          onChange={e => setDraftScores(m => { const n = new Map(m); n.set(s.student_ref_id, e.target.value); return n; })}
                          placeholder="—"
                          className={`h-9 w-full rounded-lg border px-2.5 text-sm outline-none transition focus:border-brand-500 dark:text-white ${
                            err
                              ? 'border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/20'
                              : 'border-gray-200 bg-lightPrimary dark:border-navy-600 dark:bg-navy-700'
                          }`}
                        />
                        {err && <p className="mt-0.5 text-[10px] text-red-500">{err}</p>}
                      </td>
                      <td className="p-3.5">
                        {s.is_published ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-horizonGreen-600 dark:text-horizonGreen-400">
                            <MdCheckCircle size={13} /> Yes
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">No</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Select-mode hint */}
        {selectMode && (
          <div className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-400 dark:border-navy-700 dark:text-gray-500">
            {students.some(s => s.is_published) && (
              <span className="mr-3">
                <MdCheckCircle size={11} className="inline mb-0.5 text-horizonGreen-500" /> = already published (not re-selectable).
              </span>
            )}
            {students.some(s => s.score === null) && (
              <span>Greyed checkbox = no score saved yet — save a score first.</span>
            )}
          </div>
        )}
      </div>

      {/* Teacher comment display */}
      {scoreActivity?.teacher_comment && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-navy-600 dark:bg-navy-700/60 dark:text-brand-300">
          <span className="font-bold">Teacher comment: </span>
          {scoreActivity.teacher_comment}
        </div>
      )}
    </div>
  );
}

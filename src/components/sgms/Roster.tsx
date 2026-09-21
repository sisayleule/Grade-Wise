'use client';
/**
 * Roster component — teacher-facing Class Roster management.
 *
 * Renders inside the teacher SPA at page === 'roster'. Receives the current
 * year/grade/section selectors from the parent so it stays in sync with the
 * rest of the app.
 *
 * Features:
 *   • Load existing roster from /api/roster?year=…&grade=…&section=…
 *   • Upload CSV/XLSX: POST to /api/roster/parse → preview table → save
 *   • Manual "Add student" row (appended to the preview table)
 *   • Per-row validation: missing name, missing/duplicate Student ID, bad sex
 *   • Confirm & Save → POST /api/roster
 *   • Edit individual rows inline in the saved roster view
 */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdCheckCircle,
  MdCloudUpload,
  MdDeleteOutline,
  MdDescription,
  MdDownload,
  MdEdit,
  MdErrorOutline,
  MdGridOn,
  MdImage,
  MdPeopleAlt,
  MdPictureAsPdf,
  MdSave,
  MdWarningAmber,
} from 'react-icons/md';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RosterRow {
  /** UUID from public.students — absent when the row is brand-new */
  id?: string;
  student_code:  string;
  full_name:     string;
  roll_number:   string;
  sex:           string;   // 'M' | 'F' | 'Other' | ''
  portal_status?: string;
}

interface ValidationIssue {
  rowIdx: number;
  field:  string;
  msg:    string;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateRoster(rows: RosterRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenCodes = new Map<string, number>(); // code → first rowIdx

  rows.forEach((r, i) => {
    if (!r.full_name.trim()) {
      issues.push({ rowIdx: i, field: 'name', msg: 'Full name is required.' });
    }
    if (!r.student_code.trim()) {
      issues.push({ rowIdx: i, field: 'code', msg: 'Student ID is required.' });
    } else {
      const key = r.student_code.trim().toLowerCase();
      if (seenCodes.has(key)) {
        issues.push({
          rowIdx: i,
          field:  'code',
          msg:    `Duplicate Student ID — same as row ${seenCodes.get(key)! + 1}.`,
        });
      } else {
        seenCodes.set(key, i);
      }
    }
    if (r.sex && !['M', 'F', 'Other'].includes(r.sex)) {
      issues.push({ rowIdx: i, field: 'sex', msg: 'Sex must be M, F, or Other.' });
    }
  });

  return issues;
}

// ── Small shared pieces ───────────────────────────────────────────────────────

const SEX_OPTIONS = ['', 'M', 'F', 'Other'];

function sexLabel(s: string) {
  if (s === 'M') return 'Male';
  if (s === 'F') return 'Female';
  if (s === 'Other') return 'Other';
  return '—';
}

function portalBadge(status: string | undefined) {
  if (!status || status === 'inactive')
    return null;
  const map: Record<string, { label: string; cls: string }> = {
    pending:  { label: 'Portal: Pending',  cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' },
    active:   { label: 'Portal: Active',   cls: 'bg-horizonGreen-50 text-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300' },
    rejected: { label: 'Portal: Rejected', cls: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' },
    invited:  { label: 'Portal: Invited',  cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' },
  };
  return map[status] ?? null;
}

// ── Cell input shared style ───────────────────────────────────────────────────

const cellCls = (hasError: boolean) =>
  `h-9 w-full rounded-lg border px-2.5 text-sm text-navy-900 outline-none transition focus:border-brand-500 dark:text-white ${
    hasError
      ? 'border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/20'
      : 'border-gray-200 bg-lightPrimary dark:border-navy-600 dark:bg-navy-700'
  }`;

// ── Empty blank row factory ───────────────────────────────────────────────────

function blankRow(): RosterRow {
  return { student_code: '', full_name: '', roll_number: '', sex: '' };
}

// ── Download template ─────────────────────────────────────────────────────────

function downloadTemplate() {
  const csv =
    'Full Name,Student ID,Roll No,Sex\n' +
    'Amina Yusuf,GA250801,1,F\n' +
    'Kwame Asante,GA250802,2,M\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'roster_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Roster({
  year,
  grade,
  section,
  onSaved,
}: {
  year:     string;
  grade:    string;
  section:  string;
  onSaved?: () => void;
}) {
  // ── Saved roster state ─────────────────────────────────────────────────────
  const [saved,        setSaved]        = useState<RosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [loadError,    setLoadError]    = useState('');

  // ── Preview / edit state ───────────────────────────────────────────────────
  const [preview,      setPreview]      = useState<RosterRow[] | null>(null);
  const [parseWarn,    setParseWarn]    = useState<string[]>([]);

  // ── File upload state ──────────────────────────────────────────────────────
  const [parsing,      setParsing]      = useState(false);
  const [parsingMode,  setParsingMode]  = useState<'structured' | 'ai' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Save state ─────────────────────────────────────────────────────────────
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [saveError,    setSaveError]    = useState('');

  const classLabel = `${grade}${section}`;

  // ── Load saved roster whenever class selector changes ─────────────────────
  useEffect(() => {
    if (!year || !grade || !section) return;
    setLoadingRoster(true);
    setLoadError('');
    setPreview(null); // clear any in-progress edits when class changes
    setSaveMsg('');
    setSaveError('');

    fetch(
      `/api/roster?year=${encodeURIComponent(year)}&grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}`
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load roster'))))
      .then((d) => {
        setSaved(
          (d.students ?? []).map((s: any) => ({
            id:            s.id,
            student_code:  s.student_code ?? '',
            full_name:     s.full_name    ?? '',
            roll_number:   s.roll_number  ?? '',
            sex:           s.sex          ?? '',
            portal_status: s.portal_status,
          }))
        );
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoadingRoster(false));
  }, [year, grade, section]);

  // ── Validation on the preview rows ────────────────────────────────────────
  const issues = useMemo(
    () => (preview ? validateRoster(preview) : []),
    [preview]
  );
  const hasError = (rowIdx: number, field: string) =>
    issues.some((i) => i.rowIdx === rowIdx && i.field === field);

  // ── File upload → parse ────────────────────────────────────────────────────
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const fname = file.name.toLowerCase();
    const isStructured =
      fname.endsWith('.csv') || fname.endsWith('.xlsx') || fname.endsWith('.xls');

    setParsing(true);
    setParsingMode(isStructured ? 'structured' : 'ai');
    setParseWarn([]);
    setSaveError('');

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/roster/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');

      setParseWarn(data.warnings ?? []);
      setPreview(
        (data.rows ?? []).map((r: any) => ({
          student_code: r.student_code ?? '',
          full_name:    r.full_name    ?? '',
          roll_number:  r.roll_number  ?? '',
          sex:          r.sex          ?? '',
        }))
      );
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setParsing(false);
      setParsingMode(null);
    }
  };

  // ── Manual add row ─────────────────────────────────────────────────────────
  const startManual = () => setPreview(preview ? [...preview, blankRow()] : [blankRow()]);

  // ── Cell edit ─────────────────────────────────────────────────────────────
  const editRow = (idx: number, field: keyof RosterRow, value: string) => {
    if (!preview) return;
    setPreview(preview.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeRow = (idx: number) => {
    if (!preview) return;
    setPreview(preview.filter((_, i) => i !== idx));
  };

  // ── Save preview to DB ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!preview || issues.length) return;
    setSaving(true);
    setSaveMsg('');
    setSaveError('');

    try {
      const res = await fetch('/api/roster', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, grade, section, students: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      setSaved(
        (data.students ?? []).map((s: any) => ({
          id:            s.id,
          student_code:  s.student_code ?? '',
          full_name:     s.full_name    ?? '',
          roll_number:   s.roll_number  ?? '',
          sex:           s.sex          ?? '',
          portal_status: s.portal_status,
        }))
      );
      setSaveMsg(`Saved ${data.saved ?? preview.length} student${(data.saved ?? preview.length) !== 1 ? 's' : ''} to the roster.`);
      setPreview(null);
      setParseWarn([]);
      // Notify the parent (Home) so it refreshes rosterStudents — this is what
      // makes Dashboard "Total Students" and the Students page update immediately
      // without needing the teacher to change the grade/section selectors.
      onSaved?.();
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Edit-in-place for the saved roster (whole-table re-enter preview) ──────
  const editSaved = () => setPreview(saved.map((r) => ({ ...r })));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-brand-500">CLASS ROSTER</p>
          <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
            {classLabel} · {year}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            The roster is the sole source of student identity. Students must
            appear here before a result sheet can be processed for their class.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
          >
            <MdDownload className="text-base" /> Download template
          </button>
        </div>
      </div>

      {/* ── Upload zone (only visible when not already in preview mode) ───── */}
      {!preview && (
        <label className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
          parsing
            ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-navy-700/40'
            : 'border-brand-300 bg-brand-50/40 hover:border-brand-500 hover:bg-brand-50 dark:border-navy-600 dark:bg-navy-700/30 dark:hover:border-brand-400'
        }`}>
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-2xl text-brand-500 shadow-[0_8px_20px_rgba(67,24,255,0.2)] dark:bg-navy-800">
            {parsing ? (
              <svg className="h-6 w-6 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <MdCloudUpload />
            )}
          </span>

          <p className="font-bold text-navy-900 dark:text-white">
            {parsing
              ? parsingMode === 'ai' ? 'Reading with AI…' : 'Reading file…'
              : 'Upload a roster file'}
          </p>
          <p className="max-w-xs text-sm text-gray-500 dark:text-gray-400">
            {parsing
              ? parsingMode === 'ai'
                ? 'AI is reading the file — this takes a few seconds for images and PDFs.'
                : 'Parsing your spreadsheet…'
              : 'Drop a file here or click to browse. Spreadsheets are read directly; images, PDFs and Word docs use AI.'}
          </p>

          {/* Format tiles */}
          <span className="mt-1 grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: <MdImage />,       label: 'Image / Photo', ext: '.JPG · .PNG' },
              { icon: <MdPictureAsPdf />, label: 'PDF',           ext: '.PDF' },
              { icon: <MdDescription />, label: 'Word doc',       ext: '.DOC · .DOCX' },
              { icon: <MdGridOn />,      label: 'Spreadsheet',   ext: '.XLSX · .CSV' },
            ].map((t) => (
              <span
                key={t.label}
                className="rounded-2xl border border-gray-200 bg-white px-3 py-3 dark:border-navy-600 dark:bg-navy-800"
              >
                <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-lg text-brand-500 dark:bg-navy-700 dark:text-brand-300">
                  {t.icon}
                </span>
                <span className="mt-2 block text-xs font-bold text-navy-900 dark:text-white">{t.label}</span>
                <span className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">{t.ext}</span>
              </span>
            ))}
          </span>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            For spreadsheets, include columns: <strong>Full Name</strong>, <strong>Student ID</strong>, <strong>Roll No</strong>, <strong>Sex</strong>
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.jpg,.jpeg,.png,.pdf,.doc,.docx"
            className="hidden"
            onChange={handleFile}
            disabled={parsing}
          />
        </label>
      )}

      {/* ── Manual-add / edit toolbar (shown when no preview yet) ───────── */}
      {!preview && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={startManual}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-4 py-2.5 text-sm font-bold text-white shadow-[0_6px_18px_rgba(67,24,255,0.3)] transition hover:opacity-90"
          >
            <MdAdd /> Add student manually
          </button>
          {saved.length > 0 && (
            <button
              onClick={editSaved}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
            >
              <MdEdit /> Edit roster
            </button>
          )}
        </div>
      )}

      {/* ── Parse warnings ────────────────────────────────────────────────── */}
      {parseWarn.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          <MdWarningAmber className="mt-0.5 shrink-0 text-base" />
          <span>{parseWarn.join(' ')}</span>
        </div>
      )}

      {/* ── Save error / success ─────────────────────────────────────────── */}
      {saveError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          <MdErrorOutline className="mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}
      {saveMsg && !saveError && (
        <div className="flex items-center gap-2 rounded-xl border border-horizonGreen-200 bg-horizonGreen-50 px-3.5 py-3 text-sm font-medium text-horizonGreen-700 dark:border-horizonGreen-700/40 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300">
          <MdCheckCircle className="shrink-0" />
          {saveMsg}
        </div>
      )}

      {/* ── PREVIEW / EDIT TABLE ─────────────────────────────────────────── */}
      {preview && (
        <div className="rounded-[20px] border border-gray-200/70 bg-white shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
          {/* toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-navy-700">
            <div>
              <p className="text-sm font-bold text-brand-500">REVIEW & CONFIRM</p>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {preview.length} student{preview.length !== 1 ? 's' : ''} ready to save
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setPreview(null); setParseWarn([]); setSaveError(''); }}
                className="rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-bold text-gray-600 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-700"
              >
                Cancel
              </button>
              <button
                onClick={() => setPreview([...preview, blankRow()])}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
              >
                <MdAdd /> Row
              </button>
              <button
                disabled={!!issues.length || saving}
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-4 py-2 text-sm font-bold text-white shadow-[0_6px_18px_rgba(67,24,255,0.3)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MdSave /> {saving ? 'Saving…' : `Save ${preview.length} students`}
              </button>
            </div>
          </div>

          {/* validation summary */}
          {issues.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-700/40 dark:bg-amber-900/20">
              <p className="mb-1 text-xs font-bold text-amber-800 dark:text-amber-300">
                {issues.length} issue{issues.length !== 1 ? 's' : ''} — fix before saving
              </p>
              <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                {issues.slice(0, 5).map((iss, i) => (
                  <li key={i}>
                    Row {iss.rowIdx + 1} · {iss.field}: {iss.msg}
                  </li>
                ))}
                {issues.length > 5 && (
                  <li>…and {issues.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          {/* table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-lightPrimary/60 text-left text-xs uppercase tracking-wide text-gray-600 dark:bg-navy-700 dark:text-gray-400">
                <tr>
                  <th className="w-8 p-3 font-bold">#</th>
                  <th className="p-3 font-bold">Full Name <span className="text-red-400">*</span></th>
                  <th className="p-3 font-bold">Student ID <span className="text-red-400">*</span></th>
                  <th className="p-3 font-bold">Roll No</th>
                  <th className="p-3 font-bold">Sex</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {preview.map((row, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-gray-100 dark:border-navy-700"
                  >
                    <td className="p-2 text-center text-xs text-gray-400">{idx + 1}</td>
                    <td className="p-2">
                      <input
                        className={cellCls(hasError(idx, 'name'))}
                        value={row.full_name}
                        placeholder="e.g. Amina Yusuf"
                        onChange={(e) => editRow(idx, 'full_name', e.target.value)}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className={cellCls(hasError(idx, 'code'))}
                        value={row.student_code}
                        placeholder="e.g. GA250801"
                        onChange={(e) => editRow(idx, 'student_code', e.target.value)}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className={cellCls(false)}
                        value={row.roll_number}
                        placeholder="e.g. 1"
                        onChange={(e) => editRow(idx, 'roll_number', e.target.value)}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        className={cellCls(hasError(idx, 'sex'))}
                        value={row.sex}
                        onChange={(e) => editRow(idx, 'sex', e.target.value)}
                      >
                        {SEX_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o === '' ? '—' : o === 'M' ? 'Male' : o === 'F' ? 'Female' : 'Other'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => removeRow(idx)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-900/20"
                      >
                        <MdDeleteOutline className="text-base" /> Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SAVED ROSTER TABLE ────────────────────────────────────────────── */}
      {!preview && (
        <div className="rounded-[20px] border border-gray-200/70 bg-white shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-navy-700">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-lg text-brand-500 dark:bg-navy-700 dark:text-brand-300">
                <MdPeopleAlt />
              </div>
              <div>
                <p className="font-bold text-navy-900 dark:text-white">
                  {loadingRoster ? 'Loading…' : `${saved.length} student${saved.length !== 1 ? 's' : ''} in ${classLabel}`}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{year}</p>
              </div>
            </div>
          </div>

          {loadError && (
            <div className="px-5 py-4 text-sm text-red-600 dark:text-red-400">{loadError}</div>
          )}

          {!loadingRoster && !loadError && saved.length === 0 && (
            <div className="px-5 py-10 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700">
                <MdPeopleAlt />
              </div>
              <p className="mt-4 font-bold text-navy-900 dark:text-white">
                No roster yet for {classLabel}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Upload a file (CSV, Excel, image, PDF, or Word) or add students manually using the buttons above.
              </p>
            </div>
          )}

          {!loadingRoster && saved.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-sm">
                <thead className="bg-lightPrimary/60 text-left text-xs uppercase tracking-wide text-gray-600 dark:bg-navy-700 dark:text-gray-400">
                  <tr>
                    <th className="p-3.5 font-bold">Roll</th>
                    <th className="p-3.5 font-bold">Full Name</th>
                    <th className="p-3.5 font-bold">Student ID</th>
                    <th className="p-3.5 font-bold">Sex</th>
                    <th className="p-3.5 font-bold">Portal</th>
                  </tr>
                </thead>
                <tbody>
                  {saved.map((s, i) => {
                    const badge = portalBadge(s.portal_status);
                    return (
                      <tr
                        key={s.id ?? i}
                        className="border-t border-gray-100 transition hover:bg-lightPrimary/40 dark:border-navy-700 dark:hover:bg-navy-700/30"
                      >
                        <td className="p-3.5 text-gray-500 dark:text-gray-400">
                          {s.roll_number || '—'}
                        </td>
                        <td className="p-3.5 font-medium text-navy-900 dark:text-white">
                          {s.full_name}
                        </td>
                        <td className="p-3.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                          {s.student_code}
                        </td>
                        <td className="p-3.5 text-gray-600 dark:text-gray-400">
                          {sexLabel(s.sex)}
                        </td>
                        <td className="p-3.5">
                          {badge ? (
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${badge.cls}`}>
                              {badge.label}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">No account</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

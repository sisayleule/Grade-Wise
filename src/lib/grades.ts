export type ScoreRow = { id: string; name: string; scores: Record<string, string | number>; uncertain?: string[] };
export type Result = ScoreRow & { total: number; maximum: number; average: number; percentage: number; rank: number; status: string; letterGrade: string };
export type Batch = { id: string; year: string; className: string; semester: string; subjects: string[]; rows: Result[]; createdAt: string; fileName?: string; grade?: string; section?: string };
export type School = { name: string; teacher: string; principal: string; footer: string; logo?: string };

/** Which academic period structure this school uses. Defaults to 'semester'. */
export type PeriodSystem = 'semester' | 'quarter';

/** Period labels for each system. */
export const SEMESTER_PERIODS = ['Semester 1', 'Semester 2'] as const;
export const QUARTER_PERIODS  = ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'] as const;

/** All valid period strings that the API will accept. */
export const ALL_VALID_PERIODS: string[] = [...SEMESTER_PERIODS, ...QUARTER_PERIODS];

/** Returns the base period options (without 'Full Year') for the given system. */
export function basePeriods(system: PeriodSystem): string[] {
  return system === 'quarter' ? [...QUARTER_PERIODS] : [...SEMESTER_PERIODS];
}

export const initialSchool: School = { name: '', teacher: '', principal: '', footer: '' };
export const initialRows: ScoreRow[] = [];

export const statusFor = (percentage: number) => percentage >= 80 ? 'Excellent' : percentage >= 70 ? 'Very Good' : percentage >= 60 ? 'Good' : percentage >= 50 ? 'Satisfactory' : 'Needs Support';

/**
 * Returns the letter grade for a given score (0–100).
 * This is the single source of truth for the grading scale used everywhere
 * in the app — UI pages, printable reports, and DOCX documents.
 *
 * Scale:
 *   90–100 → A+   80–89 → A    75–79 → B+   70–74 → B
 *   65–69  → C+   60–64 → C    55–59 → D+   50–54 → D
 *   < 50   → E
 */
export function getLetterGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'D+';
  if (score >= 50) return 'D';
  return 'E';
}

export function computeResults(rows: ScoreRow[], subjects: string[]): Result[] {
  const calculated = rows.map((row) => {
    const total = subjects.reduce((sum, subject) => sum + Number(row.scores[subject]), 0);
    const maximum = subjects.length * 100;
    const percentage = maximum ? (total / maximum) * 100 : 0;
    return { ...row, total, maximum, average: subjects.length ? total / subjects.length : 0, percentage, rank: 0, status: statusFor(percentage), letterGrade: getLetterGrade(percentage) };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let lastTotal = -1; let rank = 0;
  return calculated.map((row, index) => { if (row.total !== lastTotal) rank = index + 1; lastTotal = row.total; return { ...row, rank }; });
}

export function buildAnnual(first?: Batch, second?: Batch): Batch | undefined {
  if (!first || !second) return undefined;
  return buildAnnualFromBatches([first, second]);
}

/**
 * Generalised Full Year merge.
 * Accepts 2 (semester) or 4 (quarter) batches and averages per-subject scores
 * across all of them for each student.
 * Returns undefined if the batches array is empty or any entry is missing.
 */
export function buildAnnualFromBatches(batches: (Batch | undefined)[]): Batch | undefined {
  const valid = batches.filter((b): b is Batch => b !== undefined);
  if (valid.length === 0 || valid.length !== batches.length) return undefined;

  // Union of all subjects across all batches
  const subjects = Array.from(new Set(valid.flatMap((b) => b.subjects)));

  // Use the first batch's student list as the anchor.
  // Build per-batch ID maps for fast lookup.
  const maps = valid.map((b) => new Map(b.rows.map((r) => [r.id, r])));

  const rows: ScoreRow[] = valid[0].rows.map((anchorRow) => {
    const scores: Record<string, number | string> = {};
    for (const subject of subjects) {
      // Gather all scores for this subject across every batch (where present)
      const vals = maps
        .map((m) => m.get(anchorRow.id))
        .filter((r): r is Result => r !== undefined)
        .map((r) => Number(r.scores[subject]))
        .filter((v) => Number.isFinite(v));
      scores[subject] = vals.length > 0
        ? vals.reduce((a, b) => a + b, 0) / vals.length
        : '';
    }
    return { id: anchorRow.id, name: anchorRow.name, scores };
  });

  return {
    id: `${valid.map((b) => b.id).join('-')}-annual`,
    year: valid[0].year,
    className: valid[0].className,
    semester: 'Full Year',
    subjects,
    rows: computeResults(rows, subjects),
    createdAt: new Date().toISOString(),
  };
}

export function validateRows(rows: ScoreRow[], subjects: string[]) {
  const issues: { row: number; field: string; message: string }[] = [];

  // ── Structural checks (reported as row 0, before per-row checks) ───────────
  if (!subjects.length) {
    issues.push({ row: 0, field: 'Subjects', message: 'Add at least one subject column.' });
  }

  // Duplicate subject names
  const seenSubjects = new Set<string>();
  subjects.forEach((s) => {
    const key = s.trim().toLowerCase();
    if (seenSubjects.has(key)) {
      issues.push({ row: 0, field: s, message: `Duplicate subject column "${s}" — each subject must appear only once.` });
    }
    seenSubjects.add(key);
  });

  // Column-count mismatch: any row whose score keys don't match the expected subjects
  if (subjects.length > 0) {
    rows.forEach((row, index) => {
      const rowSubjects = Object.keys(row.scores);
      // Check for score columns that are present in the row but not in subjects list
      const extra = rowSubjects.filter((k) => !subjects.includes(k));
      if (extra.length > 0) {
        issues.push({
          row: index + 1,
          field: 'Columns',
          message: `Row has ${extra.length} unexpected score column(s): ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? '…' : ''} — re-upload or correct the subject headers.`,
        });
      }
      // Subjects with no corresponding score key at all
      const missing = subjects.filter((s) => !(s in row.scores));
      if (missing.length > 0) {
        issues.push({
          row: index + 1,
          field: 'Columns',
          message: `Row is missing score column(s): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}.`,
        });
      }
    });
  }

  // ── Per-row value checks ───────────────────────────────────────────────────
  const ids = new Set<string>();
  const knownFields = new Set(['id', 'name', ...subjects]);
  rows.forEach((row, index) => {
    if (!row.id.trim()) issues.push({ row: index + 1, field: 'Student ID', message: 'Student ID is required.' });
    if (!row.name.trim()) issues.push({ row: index + 1, field: 'Student Name', message: 'Student name is required.' });
    if (row.id && ids.has(row.id.trim().toLowerCase())) issues.push({ row: index + 1, field: 'Student ID', message: 'Duplicate student ID.' });
    ids.add(row.id.trim().toLowerCase());
    subjects.forEach((subject) => {
      const value = row.scores[subject];
      if (value === '' || value === undefined) {
        issues.push({ row: index + 1, field: subject, message: 'Score is required.' });
      } else if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
        issues.push({ row: index + 1, field: subject, message: 'Use a score from 0 to 100.' });
      }
    });
    // Only surface uncertain entries for real fields — junk/placeholder
    // labels (e.g. a stray "a") must never appear in validation messages.
    row.uncertain?.forEach((field) => {
      const f = String(field).trim();
      if (f.length < 2 || !knownFields.has(f)) return;
      issues.push({ row: index + 1, field: f, message: 'Confirm this OCR-extracted value.' });
    });
  });

  return issues;
}

export const parseText = (text: string): { subjects: string[]; rows: ScoreRow[] } => {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim());
  const cells = (line: string) => line.includes('\t') ? line.split('\t') : line.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
  const header = cells(lines[0] || '');
  const subjects = header.slice(2).filter(Boolean);
  return { subjects, rows: lines.slice(1).map((line) => { const values = cells(line); return { id: values[0] || '', name: values[1] || '', scores: Object.fromEntries(subjects.map((subject, i) => [subject, values[i + 2] ?? ''])) }; }) };
};

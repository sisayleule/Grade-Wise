export type ScoreRow = { id: string; name: string; scores: Record<string, string | number>; uncertain?: string[] };
export type Result = ScoreRow & { total: number; maximum: number; average: number; percentage: number; rank: number; status: string };
export type Batch = { id: string; year: string; className: string; semester: string; subjects: string[]; rows: Result[]; createdAt: string; fileName?: string; grade?: string; section?: string };
export type School = { name: string; teacher: string; principal: string; footer: string; logo?: string };

export const initialSchool: School = { name: '', teacher: '', principal: '', footer: '' };
export const initialRows: ScoreRow[] = [];

export const statusFor = (percentage: number) => percentage >= 80 ? 'Excellent' : percentage >= 70 ? 'Very Good' : percentage >= 60 ? 'Good' : percentage >= 50 ? 'Satisfactory' : 'Needs Support';

export function computeResults(rows: ScoreRow[], subjects: string[]): Result[] {
  const calculated = rows.map((row) => {
    const total = subjects.reduce((sum, subject) => sum + Number(row.scores[subject]), 0);
    const maximum = subjects.length * 100;
    const percentage = maximum ? (total / maximum) * 100 : 0;
    return { ...row, total, maximum, average: subjects.length ? total / subjects.length : 0, percentage, rank: 0, status: statusFor(percentage) };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let lastTotal = -1; let rank = 0;
  return calculated.map((row, index) => { if (row.total !== lastTotal) rank = index + 1; lastTotal = row.total; return { ...row, rank }; });
}

export function buildAnnual(first?: Batch, second?: Batch): Batch | undefined {
  if (!first || !second) return undefined;
  const subjects = Array.from(new Set([...first.subjects, ...second.subjects]));
  const secondById = new Map(second.rows.map((row) => [row.id, row]));
  const rows: ScoreRow[] = first.rows.map((row) => { const other = secondById.get(row.id); return { id: row.id, name: row.name, scores: Object.fromEntries(subjects.map((subject) => [subject, other && row.scores[subject] !== undefined && other.scores[subject] !== undefined ? (Number(row.scores[subject]) + Number(other.scores[subject])) / 2 : row.scores[subject] ?? other?.scores[subject] ?? ''])) }; });
  return { id: `${first.id}-annual`, year: first.year, className: first.className, semester: 'Full Year', subjects, rows: computeResults(rows, subjects), createdAt: new Date().toISOString() };
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

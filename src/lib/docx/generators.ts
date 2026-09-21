/**
 * .docx document generators for GradeWise.
 *
 * Five generators:
 *   generateStudentReportDoc  — one student, one period or Full Year
 *   generateClassReportDoc    — all students in a class, one period
 *   generateRankingDoc        — ranking table, one period or Full Year
 *   generateFinalResultDoc    — full-year class report (2 semesters OR 4 quarters)
 *   generateActivityReportDoc — one activity, all published student scores
 *
 * All generators accept a `periodSystem` parameter ('semester' | 'quarter') so
 * that no quarter-system school ever sees "Semester" on a printed document, and
 * vice versa.
 *
 * All output genuine .docx files using the `docx` package.
 * Triggered client-side; Packer.toBlob() runs in the browser.
 */

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  AlignmentType,
  HeadingLevel,
  WidthType,
  BorderStyle,
  ShadingType,
  PageOrientation,
  convertInchesToTwip,
  VerticalAlign,
} from 'docx';
import type { Result, School } from 'lib/grades';
import { getLetterGrade } from 'lib/grades';

// ── Shared style constants ────────────────────────────────────────────────────

const FONT   = 'Calibri';
const NAVY   = '1E3A5F';
const LIGHT  = 'F0F4FA';
const BORDER = '2E74B5';

/** Standard A4 page margins (in twips: 1 inch = 1440 twips) */
const PAGE_MARGINS = {
  top:    convertInchesToTwip(1),
  bottom: convertInchesToTwip(1),
  left:   convertInchesToTwip(1),
  right:  convertInchesToTwip(1),
};

// ── Period-system helpers ─────────────────────────────────────────────────────

export type PeriodSystem = 'semester' | 'quarter';

/**
 * Returns the ordered list of individual period labels for the given system.
 * Used to build column headers in the Full Year table.
 */
export function getPeriodLabels(periodSystem: PeriodSystem): string[] {
  return periodSystem === 'quarter'
    ? ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']
    : ['Semester 1', 'Semester 2'];
}

/**
 * Short label for column headers (Q1 / Q2 / ... or S1 / S2).
 */
function shortPeriodLabel(period: string): string {
  if (period.startsWith('Quarter ')) return `Q${period.slice(-1)}`;
  if (period.startsWith('Semester ')) return `S${period.slice(-1)}`;
  return period;
}

// ── Reusable paragraph builders ───────────────────────────────────────────────

function schoolHeader(school: School): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: school.name.toUpperCase(),
          font: FONT, size: 32, bold: true, color: NAVY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: 'Official Academic Progress Report',
          font: FONT, size: 22, color: '555555', italics: true,
        }),
      ],
    }),
    dividerParagraph(),
  ];
}

function dividerParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BORDER } },
    children: [],
  });
}

function reportTitle(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 60 },
    children: [
      new TextRun({ text: title, font: FONT, size: 28, bold: true, color: NAVY }),
    ],
  });
}

function metaLine(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label}: `, font: FONT, size: 22, bold: true, color: NAVY }),
      new TextRun({ text: value,        font: FONT, size: 22, color: '333333' }),
    ],
  });
}

function sectionLabel(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [
      new TextRun({ text, font: FONT, size: 24, bold: true, color: NAVY }),
    ],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER } },
  });
}

function signatureBlock(teacher: string, principal: string): Paragraph[] {
  return [
    dividerParagraph(),
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: 'Prepared by: ',   font: FONT, size: 22, bold: true }),
        new TextRun({ text: teacher,            font: FONT, size: 22 }),
        new TextRun({ text: '           ' }),
        new TextRun({ text: 'Authorized by: ', font: FONT, size: 22, bold: true }),
        new TextRun({ text: principal,          font: FONT, size: 22 }),
      ],
    }),
    new Paragraph({
      spacing: { before: 400 },
      children: [
        new TextRun({ text: "Teacher's Signature: ________________________     ", font: FONT, size: 22 }),
        new TextRun({ text: "Principal's Signature: ________________________",   font: FONT, size: 22 }),
      ],
    }),
  ];
}

function footerNote(school: School): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
    children: [
      new TextRun({
        text: `${school.footer} · Generated ${new Date().toLocaleDateString()}`,
        font: FONT, size: 18, color: '888888', italics: true,
      }),
    ],
  });
}

// ── Table helpers ─────────────────────────────────────────────────────────────

const cellBorder = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
};

function headerCell(text: string, widthPct: number, fontSize = 20): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: cellBorder,
    shading: { type: ShadingType.CLEAR, fill: NAVY, color: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text, font: FONT, size: fontSize, bold: true, color: 'FFFFFF' }),
        ],
      }),
    ],
  });
}

function dataCell(
  text: string,
  widthPct: number,
  opts: { bold?: boolean; center?: boolean; shaded?: boolean; fontSize?: number } = {}
): TableCell {
  const fs = opts.fontSize ?? 20;
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: cellBorder,
    shading: opts.shaded ? { type: ShadingType.CLEAR, fill: LIGHT, color: LIGHT } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({ text, font: FONT, size: fs, bold: opts.bold ?? false, color: '222222' }),
        ],
      }),
    ],
  });
}

// ── Save helper (browser) ─────────────────────────────────────────────────────

export async function saveDoc(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 1. Student Report DOC ─────────────────────────────────────────────────────

export interface StudentReportInput {
  student:      Result;
  subjects:     string[];
  school:       School;
  year:         string;
  grade:        string;
  section:      string;
  /** The period label as stored in the DB, e.g. "Quarter 1" or "Full Year" */
  semester:     string;
  periodSystem: PeriodSystem;
  /**
   * Full-Year only: one entry per published period in chronological order.
   * For semester schools: 2 entries (S1, S2).
   * For quarter schools:  4 entries (Q1–Q4).
   * Each entry has { periodLabel, scores }.
   */
  periodScores?: Array<{ periodLabel: string; scores: Record<string, string | number> }>;
}

export async function generateStudentReportDoc(input: StudentReportInput): Promise<void> {
  const { student, subjects, school, year, grade, section, semester, periodSystem, periodScores } = input;
  const isFullYear = semester === 'Full Year';

  // ── Build scores table ────────────────────────────────────────────────────
  const scoreRows: TableRow[] = subjects.map((subj, idx) => {
    const shade = idx % 2 === 0;

    if (isFullYear && periodScores && periodScores.length > 0) {
      const periodCells: TableCell[] = periodScores.map((p) =>
        dataCell(String(p.scores[subj] ?? '—'), 10, { center: true, shaded: shade })
      );
      const avg    = student.scores[subj];
      const avgNum = avg !== undefined && avg !== '' ? Number(avg) : NaN;

      return new TableRow({
        children: [
          dataCell(subj, 22, { shaded: shade }),
          ...periodCells,
          dataCell(!isNaN(avgNum) ? String(avg) : '—', 12, { center: true, bold: true, shaded: shade }),
          dataCell(!isNaN(avgNum) ? getLetterGrade(avgNum) : '—', 10, { center: true, bold: true, shaded: shade }),
          dataCell('100', 10, { center: true, shaded: shade }),
        ],
      });
    }

    // Single period
    return new TableRow({
      children: [
        dataCell(subj,                                               40, { shaded: shade }),
        dataCell(String(student.scores[subj] ?? '—'),               20, { center: true, bold: true, shaded: shade }),
        dataCell(getLetterGrade(Number(student.scores[subj])),       15, { center: true, bold: true, shaded: shade }),
        dataCell('100',                                              25, { center: true, shaded: shade }),
      ],
    });
  });

  // Header row for the scores table
  const scoresHeaderRow = (() => {
    if (isFullYear && periodScores && periodScores.length > 0) {
      const periodCols = periodScores.map((p) =>
        headerCell(shortPeriodLabel(p.periodLabel), 10)
      );
      return new TableRow({
        tableHeader: true,
        children: [
          headerCell('Subject',     22),
          ...periodCols,
          headerCell('Final Score', 12),
          headerCell('Grade',       10),
          headerCell('Maximum',     10),
        ],
      });
    }
    return new TableRow({
      tableHeader: true,
      children: [
        headerCell('Subject', 40),
        headerCell('Score',   20),
        headerCell('Grade',   15),
        headerCell('Maximum', 25),
      ],
    });
  })();

  const scoresTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [scoresHeaderRow, ...scoreRows],
  });

  // Summary table (unchanged)
  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('Total', 20), headerCell('Average', 20),
          headerCell('Percentage', 20), headerCell('Grade', 20), headerCell('Remark', 20),
        ],
      }),
      new TableRow({
        children: [
          dataCell(`${student.total}/${student.maximum}`, 20, { center: true, bold: true }),
          dataCell(student.average.toFixed(1),             20, { center: true }),
          dataCell(`${student.percentage.toFixed(1)}%`,   20, { center: true }),
          dataCell(student.letterGrade,                    20, { center: true, bold: true }),
          dataCell(student.status,                         20, { center: true, bold: true }),
        ],
      }),
    ],
  });

  // Period label for the meta line
  const periodLabel = isFullYear
    ? `Full Year (${getPeriodLabels(periodSystem).join(' + ')})`
    : semester;

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size:   { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
          margin: PAGE_MARGINS,
        },
      },
      children: [
        ...schoolHeader(school),
        reportTitle('Student Progress Report'),
        new Paragraph({ spacing: { after: 40 }, children: [] }),
        metaLine('Student',       student.name),
        metaLine('Student ID',    student.id),
        metaLine('Class',         `${grade}${section}`),
        metaLine('Academic Year', year),
        metaLine('Period',        periodLabel),
        metaLine('Rank',          String(student.rank)),
        sectionLabel(isFullYear ? 'Subject Scores — Full Year' : 'Subject Scores'),
        scoresTable,
        sectionLabel('Summary'),
        summaryTable,
        ...signatureBlock(school.teacher, school.principal),
        footerNote(school),
      ],
    }],
  });

  const safeName = student.name.replace(/[^a-z0-9]/gi, '_');
  const semTag   = semester.replace(/\s+/g, '-');
  await saveDoc(doc, `${school.name}_${grade}${section}_${safeName}_${semTag}.docx`);
}

// ── 2. Class Report DOC ───────────────────────────────────────────────────────

export interface ClassReportInput {
  rows:         Result[];
  subjects:     string[];
  school:       School;
  year:         string;
  grade:        string;
  section:      string;
  semester:     string;
  periodSystem: PeriodSystem;
}

export async function generateClassReportDoc(input: ClassReportInput): Promise<void> {
  const { rows, subjects, school, year, grade, section, semester, periodSystem } = input;

  const subjectWidth = Math.max(5, Math.floor(36 / Math.max(subjects.length, 1)));
  const nameWidth    = 18;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Rank',   5),
      headerCell('ID',     8),
      headerCell('Name',   nameWidth),
      ...subjects.map(() => headerCell('', subjectWidth)),
      headerCell('Total',  7),
      headerCell('Avg',    6),
      headerCell('%',      5),
      headerCell('Grade',  6),
      headerCell('Remark', 7),
    ],
  });

  const subjectNameRow = new TableRow({
    tableHeader: true,
    children: [
      dataCell('', 5,  { shaded: true }),
      dataCell('', 8,  { shaded: true }),
      dataCell('', nameWidth, { shaded: true }),
      ...subjects.map(s => dataCell(s, subjectWidth, { shaded: true, center: true })),
      dataCell('', 7,  { shaded: true }),
      dataCell('', 6,  { shaded: true }),
      dataCell('', 5,  { shaded: true }),
      dataCell('', 6,  { shaded: true }),
      dataCell('', 7,  { shaded: true }),
    ],
  });

  const dataRows = rows.map((r, idx) =>
    new TableRow({
      children: [
        dataCell(String(r.rank),                5, { center: true, bold: r.rank <= 3, shaded: idx % 2 === 0 }),
        dataCell(r.id,                          8, { shaded: idx % 2 === 0 }),
        dataCell(r.name,              nameWidth,   { bold: true, shaded: idx % 2 === 0 }),
        ...subjects.map(s => dataCell(String(r.scores[s] ?? '—'), subjectWidth, { center: true, shaded: idx % 2 === 0 })),
        dataCell(`${r.total}/${r.maximum}`,     7, { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.average.toFixed(1),          6, { center: true, shaded: idx % 2 === 0 }),
        dataCell(`${r.percentage.toFixed(1)}%`, 5, { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.letterGrade,                 6, { center: true, bold: true, shaded: idx % 2 === 0 }),
        dataCell(r.status,                      7, { center: true, shaded: idx % 2 === 0 }),
      ],
    })
  );

  const classTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, subjectNameRow, ...dataRows],
  });

  const landscape = subjects.length > 6;

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: landscape
            ? { width: convertInchesToTwip(11.69), height: convertInchesToTwip(8.27), orientation: PageOrientation.LANDSCAPE }
            : { width: convertInchesToTwip(8.27),  height: convertInchesToTwip(11.69) },
          margin: { ...PAGE_MARGINS, left: convertInchesToTwip(0.6), right: convertInchesToTwip(0.6) },
        },
      },
      children: [
        ...schoolHeader(school),
        reportTitle('Class Results Report'),
        metaLine('Class',          `${grade}${section}`),
        metaLine('Academic Year',  year),
        metaLine('Period',         semester),
        metaLine('Period System',  periodSystem === 'quarter' ? 'Quarter System' : 'Semester System'),
        metaLine('Total Students', String(rows.length)),
        sectionLabel('Student Results'),
        classTable,
        ...signatureBlock(school.teacher, school.principal),
        footerNote(school),
      ],
    }],
  });

  const semTag = semester.replace(/\s+/g, '-');
  await saveDoc(doc, `${school.name}_${grade}${section}_ClassReport_${semTag}.docx`);
}

// ── 3. Ranking DOC ────────────────────────────────────────────────────────────

export interface RankingDocInput {
  rows:         Result[];
  school:       School;
  year:         string;
  grade:        string;
  section:      string;
  semester:     string;
  periodSystem: PeriodSystem;
  mode:         'section' | 'grade';
}

export async function generateRankingDoc(input: RankingDocInput): Promise<void> {
  const { rows, school, year, grade, section, semester, periodSystem, mode } = input;

  const rankRows = rows.map((r, idx) =>
    new TableRow({
      children: [
        dataCell(String(r.rank),                8, { center: true, bold: r.rank <= 3, shaded: r.rank <= 3 }),
        dataCell(r.id,                         10, { shaded: idx % 2 === 0 }),
        dataCell(r.name,                       27, { bold: true,  shaded: idx % 2 === 0 }),
        ...(mode === 'grade' ? [dataCell(`${grade}${(r as any).section || section}`, 10, { center: true, shaded: idx % 2 === 0 })] : []),
        dataCell(`${r.total}/${r.maximum}`,    13, { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.average.toFixed(1),          9, { center: true, shaded: idx % 2 === 0 }),
        dataCell(`${r.percentage.toFixed(1)}%`, 9, { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.letterGrade,                 8, { center: true, bold: true, shaded: idx % 2 === 0 }),
        dataCell(r.status,                     16, { center: true, shaded: idx % 2 === 0 }),
      ],
    })
  );

  const rankTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('Rank',   8),
          headerCell('ID',    10),
          headerCell('Student Name', 27),
          ...(mode === 'grade' ? [headerCell('Class', 10)] : []),
          headerCell('Total', 13),
          headerCell('Avg',    9),
          headerCell('%',      9),
          headerCell('Grade',  8),
          headerCell('Remark', 16),
        ],
      }),
      ...rankRows,
    ],
  });

  const title = mode === 'grade'
    ? `Grade ${grade} Rankings — ${semester}`
    : `${grade}${section} Rankings — ${semester}`;

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size:   { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
          margin: PAGE_MARGINS,
        },
      },
      children: [
        ...schoolHeader(school),
        reportTitle('Ranking Report'),
        metaLine('Class',         mode === 'grade' ? `All ${grade} Sections` : `${grade}${section}`),
        metaLine('Academic Year', year),
        metaLine('Period',        semester),
        metaLine('Period System', periodSystem === 'quarter' ? 'Quarter System' : 'Semester System'),
        metaLine('Total Students', String(rows.length)),
        sectionLabel(title),
        rankTable,
        footerNote(school),
      ],
    }],
  });

  const semTag = semester.replace(/\s+/g, '-');
  const cls    = mode === 'grade' ? grade.replace(/\s+/g, '') : `${grade}${section}`;
  await saveDoc(doc, `${school.name}_${cls}_Rankings_${semTag}.docx`);
}

// ── 4. Final Result DOC (Full Year) ───────────────────────────────────────────

/**
 * One entry per period, in chronological order.
 * Semester schools:  2 entries (Semester 1, Semester 2)
 * Quarter schools:   4 entries (Quarter 1 … Quarter 4)
 */
export interface PeriodSnapshot {
  periodLabel: string;     // e.g. "Quarter 1" or "Semester 1"
  rows:        Result[];   // all students for that period
}

export interface FinalResultInput {
  rows:         Result[];          // full-year merged rows (averaged/final)
  periods:      PeriodSnapshot[];  // 2 or 4 snapshots in order
  subjects:     string[];
  school:       School;
  year:         string;
  grade:        string;
  section:      string;
  periodSystem: PeriodSystem;
}

/**
 * generateFinalResultDoc — Redesigned for readability
 *
 * Layout (A4 Portrait, no landscape):
 *
 *   Section 1 — Cover + Class Summary
 *     School header, meta info, full class ranking table
 *     (Rank | ID | Name | Total | Avg | % | Grade | Remark)
 *     This gives the teacher a quick overview of all 50 students on the
 *     first pages.
 *
 *   Section 2 — Per-Student Detail Cards
 *     One card per student (2 per page approximately).
 *     Each card shows:
 *       • Student header (rank, name, ID, class)
 *       • Score table: subjects as rows, periods as columns + Final avg
 *       • Summary bar (Total | Avg | % | Grade | Remark)
 *     This replaces the unreadable 40-column wide landscape table.
 */
export async function generateFinalResultDoc(input: FinalResultInput): Promise<void> {
  const { rows, periods, subjects, school, year, grade, section, periodSystem } = input;

  const periodMaps   = periods.map((p) => new Map(p.rows.map((r) => [r.id, r])));
  const periodLabels = periods.map((p) => shortPeriodLabel(p.periodLabel));
  const systemLabel  = periodSystem === 'quarter' ? 'Quarter System' : 'Semester System';
  const periodSummary = periods.map((p) => p.periodLabel).join(' + ');

  // ── Shared style helpers ──────────────────────────────────────────────────

  // Compact table cell for the summary ranking table
  function rankCell(text: string, w: number, opts: { bold?: boolean; center?: boolean; shaded?: boolean } = {}): TableCell {
    return dataCell(text, w, { ...opts, fontSize: 18 });
  }
  function rankHdr(text: string, w: number): TableCell {
    return headerCell(text, w, 18);
  }

  // ── Section 1: Class Summary Ranking Table ────────────────────────────────

  const summaryRows = rows.map((r, idx) =>
    new TableRow({
      children: [
        rankCell(String(r.rank),                 6,  { center: true, bold: r.rank <= 3, shaded: idx % 2 === 0 }),
        rankCell(r.id,                          10,  { shaded: idx % 2 === 0 }),
        rankCell(r.name,                        26,  { bold: true, shaded: idx % 2 === 0 }),
        rankCell(`${r.total}/${r.maximum}`,     14,  { center: true, shaded: idx % 2 === 0 }),
        rankCell(r.average.toFixed(1),           9,  { center: true, shaded: idx % 2 === 0 }),
        rankCell(`${r.percentage.toFixed(1)}%`,  9,  { center: true, shaded: idx % 2 === 0 }),
        rankCell(r.letterGrade,                  8,  { center: true, bold: true, shaded: idx % 2 === 0 }),
        rankCell(r.status,                      18,  { center: true, shaded: idx % 2 === 0 }),
      ],
    })
  );

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          rankHdr('Rank',   6),
          rankHdr('ID',    10),
          rankHdr('Name',  26),
          rankHdr('Total', 14),
          rankHdr('Avg',    9),
          rankHdr('%',      9),
          rankHdr('Grade',  8),
          rankHdr('Remark', 18),
        ],
      }),
      ...summaryRows,
    ],
  });

  // ── Section 2: Per-Student Detail Cards ───────────────────────────────────
  // Each card: header paragraph + period-score table + summary row
  // Two cards fit comfortably on one A4 portrait page.

  const studentCardChildren: (Paragraph | Table)[] = [];

  rows.forEach((r, studentIdx) => {
    // Student header bar
    studentCardChildren.push(
      new Paragraph({
        spacing: { before: studentIdx === 0 ? 0 : 280, after: 60 },
        shading: { type: ShadingType.CLEAR, fill: NAVY, color: NAVY },
        children: [
          new TextRun({ text: `  #${r.rank}  ${r.name}`, font: FONT, size: 22, bold: true, color: 'FFFFFF' }),
          new TextRun({ text: `  ·  ID: ${r.id}  ·  ${grade}${section}  ·  ${year}`, font: FONT, size: 18, color: 'CCDDFF' }),
        ],
      })
    );

    // Score table: rows = subjects, columns = Period labels + Final
    // Column widths: Subject(fixed) + one col per period + Final + Grade + Max
    const numPeriods = periods.length;
    // Aim: subject ~35%, each period col equal share of remaining, final ~10%, grade ~8%
    const subjColW   = 32;
    const remaining  = 100 - subjColW - 10 - 8 - 8;  // for period cols + max
    const periodColW = Math.max(6, Math.floor(remaining / (numPeriods + 1)));
    const maxColW    = 8;

    const scoreHeaderCells = [
      headerCell('Subject', subjColW, 18),
      ...periodLabels.map(lbl => headerCell(lbl, periodColW, 18)),
      headerCell('Final',   periodColW, 18),
      headerCell('Grade',   8, 18),
      headerCell('Max',     maxColW, 18),
    ];

    const scoreBodyRows = subjects.map((subj, si) => {
      const shade = si % 2 === 0;
      const finalScore = r.scores[subj];
      const finalNum   = finalScore !== undefined && finalScore !== '' ? Number(finalScore) : NaN;

      const periodScoreCells = periodMaps.map((pMap) => {
        const pRow  = pMap.get(r.id);
        const score = pRow?.scores[subj];
        return dataCell(
          score !== undefined && score !== '' ? String(score) : '—',
          periodColW,
          { center: true, shaded: shade, fontSize: 18 }
        );
      });

      return new TableRow({
        children: [
          dataCell(subj,                                                  subjColW,   { shaded: shade, fontSize: 18 }),
          ...periodScoreCells,
          dataCell(!isNaN(finalNum) ? String(finalScore) : '—',          periodColW, { center: true, bold: true, shaded: shade, fontSize: 18 }),
          dataCell(!isNaN(finalNum) ? getLetterGrade(finalNum) : '—',    8,          { center: true, bold: true, shaded: shade, fontSize: 18 }),
          dataCell('100',                                                  maxColW,   { center: true, shaded: shade, fontSize: 18 }),
        ],
      });
    });

    const scoreTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: scoreHeaderCells }),
        ...scoreBodyRows,
      ],
    });

    studentCardChildren.push(scoreTable);

    // Summary bar below the table
    studentCardChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 0 },
        shading: { type: ShadingType.CLEAR, fill: LIGHT, color: LIGHT },
        children: [
          new TextRun({ text: `  Total: `, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: `${r.total}/${r.maximum}`, font: FONT, size: 18, color: '222222' }),
          new TextRun({ text: `    Average: `, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: r.average.toFixed(1), font: FONT, size: 18, color: '222222' }),
          new TextRun({ text: `    Percentage: `, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: `${r.percentage.toFixed(1)}%`, font: FONT, size: 18, color: '222222' }),
          new TextRun({ text: `    Grade: `, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: r.letterGrade, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: `    Remark: `, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: r.status, font: FONT, size: 18, color: '222222' }),
          new TextRun({ text: `    Rank: `, font: FONT, size: 18, bold: true, color: NAVY }),
          new TextRun({ text: `#${r.rank}`, font: FONT, size: 18, bold: true, color: '222222' }),
          new TextRun({ text: `  `, font: FONT, size: 18 }),
        ],
      })
    );
  });

  // ── Build document ────────────────────────────────────────────────────────

  const doc = new Document({
    sections: [
      // ── Section 1: Cover + Class Summary ──────────────────────────────────
      {
        properties: {
          page: {
            size:   { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
            margin: { ...PAGE_MARGINS, left: convertInchesToTwip(0.75), right: convertInchesToTwip(0.75) },
          },
        },
        children: [
          ...schoolHeader(school),
          reportTitle('Annual Final Results — Full Year'),
          metaLine('Class',          `${grade}${section}`),
          metaLine('Academic Year',  year),
          metaLine('Period System',  systemLabel),
          metaLine('Period',         `Full Year (${periodSummary})`),
          metaLine('Total Students', String(rows.length)),
          sectionLabel('Class Summary — Rankings'),
          summaryTable,
          ...signatureBlock(school.teacher, school.principal),
          footerNote(school),
        ],
      },

      // ── Section 2: Per-Student Detail Cards ────────────────────────────────
      {
        properties: {
          page: {
            size:   { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
            margin: { ...PAGE_MARGINS, left: convertInchesToTwip(0.75), right: convertInchesToTwip(0.75) },
          },
        },
        children: [
          ...schoolHeader(school),
          reportTitle('Per-Student Score Breakdown'),
          metaLine('Class',         `${grade}${section}`),
          metaLine('Academic Year', year),
          metaLine('Period',        `Full Year (${periodSummary})`),
          new Paragraph({ spacing: { after: 80 }, children: [] }),
          ...studentCardChildren,
          new Paragraph({ spacing: { before: 200 }, children: [] }),
          ...signatureBlock(school.teacher, school.principal),
          footerNote(school),
        ],
      },
    ],
  });

  await saveDoc(doc, `${school.name}_${grade}${section}_FinalResult_FullYear.docx`);
}

// ── 5. Activity Report DOC ────────────────────────────────────────────────────

export interface ActivityScoreRow {
  student_code: string;
  full_name:    string;
  roll_number?: string | null;
  score:        number | null;
}

export interface ActivityReportInput {
  activity: {
    activity_type:   string;
    name:            string;
    subject:         string;
    activity_date:   string | null;
    max_score:       number;
    description:     string | null;
    teacher_comment: string | null;
  };
  /** Only published scores — never call this with unpublished rows */
  scores:  ActivityScoreRow[];
  school:  School;
  year:    string;
  grade:   string;
  section: string;
}

export async function generateActivityReportDoc(input: ActivityReportInput): Promise<void> {
  const { activity, scores, school, year, grade, section } = input;

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        .format(new Date(d + 'T00:00:00'));
    } catch { return d; }
  };

  // Score table
  const scoreRows: TableRow[] = scores.map((s, idx) => {
    const shade  = idx % 2 === 0;
    const pct    = s.score !== null ? ((s.score / activity.max_score) * 100).toFixed(1) : '—';
    const letter = s.score !== null ? getLetterGrade(s.score / activity.max_score * 100) : '—';
    return new TableRow({
      children: [
        dataCell(String(idx + 1),            5,  { center: true, shaded: shade }),
        dataCell(s.student_code,             12, { shaded: shade }),
        dataCell(s.full_name,                33, { bold: true, shaded: shade }),
        dataCell(s.score !== null ? String(s.score) : '—', 15, { center: true, bold: true, shaded: shade }),
        dataCell(`${pct}%`,                  15, { center: true, shaded: shade }),
        dataCell(letter,                     10, { center: true, bold: true, shaded: shade }),
        dataCell(String(activity.max_score), 10, { center: true, shaded: shade }),
      ],
    });
  });

  const scoreTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('#',           5),
          headerCell('Student ID', 12),
          headerCell('Name',       33),
          headerCell('Score',      15),
          headerCell('%',          15),
          headerCell('Grade',      10),
          headerCell('Maximum',    10),
        ],
      }),
      ...scoreRows,
    ],
  });

  // Summary stats
  const validScores = scores.map((s) => s.score).filter((s): s is number => s !== null);
  const avg    = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length) : null;
  const highest = validScores.length ? Math.max(...validScores) : null;
  const lowest  = validScores.length ? Math.min(...validScores) : null;

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('Total Published', 25),
          headerCell('Class Average',   25),
          headerCell('Highest Score',   25),
          headerCell('Lowest Score',    25),
        ],
      }),
      new TableRow({
        children: [
          dataCell(String(validScores.length),              25, { center: true, bold: true }),
          dataCell(avg !== null ? avg.toFixed(1) : '—',     25, { center: true }),
          dataCell(highest !== null ? String(highest) : '—', 25, { center: true }),
          dataCell(lowest  !== null ? String(lowest)  : '—', 25, { center: true }),
        ],
      }),
    ],
  });

  const children: (Paragraph | Table)[] = [
    ...schoolHeader(school),
    reportTitle('Activity Score Report'),
    metaLine('Activity Type',  activity.activity_type),
    metaLine('Activity Name',  activity.name || '—'),
    metaLine('Subject',        activity.subject || '—'),
    metaLine('Date',           fmtDate(activity.activity_date)),
    metaLine('Maximum Score',  String(activity.max_score)),
    metaLine('Class',          `${grade}${section}`),
    metaLine('Academic Year',  year),
  ];

  if (activity.description) {
    children.push(sectionLabel('Description'));
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: activity.description, font: FONT, size: 22, color: '333333' })],
    }));
  }

  children.push(sectionLabel('Published Student Scores'));
  children.push(scoreTable);
  children.push(sectionLabel('Summary'));
  children.push(summaryTable);

  if (activity.teacher_comment) {
    children.push(sectionLabel('Teacher Comment'));
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: activity.teacher_comment, font: FONT, size: 22, italics: true, color: '444444' })],
    }));
  }

  children.push(...signatureBlock(school.teacher, school.principal));
  children.push(footerNote(school));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size:   { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
          margin: PAGE_MARGINS,
        },
      },
      children,
    }],
  });

  const safeName = activity.name.replace(/[^a-z0-9]/gi, '_');
  await saveDoc(doc, `${school.name}_${grade}${section}_Activity_${safeName}.docx`);
}

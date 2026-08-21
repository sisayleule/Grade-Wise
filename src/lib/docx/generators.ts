/**
 * .docx document generators for GradeWise.
 *
 * Four generators:
 *   generateStudentReportDoc  — one student, one semester or Full Year
 *   generateClassReportDoc    — all students in a class, one semester
 *   generateRankingDoc        — ranking table, one semester or Full Year
 *   generateFinalResultDoc    — full-year class report with both semesters
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

const FONT      = 'Calibri';
const NAVY      = '1E3A5F';
const LIGHT     = 'F0F4FA';
const BORDER    = '2E74B5';

/** Standard A4 page margins (in twips: 1 inch = 1440 twips) */
const PAGE_MARGINS = {
  top:    convertInchesToTwip(1),
  bottom: convertInchesToTwip(1),
  left:   convertInchesToTwip(1),
  right:  convertInchesToTwip(1),
};

// ── Reusable paragraph builders ───────────────────────────────────────────────

function schoolHeader(school: School): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: school.name.toUpperCase(),
          font: FONT,
          size: 32,   // 16pt
          bold: true,
          color: NAVY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: 'Official Academic Progress Report',
          font: FONT,
          size: 22,
          color: '555555',
          italics: true,
        }),
      ],
    }),
    dividerParagraph(),
  ];
}

function dividerParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, color: BORDER },
    },
    children: [],
  });
}

function reportTitle(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 60 },
    children: [
      new TextRun({
        text: title,
        font: FONT,
        size: 28,
        bold: true,
        color: NAVY,
      }),
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
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER },
    },
  });
}

function signatureBlock(teacher: string, principal: string): Paragraph[] {
  return [
    dividerParagraph(),
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: 'Prepared by: ', font: FONT, size: 22, bold: true }),
        new TextRun({ text: teacher,         font: FONT, size: 22 }),
        new TextRun({ text: '           ' }),
        new TextRun({ text: 'Authorized by: ', font: FONT, size: 22, bold: true }),
        new TextRun({ text: principal,        font: FONT, size: 22 }),
      ],
    }),
    new Paragraph({
      spacing: { before: 400 },
      children: [
        new TextRun({ text: 'Teacher\'s Signature: ________________________     ', font: FONT, size: 22 }),
        new TextRun({ text: 'Principal\'s Signature: ________________________',   font: FONT, size: 22 }),
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
        font: FONT,
        size: 18,
        color: '888888',
        italics: true,
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

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: cellBorder,
    shading: { type: ShadingType.CLEAR, fill: NAVY, color: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text, font: FONT, size: 20, bold: true, color: 'FFFFFF' }),
        ],
      }),
    ],
  });
}

function dataCell(
  text: string,
  widthPct: number,
  opts: { bold?: boolean; center?: boolean; shaded?: boolean } = {}
): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: cellBorder,
    shading: opts.shaded
      ? { type: ShadingType.CLEAR, fill: LIGHT, color: LIGHT }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({
            text,
            font: FONT,
            size: 20,
            bold: opts.bold ?? false,
            color: '222222',
          }),
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
  student:  Result;
  subjects: string[];
  school:   School;
  year:     string;
  grade:    string;
  section:  string;
  semester: string;
  // Full-Year only: raw semester scores before averaging
  s1Scores?: Record<string, string | number>;
  s2Scores?: Record<string, string | number>;
}

export async function generateStudentReportDoc(input: StudentReportInput): Promise<void> {
  const { student, subjects, school, year, grade, section, semester, s1Scores, s2Scores } = input;
  const isFullYear = semester === 'Full Year';

  // Scores table rows
  const scoreRows = subjects.map((subj, idx) => {
    const shade = idx % 2 === 0;
    if (isFullYear && s1Scores && s2Scores) {
      const s1 = String(s1Scores[subj] ?? '—');
      const s2 = String(s2Scores[subj] ?? '—');
      const avg = student.scores[subj];
      const avgNum = avg !== undefined && avg !== '' ? Number(avg) : NaN;
      return new TableRow({
        children: [
          dataCell(subj,  27, { shaded: shade }),
          dataCell(s1,    15, { center: true, shaded: shade }),
          dataCell(s2,    15, { center: true, shaded: shade }),
          dataCell(avgNum !== undefined && !isNaN(avgNum) ? String(avg) : '—', 15, { center: true, bold: true, shaded: shade }),
          dataCell(!isNaN(avgNum) ? getLetterGrade(avgNum) : '—', 13, { center: true, bold: true, shaded: shade }),
          dataCell('100', 15, { center: true, shaded: shade }),
        ],
      });
    }
    return new TableRow({
      children: [
        dataCell(subj,                   40, { shaded: shade }),
        dataCell(String(student.scores[subj] ?? '—'), 20, { center: true, bold: true, shaded: shade }),
        dataCell(getLetterGrade(Number(student.scores[subj])), 15, { center: true, bold: true, shaded: shade }),
        dataCell('100',                  25, { center: true, shaded: shade }),
      ],
    });
  });

  const scoresTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: isFullYear && s1Scores && s2Scores
          ? [
              headerCell('Subject',     27),
              headerCell('Semester 1',  15),
              headerCell('Semester 2',  15),
              headerCell('Final Score', 15),
              headerCell('Grade',       13),
              headerCell('Maximum',     15),
            ]
          : [
              headerCell('Subject', 40),
              headerCell('Score',   20),
              headerCell('Grade',   15),
              headerCell('Maximum', 25),
            ],
      }),
      ...scoreRows,
    ],
  });

  // Summary table
  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('Total',      20),
          headerCell('Average',    20),
          headerCell('Percentage', 20),
          headerCell('Grade',      20),
          headerCell('Remark',     20),
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

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size:    { width:  convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
          margin:  PAGE_MARGINS,
        },
      },
      children: [
        ...schoolHeader(school),
        reportTitle('Student Progress Report'),
        new Paragraph({ spacing: { after: 40 }, children: [] }),
        // Meta grid
        metaLine('Student',       student.name),
        metaLine('Student ID',    student.id),
        metaLine('Class',         `${grade}${section}`),
        metaLine('Academic Year', year),
        metaLine('Period',        semester),
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
  rows:     Result[];
  subjects: string[];
  school:   School;
  year:     string;
  grade:    string;
  section:  string;
  semester: string;
}

export async function generateClassReportDoc(input: ClassReportInput): Promise<void> {
  const { rows, subjects, school, year, grade, section, semester } = input;

  // Column widths: Rank(6) + ID(8) + Name(20) + each subject(equal share of 40) + Total(8) + Avg(8) + %(8) + Rank(if not first col)(0)
  const subjectWidth = Math.max(5, Math.floor(36 / Math.max(subjects.length, 1)));
  const fixedWidth   = 6 + 8 + 18 + 8 + 8 + 8 + 8;   // rank+id+name+total+avg+pct+status = 64
  // Redistribute: make subjects fit in remaining 36%
  const nameWidth = 18;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Rank',    5),
      headerCell('ID',      8),
      headerCell('Name',    nameWidth),
      ...subjects.map(() => headerCell('', subjectWidth)),
      headerCell('Total',   7),
      headerCell('Avg',     6),
      headerCell('%',       5),
      headerCell('Grade',   6),
      headerCell('Remark',  7),
    ],
  });

  // Subject name row (second header row)
  const subjectNameRow = new TableRow({
    tableHeader: true,
    children: [
      dataCell('',    5,  { shaded: true }),
      dataCell('',    8,  { shaded: true }),
      dataCell('',    nameWidth, { shaded: true }),
      ...subjects.map(s => dataCell(s, subjectWidth, { shaded: true, center: true })),
      dataCell('',    7,  { shaded: true }),
      dataCell('',    6,  { shaded: true }),
      dataCell('',    5,  { shaded: true }),
      dataCell('',    6,  { shaded: true }),
      dataCell('',    7,  { shaded: true }),
    ],
  });

  const dataRows = rows.map((r, idx) =>
    new TableRow({
      children: [
        dataCell(String(r.rank),                    5,  { center: true, bold: r.rank <= 3, shaded: idx % 2 === 0 }),
        dataCell(r.id,                              8,  { shaded: idx % 2 === 0 }),
        dataCell(r.name,                            nameWidth, { bold: true, shaded: idx % 2 === 0 }),
        ...subjects.map(s => dataCell(
          String(r.scores[s] ?? '—'),
          subjectWidth,
          { center: true, shaded: idx % 2 === 0 }
        )),
        dataCell(`${r.total}/${r.maximum}`,         7,  { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.average.toFixed(1),              6,  { center: true, shaded: idx % 2 === 0 }),
        dataCell(`${r.percentage.toFixed(1)}%`,     5,  { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.letterGrade,                     6,  { center: true, bold: true, shaded: idx % 2 === 0 }),
        dataCell(r.status,                          7,  { center: true, shaded: idx % 2 === 0 }),
      ],
    })
  );

  const classTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, subjectNameRow, ...dataRows],
  });

  // Class is wide — use landscape for many subjects
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
        metaLine('Class',         `${grade}${section}`),
        metaLine('Academic Year', year),
        metaLine('Period',        semester),
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
  rows:    Result[];
  school:  School;
  year:    string;
  grade:   string;
  section: string;
  semester: string;
  mode:    'section' | 'grade';
}

export async function generateRankingDoc(input: RankingDocInput): Promise<void> {
  const { rows, school, year, grade, section, semester, mode } = input;

  const rankRows = rows.map((r, idx) =>
    new TableRow({
      children: [
        dataCell(String(r.rank),                  8,  { center: true, bold: r.rank <= 3, shaded: r.rank <= 3 }),
        dataCell(r.id,                            10, { shaded: idx % 2 === 0 }),
        dataCell(r.name,                          27, { bold: true, shaded: idx % 2 === 0 }),
        ...(mode === 'grade' ? [dataCell(`${grade}${(r as any).section || section}`, 10, { center: true, shaded: idx % 2 === 0 })] : []),
        dataCell(`${r.total}/${r.maximum}`,       13, { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.average.toFixed(1),            9,  { center: true, shaded: idx % 2 === 0 }),
        dataCell(`${r.percentage.toFixed(1)}%`,   9,  { center: true, shaded: idx % 2 === 0 }),
        dataCell(r.letterGrade,                   8,  { center: true, bold: true, shaded: idx % 2 === 0 }),
        dataCell(r.status,                        16, { center: true, shaded: idx % 2 === 0 }),
      ],
    })
  );

  const rankTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('Rank',  8),
          headerCell('ID',   10),
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

export interface FinalResultInput {
  rows:        Result[];      // full-year merged rows (averaged)
  s1Rows:      Result[];      // semester 1 rows (same students)
  s2Rows:      Result[];      // semester 2 rows
  subjects:    string[];
  school:      School;
  year:        string;
  grade:       string;
  section:     string;
}

export async function generateFinalResultDoc(input: FinalResultInput): Promise<void> {
  const { rows, s1Rows, s2Rows, subjects, school, year, grade, section } = input;

  // Build ID → S1/S2 score maps for side-by-side display
  const s1Map = new Map(s1Rows.map(r => [r.id, r]));
  const s2Map = new Map(s2Rows.map(r => [r.id, r]));

  // Per-subject column width
  const subjectWidth = Math.max(4, Math.floor(50 / Math.max(subjects.length, 1)));
  const nameWidth = 16;

  // Header: Rank | ID | Name | [S1 subj, S2 subj, Final subj] x N | Total | Avg | % | Remark
  const colsPerSubj = 3; // S1, S2, Final
  const subjectCols: TableCell[] = [];
  subjects.forEach(s => {
    subjectCols.push(headerCell(`${s}\nS1`, subjectWidth));
    subjectCols.push(headerCell(`${s}\nS2`, subjectWidth));
    subjectCols.push(headerCell(`${s}\nFinal`, subjectWidth));
  });

  const landscape = subjects.length > 3; // always landscape for full-year

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Rank',  4),
      headerCell('ID',    6),
      headerCell('Name',  nameWidth),
      ...subjectCols,
      headerCell('Total', 6),
      headerCell('Avg',   5),
      headerCell('%',     5),
      headerCell('Grade', 5),
      headerCell('Remark', 6),
    ],
  });

  const dataRows = rows.map((r, idx) => {
    const s1 = s1Map.get(r.id);
    const s2 = s2Map.get(r.id);
    const shade = idx % 2 === 0;
    const subjCells: TableCell[] = [];
    subjects.forEach(subj => {
      subjCells.push(dataCell(String(s1?.scores[subj] ?? '—'), subjectWidth, { center: true, shaded: shade }));
      subjCells.push(dataCell(String(s2?.scores[subj] ?? '—'), subjectWidth, { center: true, shaded: shade }));
      subjCells.push(dataCell(String(r.scores[subj] ?? '—'),  subjectWidth, { center: true, bold: true, shaded: shade }));
    });
    return new TableRow({
      children: [
        dataCell(String(r.rank),               4, { center: true, bold: r.rank <= 3, shaded: shade }),
        dataCell(r.id,                         6, { shaded: shade }),
        dataCell(r.name,                       nameWidth, { bold: true, shaded: shade }),
        ...subjCells,
        dataCell(`${r.total}/${r.maximum}`,    6, { center: true, shaded: shade }),
        dataCell(r.average.toFixed(1),         5, { center: true, shaded: shade }),
        dataCell(`${r.percentage.toFixed(1)}%`, 5, { center: true, shaded: shade }),
        dataCell(r.letterGrade,                5, { center: true, bold: true, shaded: shade }),
        dataCell(r.status,                     6, { center: true, shaded: shade }),
      ],
    });
  });

  const finalTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: convertInchesToTwip(11.69), height: convertInchesToTwip(8.27), orientation: PageOrientation.LANDSCAPE },
          margin: { ...PAGE_MARGINS, left: convertInchesToTwip(0.5), right: convertInchesToTwip(0.5) },
        },
      },
      children: [
        ...schoolHeader(school),
        reportTitle('Annual Final Results — Full Year'),
        metaLine('Class',         `${grade}${section}`),
        metaLine('Academic Year', year),
        metaLine('Period',        'Full Year (Semester 1 + Semester 2)'),
        metaLine('Total Students', String(rows.length)),
        sectionLabel('Full-Year Results (S1 | S2 | Final per Subject)'),
        finalTable,
        ...signatureBlock(school.teacher, school.principal),
        footerNote(school),
      ],
    }],
  });

  await saveDoc(doc, `${school.name}_${grade}${section}_FinalResult_FullYear.docx`);
}

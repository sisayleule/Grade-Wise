import { NextRequest, NextResponse } from 'next/server';
import { requireApproved } from 'lib/supabase/requireApproved';

/**
 * POST /api/roster/parse
 *
 * Parses an uploaded file into a flat array of roster preview rows without
 * touching the database. Used by the Roster upload UI to show a review table
 * before the teacher confirms and saves.
 *
 * Accepts: multipart/form-data with a single field named "file".
 *
 * Supported formats:
 *   Structured  — .csv, .xlsx, .xls
 *     Parsed locally on the server using the XLSX library.
 *     Expected columns (order-independent, case-insensitive):
 *       Full Name / Name / Student Name
 *       Student ID / ID / Adm No / Admission No / Student No
 *       Roll No / Roll Number / Roll
 *       Sex / Gender
 *
 *   AI-extracted — .jpg, .jpeg, .png, .pdf, .doc, .docx
 *     Forwarded to the existing /api/extract Gemini pipeline.
 *     Gemini returns a result-sheet shape { subjects, rows } — this route
 *     remaps that into roster rows by extracting the student id (r.id) and
 *     name (r.name) fields; subject scores are discarded since a roster only
 *     needs identity data. The teacher reviews and corrects in the preview
 *     table before saving.
 *
 * Returns:
 * {
 *   rows: Array<{
 *     full_name:    string;
 *     student_code: string;
 *     roll_number:  string;   // blank for AI-extracted files (not in a result sheet)
 *     sex:          string;   // normalised to 'M' | 'F' | 'Other' | ''
 *   }>;
 *   warnings: string[];       // non-fatal parse notes
 *   source: 'structured' | 'ai';
 * }
 */
export async function POST(request: NextRequest) {
  const guard = await requireApproved();
  if (guard.error) return guard.error;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const fname = file.name.toLowerCase();

  // ── Route by file type ────────────────────────────────────────────────────
  const isCSV  = fname.endsWith('.csv');
  const isXLSX = fname.endsWith('.xlsx') || fname.endsWith('.xls');
  const isAI   =
    fname.endsWith('.jpg')  || fname.endsWith('.jpeg') ||
    fname.endsWith('.png')  ||
    fname.endsWith('.pdf')  ||
    fname.endsWith('.doc')  || fname.endsWith('.docx');

  if (!isCSV && !isXLSX && !isAI) {
    return NextResponse.json(
      {
        error:
          'Unsupported file type. Upload a CSV, Excel (.xlsx/.xls), image ' +
          '(.jpg/.png), PDF, or Word document (.doc/.docx).',
      },
      { status: 400 }
    );
  }

  // ── AI path (image / PDF / DOCX) ─────────────────────────────────────────
  if (isAI) {
    return handleAIExtraction(request, file);
  }

  // ── Structured path (CSV / XLSX) ─────────────────────────────────────────
  try {
    const buffer = await file.arrayBuffer();
    let rows2d: string[][] = [];

    if (isCSV) {
      const text = new TextDecoder().decode(buffer);
      rows2d = parseCSVRows(text);
    } else {
      const XLSX = await import('xlsx');
      const book = XLSX.read(buffer, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      rows2d = raw.map((row) => row.map((c) => String(c ?? '').trim()));
    }

    if (!rows2d.length) {
      return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
    }

    const { rows, warnings } = parseStructuredRoster(rows2d);

    if (!rows.length) {
      return NextResponse.json(
        { error: 'No student rows found in the file. Check column headers and data.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ rows, warnings, source: 'structured' });
  } catch (err: any) {
    console.error('[roster/parse structured]', err.message);
    return NextResponse.json(
      { error: 'Failed to parse file: ' + (err.message ?? 'unknown error') },
      { status: 500 }
    );
  }
}

// ── AI extraction path ────────────────────────────────────────────────────────
// Forwards the file to /api/extract (the existing Gemini pipeline) and remaps
// its result-sheet output into roster rows.  This keeps all Gemini key
// management, quota handling, and error messages in one place.

async function handleAIExtraction(
  request: NextRequest,
  file: File
): Promise<NextResponse> {
  // Reconstruct the origin so we can call /api/extract as an internal fetch.
  // In production this is the actual deployment URL; locally it uses the
  // same host:port the request arrived on (avoids hardcoded port mismatches).
  const requestUrl = new URL(request.url);
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${requestUrl.protocol}//${requestUrl.host}`;

  // Forward the file in a new FormData — same shape /api/extract expects.
  const forward = new FormData();
  forward.append('file', file);
  forward.append('type', 'image'); // /api/extract treats all non-text uploads as 'image'

  let extractRes: Response;
  try {
    extractRes = await fetch(`${origin}/api/extract`, {
      method:  'POST',
      body:    forward,
      // Forward the cookie header so requireApproved() inside /api/extract
      // can verify the session without needing a separate auth round-trip.
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
  } catch (networkErr: any) {
    console.error('[roster/parse AI] network error calling /api/extract:', networkErr.message);
    return NextResponse.json(
      { error: 'AI extraction service unreachable. Try again.' },
      { status: 503 }
    );
  }

  // Surface Gemini-specific errors (no key, quota, etc.) verbatim so the
  // teacher sees the same helpful message they would from the result-upload flow.
  if (!extractRes.ok) {
    const errBody = await extractRes.json().catch(() => ({ error: 'AI extraction failed.' }));
    return NextResponse.json(
      { error: errBody.error ?? 'AI extraction failed.' },
      { status: extractRes.status }
    );
  }

  // /api/extract returns { subjects: string[], rows: ScoreRow[], note?: string }
  // where rows = [{ id, name, scores, uncertain? }]
  const extracted = await extractRes.json() as {
    subjects: string[];
    rows: Array<{ id: string; name: string; scores: Record<string, string | number>; uncertain?: string[] }>;
    note?: string;
  };

  if (!extracted.rows?.length) {
    return NextResponse.json(
      {
        error:
          'No student rows could be read from this file. ' +
          'Make sure the document contains a visible student list or register table.',
      },
      { status: 400 }
    );
  }

  // Remap result-sheet rows → roster rows.
  // We only care about id (student_code) and name; scores are irrelevant for a roster.
  const rosterRows = extracted.rows.map((r) => ({
    full_name:    (r.name  ?? '').trim(),
    student_code: (r.id    ?? '').trim(),
    roll_number:  '',   // result sheets don't contain roll numbers
    sex:          '',   // not present in result sheets either
  })).filter((r) => r.full_name || r.student_code);

  if (!rosterRows.length) {
    return NextResponse.json(
      { error: 'No recognisable student data found in the file.' },
      { status: 400 }
    );
  }

  const warnings: string[] = [];

  // Carry through any note from extraction (e.g. "check highlighted cells")
  if (extracted.note) {
    warnings.push(extracted.note);
  }

  // Roll No and Sex are not readable from a result sheet image/PDF.
  // Prompt the teacher to fill them in the preview table.
  warnings.push(
    'Roll No and Sex could not be read from this file type — fill them in the preview table if needed.'
  );

  return NextResponse.json({ rows: rosterRows, warnings, source: 'ai' });
}

// ── Structured-format helpers ─────────────────────────────────────────────────

interface RosterPreviewRow {
  full_name:    string;
  student_code: string;
  roll_number:  string;
  sex:          string;
}

function parseStructuredRoster(rows2d: string[][]): {
  rows: RosterPreviewRow[];
  warnings: string[];
} {
  const NAME_HDR = /^(full[\s_-]?name|student[\s_-]?name|name|learner[\s_-]?name|candidate)$/i;
  const ID_HDR   = /^(student[\s_-]?(id|no\.?|code)|id|adm(ission)?[\s_-]?(no\.?)?|reg(istration)?[\s_-]?(no\.?)?|index[\s_-]?(no\.?)?)$/i;
  const ROLL_HDR = /^(roll[\s_-]?(no\.?|number)?|roll)$/i;
  const SEX_HDR  = /^(sex|gender)$/i;

  let headerIdx = -1;
  let nameCol   = -1;
  let idCol     = -1;
  let rollCol   = -1;
  let sexCol    = -1;

  for (let ri = 0; ri < Math.min(rows2d.length, 8); ri++) {
    const cells = rows2d[ri];
    let foundName = -1, foundId = -1;
    cells.forEach((c, ci) => {
      const t = c.trim();
      if (NAME_HDR.test(t) && foundName === -1) foundName = ci;
      if (ID_HDR.test(t)   && foundId   === -1) foundId   = ci;
    });
    if (foundName !== -1 || foundId !== -1) {
      headerIdx = ri;
      nameCol   = foundName;
      idCol     = foundId;
      cells.forEach((c, ci) => {
        const t = c.trim();
        if (ROLL_HDR.test(t) && rollCol === -1) rollCol = ci;
        if (SEX_HDR.test(t)  && sexCol  === -1) sexCol  = ci;
      });
      break;
    }
  }

  const warnings: string[] = [];

  if (headerIdx === -1) {
    warnings.push(
      'Could not detect column headers — assumed: Name, Student ID, Roll No, Sex ' +
      '(columns 1–4). Check the preview and correct any mismatches.'
    );
    headerIdx = -1;
    nameCol   = 0;
    idCol     = 1;
    rollCol   = 2;
    sexCol    = 3;
  }

  const rows: RosterPreviewRow[] = [];
  const dataStart = headerIdx === -1 ? 0 : headerIdx + 1;

  for (let ri = dataStart; ri < rows2d.length; ri++) {
    const cells = rows2d[ri];
    if (cells.every((c) => !c.trim())) continue;

    const full_name    = nameCol >= 0 ? (cells[nameCol]  ?? '').trim() : '';
    const student_code = idCol   >= 0 ? (cells[idCol]    ?? '').trim() : '';
    const roll_number  = rollCol >= 0 ? (cells[rollCol]  ?? '').trim() : '';
    const rawSex       = sexCol  >= 0 ? (cells[sexCol]   ?? '').trim() : '';

    if (!full_name && !student_code) continue;

    rows.push({ full_name, student_code, roll_number, sex: normaliseSex(rawSex) });
  }

  return { rows, warnings };
}

/** Normalise free-text sex values to 'M' | 'F' | 'Other' | '' */
function normaliseSex(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return '';
  if (t === 'm' || t === 'male'   || t === 'boy')  return 'M';
  if (t === 'f' || t === 'female' || t === 'girl') return 'F';
  return 'Other';
}

/** Minimal RFC-4180 CSV parser — handles double-quoted fields with commas. */
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { cells.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

/**
 * Result-sheet extraction pipeline.
 *
 * Supports JPG / JPEG / PNG / PDF / DOC / DOCX / XLSX / CSV.
 *
 * Images use Gemini Vision API for direct table reading when API key is available,
 * falling back to Tesseract OCR if not configured.
 * 
 * PDFs with a digital text layer are extracted from glyph positions;
 * scanned pages use Gemini or are rendered and OCR'd.
 *
 * Design goal: zero manual corrections on clean result sheets.
 */
import { ScoreRow } from './grades';
import { extractWithGemini, extractTextWithGemini } from './gemini-extract';

export type Extracted = {
  subjects: string[];
  rows: ScoreRow[];
  note?: string;
};

type Token = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Tokens that are pure punctuation (OCR often reads table lines as "|"). */
const NOISE_TOKEN = /^[|:;,•·._"'`~*+=#@^&!?()\[\]{}<>\\\/—–\-]+$/;
const stripToken = (t: string) =>
  t.replace(/^[|:;,()\[\]{}]+|[|:;,()\[\]{}]+$/g, '');

const isNumeric = (t: string) => /^[+-]?\d+(\.\d+)?$/.test(t.trim());

/**
 * Normalize common OCR digit/letter confusions inside number strings.
 * Extended set covers all frequent Tesseract mistakes on tabular result sheets.
 */
function normalizeNumber(raw: string): string {
  let s = raw.trim();
  // Strip trailing junk: "90." "90," "90)" and OCR %-misreads like "9%" -> "9"
  // The % is stripped only when preceded by a digit.
  s = s.replace(/\d%$/, (m) => m.slice(0, -1));
  s = s.replace(/[,.)]+$/, '');
  // Character-level OCR substitutions (applied positionally: only valid
  // when surrounded by digits or at the edges of an all-digit string).
  s = s
    .replace(/O/g, '0')
    .replace(/o/g, '0')
    .replace(/D/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/Z/g, '2')
    .replace(/z/g, '2')
    .replace(/S/g, '5')
    .replace(/s/g, '5')
    .replace(/G/g, '6')
    .replace(/b/g, '6')
    .replace(/B/g, '8')
    .replace(/q/g, '9')
    .replace(/g/g, '9');
  return s;
}

/**
 * Returns true when a raw OCR token (after normalizeNumber) looks like a
 * valid student score (0-100, integer or one decimal place).
 */
const isScore = (t: string) => {
  const n = normalizeNumber(t);
  const v = Number(n);
  return /^\d{1,3}(\.\d{1,2})?$/.test(n) && v >= 0 && v <= 100;
};

const isID = (t: string) => {
  const s = t.trim();
  if (!s || s.length > 14) return false;
  return (
    /^\d{3,6}$/.test(s) ||                          // 001, 12045
    /^\d{4}[-/]\d{4}$/.test(s) ||                   // 2023/0456
    /^[A-Za-z]{1,6}\d{2,8}$/i.test(s) ||            // GA250801
    /^[A-Za-z]{1,4}\d{1,2}[-_/ ]?\d{2,4}$/i.test(s) || // G8-001
    /^[A-Za-z]{1,4}[-_/ ]?\d{1,4}$/i.test(s)        // G8, G12, A-3
  );
};

const SKIP_HEADER =
  /^(total|average|avg\.?|percent(age)?|^%$|grade|rank|position|mean|sum|remark|status|comment|gpa)$/i;
const NAME_HEADER = /student.*name|^name$|^student$|^learner$|learner.*name|^candidate$/i;
const ID_HEADER = /^(id|s\.?no\.?|s\/n|sn|student\s*id|student\s*no|adm(ission)?\s*(no\.?)?|reg(istration)?\s*(no\.?)?|roll\s*(no\.?)?|index\s*(no\.?)?)$/i;

/** Merge OCR-split header words: "Student" + "ID" -> "Student ID" */
const MERGE_PREFIX = /^(student|learner|adm|adm\.|reg|reg\.|roll|index|total|avg|average)$/i;
const MERGE_SUFFIX = /^(id|name|no|no\.|number)$/i;

function mergeHeaderTokens(sorted: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (next && MERGE_PREFIX.test(cur.text) && MERGE_SUFFIX.test(next.text)) {
      out.push({ ...cur, text: `${cur.text} ${next.text}`, w: next.x + next.w - cur.x });
      i++;
    } else {
      out.push(cur);
    }
  }
  return out;
}

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Split tokens whose text packs several numbers ("90 85 92") into separate tokens. */
function expandTokens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const parts = t.text.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => isNumeric(p) || isScore(p))) {
      const w = t.w / parts.length;
      parts.forEach((p, i) => out.push({ ...t, text: p, x: t.x + i * w, w }));
    } else {
      out.push(t);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Row / column clustering                                             */
/* ------------------------------------------------------------------ */

function clusterRows(tokens: Token[]): Token[][] {
  if (!tokens.length) return [];
  const sorted = [...tokens].sort((a, b) => a.y - b.y);
  const heights = sorted.map((t) => t.h).filter((h) => h > 0);
  const medH = median(heights) || 20;
  const rows: Token[][] = [];
  let cur: Token[] = [sorted[0]];
  let curY = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i];
    // Use 80% of median row height as the row-break threshold.
    // This tolerates minor vertical jitter within one row while still
    // separating genuinely distinct rows.
    if (Math.abs(t.y - curY) > medH * 0.8) {
      rows.push(cur.sort((a, b) => a.x - b.x));
      cur = [];
      curY = t.y;
    }
    cur.push(t);
    curY = cur.reduce((s, c) => s + c.y, 0) / cur.length;
  }
  if (cur.length) rows.push(cur.sort((a, b) => a.x - b.x));
  return rows;
}

/* ------------------------------------------------------------------ */
/* Header vocabulary                                                   */
/* ------------------------------------------------------------------ */

const HEADER_ID =
  /^(no\.?|s\/?no\.?|s\/n|sn|sno|id|student\s*id|student\s*no\.?|adm(?:\.|ission)?\s*(?:no\.?)?|reg(?:\.|istration)?\s*(?:no\.?)?|roll(?:\s*no\.?)?|index(?:\s*no\.?)?)$/i;
const HEADER_NAME =
  /^(name|student\s*name|learner(?:\s*name)?|candidate(?:\s*name)?)$/i;
const HEADER_SUBJECT =
  /^(english|mathematics|maths|math|physics|chemistry|biology|history|geography|computer(?:\s*science)?|comp\.?|kiswahili|swahili|science|general\s*science|social\s*studies|civics|religious\s*education|business(?:\s*studies)?|commerce|accounting|art|music|physical\s*education|pe|agriculture|home\s*science|cre|ire|literature|french|german|spanish|arabic|ict|design|technical|life\s*skills|typing)$/i;
const HEADER_SUMMARY =
  /^(total|marks?|average|avg\.?|percentage|percent|grade|rank|position|mean|score|scores|gpa|remark|status|comment)$/i;
const METADATA_WORD =
  /greenfield|academy|college|school|exam(?:ination)?|report|result|sheet|progress|semester|term|year|motto|slogan|ministry|republic|county|district|department|university|institute/i;

const normHeader = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9/ ]/g, '').replace(/\s+/g, ' ').trim();

const SUBJECT_VOCAB = [
  'english', 'mathematics', 'maths', 'math', 'physics', 'chemistry',
  'biology', 'history', 'geography', 'computer', 'computing', 'comp',
  'kiswahili', 'swahili', 'science', 'civics', 'commerce', 'accounting',
  'agriculture', 'art', 'music', 'french', 'german', 'spanish', 'arabic',
  'ict', 'cre', 'ire', 'literature', 'business', 'typing',
  'home science', 'social studies', 'religious education',
  'physical education', 'general science', 'life skills',
  'economics', 'technology', 'design', 'drama', 'technical',
];

/**
 * Aggressive OCR correction for subject names using phonetic matching,
 * character-level similarity, and common OCR mistake patterns.
 */
function correctSubjectName(raw: string): string {
  const normalized = normHeader(raw);
  if (!normalized || normalized.length < 3) return raw;

  // Direct match or fuzzy match via existing logic
  if (HEADER_SUBJECT.test(normalized) || fuzzySubject(raw)) {
    // Find the best canonical match
    for (const vocab of SUBJECT_VOCAB) {
      if (normalized === vocab) return toTitleCase(vocab);
      if (normalized.length >= 4 && levenshtein(normalized, vocab) <= 1) {
        return toTitleCase(vocab);
      }
      if (normalized.length >= 7 && normalized[0] === vocab[0] && levenshtein(normalized, vocab) <= 2) {
        return toTitleCase(vocab);
      }
    }
  }

  // Pattern-based OCR corrections for common misreads
  const corrections: Record<string, string> = {
    // Common full-word misreads
    'matematics': 'mathematics',
    'mathmatics': 'mathematics',
    'mathematcs': 'mathematics',
    'mathematic': 'mathematics',
    'englsh': 'english',
    'engish': 'english',
    'englih': 'english',
    'physcis': 'physics',
    'physcs': 'physics',
    'chemisty': 'chemistry',
    'chemstry': 'chemistry',
    'chemistr': 'chemistry',
    'chemitry': 'chemistry',
    'chemsitry': 'chemistry',
    'chernistry': 'chemistry',
    'biolgy': 'biology',
    'biolog': 'biology',
    'bioogy': 'biology',
    'histoy': 'history',
    'histry': 'history',
    'histor': 'history',
    'geograpy': 'geography',
    'geograph': 'geography',
    'geografy': 'geography',
    'geogaphy': 'geography',
    'geograohy': 'geography',
    'geograaphy': 'geography',
    'gekggr phy': 'geography', // exact OCR error from the screenshot
    'gekggrphy': 'geography',
    'geogr phy': 'geography',
    'kiswahli': 'kiswahili',
    'kiswahil': 'kiswahili',
    'kishwahili': 'kiswahili',
    'compter': 'computer',
    'computr': 'computer',
    'comuter': 'computer',
    'conputer': 'computer',
    'computter': 'computer',
    'agricuture': 'agriculture',
    'agriculure': 'agriculture',
    'agricullure': 'agriculture',
    'economcs': 'economics',
    'econornics': 'economics',
    'literture': 'literature',
    'literatue': 'literature',
    'commrce': 'commerce',
    'cornmerce': 'commerce',
    'accountng': 'accounting',
    'accountin': 'accounting',
  };

  if (corrections[normalized]) {
    return toTitleCase(corrections[normalized]);
  }

  // Substring matching for partially correct OCR (e.g., "CHEM" in "CHEMBJ")
  for (const vocab of SUBJECT_VOCAB) {
    if (vocab.length >= 4) {
      // Check if vocab is contained in the normalized text
      if (normalized.includes(vocab)) {
        return toTitleCase(vocab);
      }
      // Check if first 4-5 chars match
      const prefix = vocab.slice(0, Math.min(5, vocab.length));
      if (normalized.startsWith(prefix) && normalized.length <= vocab.length + 3) {
        return toTitleCase(vocab);
      }
    }
  }

  // Phonetic-like matching for extreme OCR errors
  const phonetic = normalized
    .replace(/ph/g, 'f')
    .replace(/ks/g, 'x')
    .replace(/[aeiou]+/g, (m) => m[0]) // collapse vowels
    .replace(/[^a-z]/g, '');
  
  for (const vocab of SUBJECT_VOCAB) {
    const vocabPhonetic = vocab
      .replace(/ph/g, 'f')
      .replace(/ks/g, 'x')
      .replace(/[aeiou]+/g, (m) => m[0])
      .replace(/[^a-z]/g, '');
    
    if (phonetic === vocabPhonetic || 
        (phonetic.length >= 4 && vocabPhonetic.startsWith(phonetic.slice(0, 4)))) {
      return toTitleCase(vocab);
    }
  }

  // Return title-cased original if no match found
  return toTitleCase(raw.trim());
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** True when the token matches a known subject name, tolerating OCR typos. */
function fuzzySubject(t: string): boolean {
  const n = normHeader(t);
  if (!n || n.length < 3) return false;
  if (HEADER_SUBJECT.test(n)) return true;
  return SUBJECT_VOCAB.some((v) => {
    if (n === v) return true;
    // Allow up to 2 edits for tokens >= 7 chars, 1 edit for shorter ones
    const maxDist = n.length >= 7 ? 2 : 1;
    if (n[0] !== v[0]) return false;
    return levenshtein(n, v) <= maxDist;
  });
}

function headerTokenScore(t: string): number {
  const n = normHeader(t);
  if (!n || n.length > 28) return 0;
  if (HEADER_ID.test(n) || HEADER_NAME.test(n) || fuzzySubject(t)) return 3;
  if (HEADER_SUMMARY.test(n)) return 2;
  if (/^[a-z]{3,16}$/.test(n) && !METADATA_WORD.test(n)) return 1;
  return 0;
}

function isStrictHeader(line: Token[], minScore = 5): boolean {
  const words = line.filter((t) => clean(t.text).length > 1);
  if (words.length < 2) return false;
  // A real header row contains no numeric values.
  if (line.filter((t) => isNumeric(t.text)).length >= 3) return false;
  let score = 0, strong = 0, subjectWords = 0;
  for (const w of words) {
    const s = headerTokenScore(w.text);
    score += s;
    if (s >= 3) strong++;
    if (fuzzySubject(w.text)) subjectWords++;
  }
  if (subjectWords < 1) return false;
  if (score < minScore || strong < 1) return false;
  const joined = words.map((w) => w.text).join(' ');
  if (/20\d\d|\d{4}\s*[-/]\s*\d{4}/.test(joined) && strong < 3) return false;
  return true;
}

/**
 * Merge the detected header line with up to 4 consecutive alphabetic-only
 * OCR lines directly below it. Tesseract frequently splits one visual header
 * row into several OCR lines (one per subject word). Without this merge only
 * the first fragment becomes columns and all subsequent subjects are lost,
 * causing every score to shift into the wrong column.
 * 
 * Returns both the merged header tokens AND the number of rows consumed,
 * so the caller can skip those rows when processing data.
 */
function findHeaderBlock(rows: Token[][], start: number): { tokens: Token[]; rowsConsumed: number } {
  const block = [...rows[start]];
  let consumed = 1;
  for (let i = start + 1; i < rows.length && i - start <= 4; i++) {
    const next = rows[i];
    if (!next || next.length < 1) break;
    // Stop if this line has ID-shaped tokens (student row starting)
    if (next.some((t) => isID(t.text) && !isScore(t.text))) break;
    // Stop if this line has any scores (data row)
    if (next.filter((t) => isScore(t.text)).length >= 2) break;
    // Only merge lines that are predominantly alphabetic (header words)
    const alpha = next.filter((t) => /^[A-Za-z]/.test(t.text)).length;
    if (alpha < Math.max(1, Math.ceil(next.length * 0.5))) break;
    block.push(...next);
    consumed++;
  }
  return { tokens: block, rowsConsumed: consumed };
}

function findStrictHeader(
  rows: Token[][],
  minScore = 5
): { line: Token[]; index: number; rowsConsumed: number } | null {
  for (let i = 0; i < rows.length; i++) {
    if (!isStrictHeader(rows[i], minScore)) continue;
    // The header must be followed by rows that contain scores.
    const later = rows.slice(i + 1);
    if (!later.some((r) => r.some((t) => isScore(t.text)))) continue;
    // Try merging consecutive header-word lines below this one.
    const merged = findHeaderBlock(rows, i);
    
    // DEBUG: Log what we found
    console.log('[OCR DEBUG] Header detected at row', i);
    console.log('[OCR DEBUG] Header tokens:', merged.tokens.map(t => t.text).join(' | '));
    
    if (isStrictHeader(merged.tokens, minScore)) {
      return { line: merged.tokens, index: i, rowsConsumed: merged.rowsConsumed };
    }
    if (isStrictHeader(rows[i], minScore)) {
      console.log('[OCR DEBUG] Using single-row header:', rows[i].map(t => t.text).join(' | '));
      return { line: rows[i], index: i, rowsConsumed: 1 };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Column classification & reconciliation                             */
/* ------------------------------------------------------------------ */

type Column = {
  text: string;
  x: number;
  w: number;
  kind: 'id' | 'name' | 'subject' | 'skip';
};

function classifyColumns(header: Token[]): Column[] {
  const merged = mergeHeaderTokens([...header].sort((a, b) => a.x - b.x));
  // Only tokens with length >= 2 (no stray single chars from OCR noise)
  const meaningful = merged.filter((h) => clean(h.text).length >= 2);
  return meaningful.map((h, i) => {
    const nextX =
      i + 1 < meaningful.length ? meaningful[i + 1].x : h.x + h.w + 200;
    const t = clean(h.text).toLowerCase();
    let kind: Column['kind'] = 'subject';
    // CRITICAL: Exclude row-index column ("No." or "No") before any other classification
    if (/^no\.?$/i.test(t) || /^#$/i.test(t) || /^s\/?n$/i.test(t)) kind = 'skip';
    else if (SKIP_HEADER.test(t)) kind = 'skip';
    else if (NAME_HEADER.test(t)) kind = 'name';
    else if (ID_HEADER.test(t)) kind = 'id';
    return { text: clean(h.text), x: h.x, w: nextX - h.x, kind };
  });
}

/** Canonical subject order used when OCR misses some column headers. */
const COMMON_SUBJECT_ORDER = [
  'English', 'Mathematics', 'Maths', 'Physics', 'Chemistry', 'Biology',
  'History', 'Geography', 'Computer', 'Computer Science', 'Kiswahili',
  'Agriculture', 'Business', 'Commerce', 'Accounting', 'CRE', 'IRE', 'Art',
  'Music', 'Physical Education', 'PE', 'Science', 'General Science',
  'Social Studies', 'Civics', 'French', 'German', 'Arabic', 'ICT',
  'Literature', 'Home Science', 'Life Skills',
];

/**
 * When Tesseract fails to OCR some subject-header cells, the detected subject
 * column count is less than the actual data column count. This function:
 * 1. Derives exact column x-positions from score token centres in data rows
 * 2. Matches detected subject names to those positions by proximity
 * 3. Fills gaps from COMMON_SUBJECT_ORDER when detected names form an ordered
 *    subsequence of it
 * 4. Falls back to numbered placeholders only as a last resort
 *
 * This ensures every score stays aligned to the correct subject column.
 */
function reconcileColumns(
  cols: Column[],
  dataRows: Token[][]
): { cols: Column[]; subjects: string[] } {
  const subjectCols = cols.filter((c) => c.kind === 'subject');
  if (!subjectCols.length) return { cols, subjects: [] };

  // Collect score-token x-centres from the widest data rows (most scores).
  let dataCentres: number[] = [];
  for (const row of dataRows.slice(0, 8)) {
    const scores = row.filter((t) => isScore(t.text)).sort((a, b) => a.x - b.x);
    if (scores.length > dataCentres.length) {
      dataCentres = scores.map((t) => t.x + t.w / 2);
    }
  }
  if (!dataCentres.length || dataCentres.length <= subjectCols.length) {
    // No reconciliation needed - detected headers match or exceed data columns
    return { cols, subjects: subjectCols.map((c) => clean(c.text)) };
  }

  const avgGap =
    dataCentres.length > 1
      ? (dataCentres[dataCentres.length - 1] - dataCentres[0]) / (dataCentres.length - 1)
      : 130;

  // Match each detected subject to the nearest data-column centre.
  // PRESERVE the original subject names by using them directly
  const names: string[] = new Array(dataCentres.length).fill('');
  const usedNames = new Set<string>();
  for (const sc of subjectCols) {
    const cx = sc.x + sc.w / 2;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < dataCentres.length; i++) {
      const d = Math.abs(cx - dataCentres[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const subjName = clean(sc.text);
    if (bestIdx >= 0 && bestDist < avgGap * 0.55 && !usedNames.has(subjName)) {
      names[bestIdx] = subjName;
      usedNames.add(subjName);
    }
  }

  // Fill gaps from COMMON_SUBJECT_ORDER when detected names are an ordered subsequence.
  const detected = names.map((n, i) => ({ n, i })).filter((x) => x.n !== '');
  const canonicalIdx = (n: string) =>
    COMMON_SUBJECT_ORDER.findIndex((c) => c.toLowerCase() === n.toLowerCase());

  if (detected.length >= 2) {
    let ordered = true;
    for (let d = 1; d < detected.length; d++) {
      if (canonicalIdx(detected[d].n) <= canonicalIdx(detected[d - 1].n)) {
        ordered = false;
        break;
      }
    }
    if (ordered) {
      for (let g = 0; g < detected.length; g++) {
        const loIdx = g === 0 ? -1 : canonicalIdx(detected[g - 1].n);
        const hiIdx = g === detected.length - 1
          ? COMMON_SUBJECT_ORDER.length
          : canonicalIdx(detected[g + 1].n);
        const gapStart = detected[g].i + 1;
        const gapEnd = g + 1 < detected.length ? detected[g + 1].i : names.length;
        let candidate = loIdx + 1;
        for (let di = gapStart; di < gapEnd; di++) {
          if (names[di] !== '') continue;
          while (candidate < hiIdx && usedNames.has(COMMON_SUBJECT_ORDER[candidate])) candidate++;
          if (candidate < hiIdx) {
            names[di] = COMMON_SUBJECT_ORDER[candidate];
            usedNames.add(names[di]);
            candidate++;
          }
        }
      }
    }
  }

  // Remaining gaps: use any unused detected subjects first, then numbered placeholders
  const unusedDetected = subjectCols
    .map(c => clean(c.text))
    .filter(name => !usedNames.has(name));
  
  let unusedIdx = 0;
  let placeholderNum = 1;
  const finalNames = names.map((nm) => {
    if (nm !== '') return nm;
    // First try to use an unused detected subject
    if (unusedIdx < unusedDetected.length) {
      const name = unusedDetected[unusedIdx++];
      usedNames.add(name);
      return name;
    }
    // Fall back to placeholder
    return `Subject ${placeholderNum++}`;
  });

  // Build aligned subject columns from data positions
  const colW = Math.max(50, avgGap * 0.85);
  const newSubjectCols: Column[] = dataCentres.map((cx, di) => ({
    text: finalNames[di],
    x: cx - colW / 2,
    w: colW,
    kind: 'subject' as const,
  }));
  const kept = cols.filter((c) => c.kind !== 'subject');
  const allCols = [...kept, ...newSubjectCols].sort((a, b) => a.x - b.x);

  const subjects = Array.from(new Set(finalNames)).filter(
    (s) => s && s.length >= 2 && /^[A-Za-z][A-Za-z &()'./-]*$/.test(s) &&
      !isNumeric(s) && !METADATA_WORD.test(s)
  );
  return { cols: allCols, subjects };
}

/* ------------------------------------------------------------------ */
/* Student-row parsing                                                 */
/* ------------------------------------------------------------------ */

/**
 * For a given column, find the token whose centre falls within the column's
 * x-span. When multiple tokens qualify, prefer the one closest to the column
 * centre. Returns null when no token lands in the span.
 */
function tokenForColumn(line: Token[], col: Column): Token | null {
  const lo = col.x;
  const hi = col.x + col.w;
  let best: Token | null = null;
  let bestDist = Infinity;
  for (const t of line) {
    const cx = t.x + t.w / 2;
    if (cx < lo || cx > hi) continue;
    const dist = Math.abs(cx - (col.x + col.w / 2));
    if (dist < bestDist) { bestDist = dist; best = t; }
  }
  return best;
}

/**
 * Confidence threshold for flagging a cell as uncertain.
 * Lowered from 60 to 45 so that clearly readable digits OCR'd at moderate
 * confidence are NOT flagged — only genuinely ambiguous tokens are amber.
 */
const CONF_THRESHOLD = 45;

function parseStudentRow(
  line: Token[],
  cols: Column[],
  subjects: string[]
): ScoreRow | null {
  if (
    line.some((t) => SKIP_HEADER.test(clean(t.text))) &&
    !line.some((t) => NAME_HEADER.test(clean(t.text)))
  ) {
    const hasID = line.some((t) => isID(t.text) && !isScore(t.text));
    const hasScore = line.some((t) => isScore(t.text));
    if (!hasID || !hasScore) return null;
  }

  // Prefer a dedicated Student-ID column over the row-number ("No.") column.
  const idCols = cols.filter((c) => c.kind === 'id');
  const idCol = idCols.find((c) => !/^no\.?$/i.test(c.text.trim())) || idCols[0];
  const nameCol = cols.find((c) => c.kind === 'name');
  const subjCols = cols.filter(
    (c) => c.kind === 'subject' && subjects.includes(c.text)
  );

  // Extract student ID with repair logic for split IDs
  let id = idCol ? tokenForColumn(line, idCol)?.text || '' : '';
  if (!id) {
    const lead = line.filter((t) => t.x <= (nameCol ? nameCol.x : line[0]?.x + 400)).slice(0, 3);
    const hit = lead.find((t) => isID(t.text) && !isScore(t.text));
    if (hit) id = hit.text;
  }
  id = id.trim();

  // Fix for ID-splitting bug: if ID looks incomplete (e.g., "GA25081" instead of "GA250811"),
  // check if the next token is a single digit that could complete it
  if (id && /^[A-Za-z]{1,6}\d{5,7}$/i.test(id)) {
    const idToken = line.find((t) => t.text.trim() === id);
    if (idToken) {
      const idX = idToken.x + idToken.w;
      // Look for a single-digit token immediately after the ID (within 30px)
      const nextToken = line.find(
        (t) => t.x >= idX && t.x - idX < 30 && /^\d$/.test(t.text.trim())
      );
      if (nextToken) {
        const candidateId = id + nextToken.text.trim();
        if (isID(candidateId)) {
          id = candidateId;
          // Mark this token as used so it doesn't leak into the name
          line = line.filter((t) => t !== nextToken);
        }
      }
    }
  }

  // Extract student name: all non-numeric, non-ID tokens before the first score column
  // Calculate name boundary more carefully to avoid cutting off names
  let nameHi: number;
  if (nameCol) {
    nameHi = nameCol.x + nameCol.w;
  } else if (subjCols.length > 0) {
    // Find the leftmost score token in this row to determine where names end
    const firstScoreToken = subjCols
      .map((col) => tokenForColumn(line, col))
      .filter((t): t is Token => t !== null)
      .sort((a, b) => a.x - b.x)[0];
    nameHi = firstScoreToken ? firstScoreToken.x : Infinity;
  } else {
    nameHi = Infinity;
  }

  const nameParts: string[] = [];
  for (const t of line) {
    if (t.x >= nameHi) break;
    if (t.text === id) continue;
    // Skip row-index numbers that might leak into name area
    if (isNumeric(t.text) && t.text.length <= 2 && parseInt(t.text) <= 100) continue;
    if (isScore(t.text)) continue;
    if (/^[-–—.:;,()\[\]{}]+$/.test(t.text)) continue;
    if (clean(t.text).length > 28) continue;
    nameParts.push(t.text);
  }
  // Drop leading single-char OCR junk (misread row numbers leaking into name)
  while (nameParts.length && nameParts[0].length <= 1) nameParts.shift();
  const name = nameParts.join(' ').trim();

  // Extract scores: strict positional mapping — each subject column gets
  // exactly the token whose centre falls in that column's x-span.
  const scores: Record<string, string> = {};
  const uncertain: string[] = [];
  const used = new Set<Token>();

  for (const col of subjCols) {
    const tok = tokenForColumn(line, col);
    if (tok && !used.has(tok)) {
      used.add(tok);
      const normalized = normalizeNumber(tok.text);
      if (isScore(tok.text) || isScore(normalized)) {
        const v = Number(normalized);
        const valid = v >= 0 && v <= 100;
        scores[col.text] = valid ? String(Math.round(v * 100) / 100) : '';
        // Only flag uncertain when confidence is genuinely low AND the raw
        // token needed heavy normalization (not just a clean read)
        if (tok.conf < CONF_THRESHOLD && tok.text !== normalized) {
          uncertain.push(col.text);
        }
        if (!valid) uncertain.push(col.text);
      } else {
        scores[col.text] = '';
        uncertain.push(col.text);
      }
    } else {
      scores[col.text] = '';
      uncertain.push(col.text);
    }
  }

  const anyScore = subjCols.some((c) => scores[c.text] !== '');
  if (!name && !id && !anyScore) return null;
  if (!name && !id && line.every((t) => isNumeric(t.text)) && line.length < 3) return null;

  const row: ScoreRow = {
    id: id || '',
    name,
    scores,
    uncertain: uncertain.length ? Array.from(new Set(uncertain)) : undefined,
  };
  if (!name) {
    row.uncertain = row.uncertain || [];
    if (!row.uncertain.includes('name')) row.uncertain.push('name');
  }
  return row;
}

/**
 * A row qualifies as a student when it passes at least one of:
 * - a valid Student ID
 * - a name that looks like real words (≥ 3 letters, ≥60% alphabetic)
 * - at least half of its subject scores are valid numbers 0-100
 */
function isPlausibleStudent(row: ScoreRow, subjects: string[]): boolean {
  const idOk = !!row.id.trim() && isID(row.id.trim());
  const name = row.name.trim();
  const letters = (name.match(/[A-Za-z]/g) || []).length;
  const alnum = (name.match(/[A-Za-z0-9]/g) || []).length;
  const words = name.split(/\s+/).filter(Boolean);
  const wordsLongEnough =
    words.length >= 2 ? words.every((w) => w.length >= 2) : name.length >= 3;
  const nameOk =
    letters >= 3 &&
    letters / Math.max(1, name.length) >= 0.55 &&
    letters / Math.max(1, alnum) >= 0.75 &&
    wordsLongEnough;
  let validScores = 0;
  const scoreValues: number[] = [];
  for (const s of subjects) {
    const raw = row.scores[s];
    const v = raw === '' || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 100) { validScores++; scoreValues.push(v); }
  }
  const halfOk = subjects.length > 0 && validScores >= Math.ceil(subjects.length / 2);
  // Reject rows where ALL non-empty scores are identical unless ID is valid
  const allSame =
    scoreValues.length >= 2 && scoreValues.every((v) => v === scoreValues[0]);
  if (!idOk && allSame) return false;
  return idOk || nameOk || halfOk;
}

/**
 * Attempt to reconstruct truncated student IDs when IDs follow a sequential
 * pattern (e.g. GA250801, GA250802, … GA250815).
 */
function reconstructIds(students: ScoreRow[]): void {
  if (students.length < 3) return;
  const lengths = new Map<number, number>();
  for (const s of students) {
    const id = s.id.trim();
    if (!isID(id)) continue;
    lengths.set(id.length, (lengths.get(id.length) || 0) + 1);
  }
  if (!lengths.size) return;
  let domLen = 0, domCount = 0;
  lengths.forEach((count, len) => {
    if (count > domCount) { domCount = count; domLen = len; }
  });
  const validIds = students.map((s, i) => ({ s, i })).filter(({ s }) => isID(s.id.trim()));
  const suffixNums = validIds
    .map(({ s }) => s.id.trim().match(/\d+$/)?.[0] || '')
    .filter((n) => /^\d+$/.test(n)).map(Number);
  const isSequential =
    suffixNums.length >= 3 &&
    suffixNums.every((n, idx) => idx === 0 || n === suffixNums[idx - 1] + 1);
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const id = s.id.trim();
    if (isID(id)) continue;
    if (id.length !== domLen - 1) continue;
    const prefix = validIds[0]?.s.id.trim().slice(0, domLen - 1) || '';
    if (!prefix || !id.startsWith(prefix.slice(0, -1))) continue;
    if (isSequential) {
      const want = String(i + 1);
      const lastDigit = want[want.length - 1];
      const candidate = id + lastDigit;
      if (isID(candidate) && !students.some((o) => o.id === candidate)) {
        s.id = candidate;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Table builder                                                       */
/* ------------------------------------------------------------------ */

const SUMMARY_WORDS =
  /highest|lowest|class\s*average|pass\s*(rate|percentage)|grading|scale|signature|principal|head\s*teacher|class\s*teacher|invigilator|prepared|checked|approved|authorized|number\s*of\s*students|total\s*students|grand\s*total|^total\b|summary|motto|slogan|remarks?|mean\s*score|average\s*score|highest\s*score|lowest\s*score/i;
const SCALE_RANGE = /^\d{1,3}\s*[-–—]\s*\d{1,3}$/;
const LETTER_GRADE = /^[A-D][+-]?$/;

function buildTable(
  tokens: Token[],
  opts?: { lenient?: boolean }
): { subjects: string[]; rows: ScoreRow[] } | null {
  const expanded = expandTokens(tokens);
  if (!expanded.length) return null;
  const rows = clusterRows(expanded);
  const header = findStrictHeader(rows, opts?.lenient ? 3 : 5);
  if (!header) return null;

  const headerLine = header.line;
  const cols = classifyColumns(headerLine);
  
  // DEBUG: Log classified columns
  console.log('[OCR DEBUG] Classified columns:', cols.map(c => `${c.text}(${c.kind})`).join(' | '));
  
  // Extract subject names from columns, applying correction AFTER classification
  let subjects = Array.from(
    new Set(
      cols
        .filter((c) => c.kind === 'subject')
        .map((c) => {
          const cleaned = clean(c.text);
          // Only apply correctSubjectName if the text looks like it could be a subject
          if (fuzzySubject(cleaned) || /^[A-Za-z]{3,20}$/i.test(cleaned)) {
            const corrected = correctSubjectName(cleaned);
            console.log('[OCR DEBUG] Subject correction:', cleaned, '->', corrected);
            return corrected;
          }
          return cleaned;
        })
    )
  ).filter(
    (s) => s && s.length >= 2 && /^[A-Za-z][A-Za-z &()'./-]*$/.test(s) &&
      !isNumeric(s) && !METADATA_WORD.test(s)
  );
  
  console.log('[OCR DEBUG] Final detected subjects:', subjects);
  
  if (!subjects.length) return null;

  // Collect data rows (rows after the header that contain scores)
  // CRITICAL: Skip rows consumed by header merge to prevent row offset bug
  const dataRowsAfterHeader = rows.slice(header.index + header.rowsConsumed).filter(
    (r) => r.some((t) => isScore(t.text)) &&
      (r.some((t) => isID(t.text) && !isScore(t.text)) ||
       r.some((t) => /^[A-Za-z]{2,}/.test(t.text)))
  );

  let finalCols = cols;
  let finalSubjects = subjects;

  // Reconcile: if data rows consistently have more score columns than
  // detected header subjects, rebuild column alignment from data positions.
  if (dataRowsAfterHeader.length >= 1) {
    const maxDataCols = Math.max(
      ...dataRowsAfterHeader.map((r) => r.filter((t) => isScore(t.text)).length)
    );
    console.log('[OCR DEBUG] maxDataCols:', maxDataCols, 'detected subjects:', subjects.length);
    if (maxDataCols > subjects.length) {
      console.log('[OCR DEBUG] Calling reconcileColumns - data has more columns than detected headers');
      const reconciled = reconcileColumns(cols, dataRowsAfterHeader);
      console.log('[OCR DEBUG] After reconciliation, subjects:', reconciled.subjects);
      finalCols = reconciled.cols;
      finalSubjects = reconciled.subjects;
    }
  }

  const students: ScoreRow[] = [];
  let started = false;

  // CRITICAL: Start from header.index + header.rowsConsumed to skip all header rows
  for (let i = header.index + header.rowsConsumed; i < rows.length; i++) {
    const line = rows[i];
    const joined = line.map((t) => t.text).join(' ');
    const scoreCount = line.filter((t) => isScore(t.text)).length;
    const numericOnly = line.length >= 2 && line.every((t) => isNumeric(t.text));

    // Stray year-only lines are metadata
    if (/20\d\d/.test(joined) && line.length <= 2) {
      if (started) break;
      continue;
    }

    // Numbers-only line: either a continuation of the previous student's row
    // (OCR split across lines) or a footer/total row — handle both.
    if (numericOnly) {
      const prev = students[students.length - 1];
      if (prev && finalSubjects.every((s) => !prev.scores[s])) {
        finalSubjects.forEach((s, idx) => {
          const t = line[idx];
          const v = t ? Number(normalizeNumber(t.text)) : NaN;
          prev.scores[s] = !Number.isNaN(v) && v >= 0 && v <= 100 ? String(v) : '';
          if (t && t.conf < CONF_THRESHOLD && t.text !== normalizeNumber(t.text)) {
            prev.uncertain = prev.uncertain || [];
            if (!prev.uncertain.includes(s)) prev.uncertain.push(s);
          }
        });
        continue;
      }
      if (started) break;
      continue;
    }

    // Summary / grading-scale / signature lines end the table
    if (
      SUMMARY_WORDS.test(joined) ||
      line.some((t) => SCALE_RANGE.test(t.text)) ||
      (line.some((t) => LETTER_GRADE.test(t.text)) && scoreCount === 0)
    ) {
      if (started) break;
      continue;
    }

    // Text-only footer lines end the table
    if (scoreCount === 0 && !line.some((t) => isID(t.text))) {
      const next = rows[i + 1];
      const nextIsNumbers = !!next && next.length >= 2 && next.every((t) => isNumeric(t.text));
      if (started || !nextIsNumbers) {
        if (started) break;
        continue;
      }
    }

    const parsed = parseStudentRow(line, finalCols, finalSubjects);
    if (parsed) {
      if (isPlausibleStudent(parsed, finalSubjects)) {
        students.push(parsed);
        started = true;
      }
    } else {
      if (started) break;
    }
  }

  if (!students.length) return null;
  reconstructIds(students);
  return { subjects: finalSubjects, rows: students };
}

/* ------------------------------------------------------------------ */
/* Salvage: never reject a readable file                              */
/* ------------------------------------------------------------------ */

function salvageFromTokens(tokens: Token[], note?: string): Extracted | null {
  if (!tokens.length) return null;
  // Try lenient structured detection first
  const built = buildTable(tokens, { lenient: true });
  if (built) {
    return {
      ...built,
      note: note || 'Table header detected with lower confidence — verify subject names.',
    };
  }
  // Pattern-based fallback: lines with ID + 2+ scores, no metadata words
  const rows = clusterRows(tokens);
  const candidates: { line: Token[]; idx: number }[] = [];
  rows.forEach((line, idx) => {
    const joined = line.map((t) => t.text).join(' ');
    if (SUMMARY_WORDS.test(joined) || METADATA_WORD.test(joined)) return;
    if (/20\d\d/.test(joined) && line.length <= 3) return;
    if (line.filter((t) => isScore(t.text)).length < 2) return;
    if (!line.some((t) => isID(t.text) && !isScore(t.text))) return;
    candidates.push({ line, idx });
  });
  // Keep the longest contiguous block (gap ≤ 1)
  let best: typeof candidates = [], cur: typeof candidates = [];
  for (let i = 0; i < candidates.length; i++) {
    if (cur.length && candidates[i].idx - cur[cur.length - 1].idx > 1) {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
    cur.push(candidates[i]);
  }
  if (cur.length > best.length) best = cur;
  if (best.length < 2) return null;

  const dataLines = best.map((c) => c.line);
  const scoreRows = dataLines.map((line) =>
    line.filter((t) => isScore(t.text)).sort((a, b) => a.x - b.x)
  );
  const uniform = scoreRows.every((r) => r.length === scoreRows[0].length);
  let scoreCols: { x: number; values: (Token | null)[] }[];
  if (uniform) {
    scoreCols = scoreRows[0].map((t) => ({ x: t.x + t.w / 2, values: [t] }));
    for (let r = 1; r < scoreRows.length; r++) {
      scoreRows[r].forEach((t, i) => scoreCols[i].values.push(t));
    }
  } else {
    const widest = [...scoreRows].sort((a, b) => b.length - a.length)[0];
    scoreCols = widest.map((t) => ({ x: t.x + t.w / 2, values: [t] }));
    for (const line of scoreRows) {
      if (line === widest) continue;
      const used = new Set<number>();
      for (const s of line) {
        const cx = s.x + s.w / 2;
        let bi = -1, bd = Infinity;
        for (let i = 0; i < scoreCols.length; i++) {
          if (used.has(i)) continue;
          const d = Math.abs(cx - scoreCols[i].x);
          if (d < bd) { bd = d; bi = i; }
        }
        if (bi >= 0 && bd <= 70) { scoreCols[bi].values.push(s); used.add(bi); }
        else scoreCols.push({ x: cx, values: [s] });
      }
      scoreCols.forEach((c, i) => { if (!used.has(i)) c.values.push(null); });
    }
    scoreCols.sort((a, b) => a.x - b.x);
  }
  if (scoreCols.length < 2) return null;

  // Drop trailing non-subject columns (Total / Average / Rank)
  while (scoreCols.length > 1) {
    const last = scoreCols[scoreCols.length - 1];
    const vals = last.values.filter((v): v is Token => !!v)
      .map((v) => Number(normalizeNumber(v.text)));
    if (vals.length < Math.ceil(dataLines.length / 2)) break;
    const rankLike = vals.every((v) => Number.isInteger(v) && v >= 1 && v <= dataLines.length);
    const allDec = vals.every((v) => !Number.isInteger(v));
    const allHigh = vals.every((v) => v > 100);
    if (rankLike || allDec || allHigh) { scoreCols.pop(); continue; }
    break;
  }
  if (scoreCols.length < 2) return null;

  // Try to infer subject names from any header-like tokens above the data
  const allRows = clusterRows(tokens);
  const dataStart = candidates.length > 0 ? candidates[0].idx : 0;
  const potentialHeaders = allRows.slice(Math.max(0, dataStart - 5), dataStart);
  const headerWords: string[] = [];
  
  for (const hrow of potentialHeaders) {
    for (const tok of hrow) {
      const cleaned = clean(tok.text);
      if (cleaned.length >= 3 && fuzzySubject(cleaned)) {
        const corrected = correctSubjectName(cleaned);
        if (!headerWords.includes(corrected)) {
          headerWords.push(corrected);
        }
      }
    }
  }
  
  // Match header words to score columns by x-position proximity
  const subjects: string[] = Array.from({ length: scoreCols.length }, (_, i) => `Subject ${i + 1}`);
  if (headerWords.length > 0) {
    for (let i = 0; i < Math.min(headerWords.length, scoreCols.length); i++) {
      const hw = headerWords[i];
      // Find closest score column
      let bestDist = Infinity, bestIdx = -1;
      for (let j = 0; j < scoreCols.length; j++) {
        if (subjects[j] !== `Subject ${j + 1}`) continue; // already assigned
        const dist = Math.abs(scoreCols[j].x - 100); // rough heuristic
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        subjects[bestIdx] = hw;
      }
    }
  }

  const students: ScoreRow[] = [];
  dataLines.forEach((line, ri) => {
    const nums = line.filter((t) => isScore(t.text)).sort((a, b) => a.x - b.x);
    const idHit = line.find((t) => isID(t.text) && !isScore(t.text));
    const firstScoreX = nums[0] ? nums[0].x : Infinity;
    const nameTokens = line.filter(
      (t) => t !== idHit && !isScore(t.text) && !isID(t.text) &&
        !/\d/.test(t.text) && !/^[A-D][+-]?$/.test(t.text) &&
        !NOISE_TOKEN.test(t.text) && !SUMMARY_WORDS.test(t.text) &&
        !METADATA_WORD.test(t.text) && t.x + t.w / 2 < firstScoreX
    );
    const name = nameTokens.map((t) => t.text).join(' ').trim();
    if (!name && !idHit) return;
    const scores: Record<string, string> = {};
    const uncertain: string[] = [];
    if (!name || nameTokens.some((t) => t.conf < CONF_THRESHOLD)) uncertain.push('name');
    if (!idHit || idHit.conf < CONF_THRESHOLD) uncertain.push('id');
    scoreCols.forEach((col, ci) => {
      const t = col.values[ri];
      const v = t ? Number(normalizeNumber(t.text)) : NaN;
      scores[subjects[ci]] = !Number.isNaN(v) && v >= 0 && v <= 100 ? String(v) : '';
      if (!t || (t.conf < CONF_THRESHOLD && t.text !== normalizeNumber(t.text))) {
        uncertain.push(subjects[ci]);
      }
    });
    const student: ScoreRow = { id: idHit?.text || '', name, scores, uncertain: Array.from(new Set(uncertain)) };
    if (isPlausibleStudent(student, subjects)) students.push(student);
  });
  if (!students.length) return null;
  reconstructIds(students);
  return {
    subjects,
    rows: students,
    note: note || 'Subject headers could not be read — subjects labelled Subject 1–N. Rename them before processing.',
  };
}

/* ------------------------------------------------------------------ */
/* Text / structured formats                                           */
/* ------------------------------------------------------------------ */

function fromText(text: string): Extracted {
  const lines = text.replace(/\r/g, '').split('\n');
  const tokens: Token[] = [];
  lines.forEach((raw, li) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.includes('\t')
      ? line.split('\t')
      : line.split(/\s{2,}|,\s*/);
    let x = 0;
    for (const c of cells) {
      const t = clean(stripToken(c));
      if (!t || NOISE_TOKEN.test(t)) continue;
      tokens.push({ text: t, x, y: li * 40, w: t.length * 8, h: 20, conf: 100 });
      x += t.length * 8 + 40;
    }
  });
  const built = buildTable(tokens);
  if (built) return built;
  return salvageFromTokens(tokens) || { subjects: [], rows: [] };
}

async function fromCSV(text: string): Promise<Extracted> {
  return fromText(text);
}

/**
 * XLSX structured extraction — bypasses the OCR/token-clustering pipeline
 * entirely, since spreadsheet data has perfect column alignment by definition.
 *
 * Key behaviours:
 * - Uses sheet_to_json with header:1 to get raw 2-D arrays, preserving exact
 *   column order and cell values without any text-length-based x-position math.
 * - Identifies the header row as the first row that contains at least one
 *   recognisable subject name (using fuzzySubject / SKIP_HEADER vocabulary).
 * - Skips the row-index ("No.") column and any summary columns (Total, Avg…).
 * - Deduplicates subject names: if both "Mathematics" and "Maths" appear,
 *   the second occurrence is removed (first wins).
 * - Maps each data row's cells directly to the header columns by index,
 *   not by synthetic pixel positions — so scores are always correctly aligned.
 */
async function fromXLSX(buffer: ArrayBuffer): Promise<Extracted> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(buffer, { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  // header:1 → array of row arrays; defval:'' → empty cells become '' not undefined
  const rows2d: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  if (!rows2d.length) return { subjects: [], rows: [] };

  // ── 1. Find the header row ────────────────────────────────────────────────
  // It must contain at least one recognised subject name and at least one
  // ID/Name column keyword. We scan top-down and stop at the first match.
  let headerRowIdx = -1;
  let headerRow: string[] = [];

  for (let ri = 0; ri < Math.min(rows2d.length, 10); ri++) {
    const cells = rows2d[ri].map((c) => String(c ?? '').trim());
    const subjectCount = cells.filter((c) => fuzzySubject(c)).length;
    const hasIdOrName = cells.some(
      (c) => ID_HEADER.test(c) || NAME_HEADER.test(c) || /^no\.?$/i.test(c)
    );
    if (subjectCount >= 1 && (hasIdOrName || subjectCount >= 3)) {
      headerRowIdx = ri;
      headerRow = cells;
      break;
    }
  }

  // Fallback: if no perfect header found, try the first row with ≥3 non-empty cells
  if (headerRowIdx === -1) {
    for (let ri = 0; ri < Math.min(rows2d.length, 5); ri++) {
      const cells = rows2d[ri].map((c) => String(c ?? '').trim()).filter(Boolean);
      if (cells.length >= 3) {
        headerRowIdx = ri;
        headerRow = rows2d[ri].map((c) => String(c ?? '').trim());
        break;
      }
    }
  }

  if (headerRowIdx === -1) {
    // Last resort: fall through to the text-based pipeline
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return fromText(csv);
  }

  // ── 2. Classify header columns ───────────────────────────────────────────
  type ColKind = 'id' | 'name' | 'subject' | 'skip';
  interface ColDef { idx: number; raw: string; label: string; kind: ColKind }

  const seenSubjectKeys = new Set<string>(); // for dedup by normalised name
  const cols: ColDef[] = headerRow.map((raw, idx) => {
    const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    let kind: ColKind = 'skip';

    if (!t) {
      // empty header cell — skip
    } else if (/^no\.?$/i.test(t) || /^#$/i.test(t) || /^s\/?n$/i.test(t)) {
      kind = 'skip'; // row-index column
    } else if (SKIP_HEADER.test(t)) {
      kind = 'skip'; // Total, Average, Rank, etc.
    } else if (NAME_HEADER.test(t)) {
      kind = 'name';
    } else if (ID_HEADER.test(t)) {
      kind = 'id';
    } else if (fuzzySubject(raw) || /^[A-Za-z][A-Za-z ]{2,}$/.test(raw)) {
      // Apply the same subject-name correction used in the OCR pipeline
      const corrected = fuzzySubject(raw)
        ? correctSubjectName(raw)
        : toTitleCase(raw.trim());
      // Deduplicate: "Mathematics" and "Maths" both normalise differently so
      // we use a lowercased key that collapses known aliases
      const key = corrected.toLowerCase().replace(/\bmaths\b/, 'mathematics');
      if (!seenSubjectKeys.has(key)) {
        seenSubjectKeys.add(key);
        return { idx, raw, label: corrected, kind: 'subject' };
      }
      // duplicate — skip
    }
    // For non-subject non-id/name words that aren't clearly metadata, keep as skip
    return { idx, raw, label: raw, kind };
  });

  const idCol   = cols.find((c) => c.kind === 'id');
  const nameCol = cols.find((c) => c.kind === 'name');
  const subjCols = cols.filter((c) => c.kind === 'subject');

  if (!subjCols.length) {
    // Could not identify any subject columns — fall back to text pipeline
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return fromText(csv);
  }

  const subjects = subjCols.map((c) => c.label);

  // ── 3. Parse data rows ────────────────────────────────────────────────────
  const students: ScoreRow[] = [];

  for (let ri = headerRowIdx + 1; ri < rows2d.length; ri++) {
    const cells = rows2d[ri].map((c) => String(c ?? '').trim());

    // Skip completely empty rows
    if (cells.every((c) => !c)) continue;

    // Skip summary/footer rows (e.g. "Total", "Average", grading scale lines)
    const joined = cells.join(' ');
    if (SUMMARY_WORDS.test(joined) && !cells.some((c) => isID(c))) continue;
    // Stop if we hit a row that is entirely non-numeric non-name words after
    // data has started (e.g. a grading key section below the table)
    if (
      students.length > 0 &&
      cells.filter(Boolean).length >= 2 &&
      cells.every((c) => !c || /^[A-Za-z\s.,;:-]{4,}$/.test(c)) &&
      !cells.some((c) => isID(c) || isScore(c))
    ) break;

    // Extract ID and Name
    let id = idCol ? cells[idCol.idx] : '';
    let name = nameCol ? cells[nameCol.idx] : '';

    // If no dedicated id/name columns found, try to infer from the first
    // few cells using the same heuristics as the OCR parser
    if (!idCol && !nameCol) {
      for (let ci = 0; ci < Math.min(cells.length, 4); ci++) {
        const c = cells[ci];
        if (!id && isID(c) && !isScore(c)) { id = c; continue; }
        if (!name && !isScore(c) && /^[A-Za-z]{2,}/.test(c) && !isID(c)) {
          name = c; continue;
        }
      }
    } else if (!idCol) {
      // Only name column detected — try to find ID from leading cells
      for (let ci = 0; ci < Math.min(cells.length, 4); ci++) {
        const c = cells[ci];
        if (nameCol && ci === nameCol.idx) continue;
        if (!id && isID(c) && !isScore(c)) { id = c; break; }
      }
    } else if (!nameCol) {
      // Only id column detected — collect name tokens before first subject column
      const firstSubjIdx = subjCols[0]?.idx ?? cells.length;
      const nameParts: string[] = [];
      for (let ci = 0; ci < firstSubjIdx; ci++) {
        if (ci === idCol.idx) continue;
        const c = cells[ci];
        if (!c || isScore(c) || isID(c)) continue;
        if (/^[A-Za-z]/.test(c)) nameParts.push(c);
      }
      name = nameParts.join(' ').trim();
    }

    // Skip rows with no name AND no id AND no scores
    const hasAnyScore = subjCols.some((sc) => isScore(cells[sc.idx]));
    if (!id && !name && !hasAnyScore) continue;

    // Extract scores — direct index mapping, zero ambiguity
    const scores: Record<string, string> = {};
    const uncertain: string[] = [];

    for (const sc of subjCols) {
      const raw = cells[sc.idx];
      if (raw === '' || raw === undefined) {
        scores[sc.label] = '';
        uncertain.push(sc.label);
      } else {
        const normalized = normalizeNumber(raw);
        const v = Number(normalized);
        if (isScore(raw) || (isScore(normalized) && v >= 0 && v <= 100)) {
          scores[sc.label] = String(Math.round(v * 100) / 100);
        } else {
          scores[sc.label] = '';
          uncertain.push(sc.label);
        }
      }
    }

    const row: ScoreRow = {
      id: id || '',
      name: name || '',
      scores,
      uncertain: uncertain.length ? Array.from(new Set(uncertain)) : undefined,
    };
    if (!name) {
      row.uncertain = row.uncertain || [];
      if (!row.uncertain.includes('name')) row.uncertain.push('name');
    }

    if (isPlausibleStudent(row, subjects)) students.push(row);
  }

  if (!students.length) {
    // Nothing came out of the structured path — fall back to text pipeline
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return fromText(csv);
  }

  reconstructIds(students);

  return {
    subjects,
    rows: students,
    note: students.some((r) => r.uncertain?.length)
      ? 'Some values could not be read with certainty — check the highlighted cells.'
      : undefined,
  };
}

async function fromDOCX(buffer: ArrayBuffer): Promise<Extracted> {
  const mammoth = await import('mammoth');
  
  // First: Try Gemini with extracted text (for real digital tables)
  try {
    console.log('[Extraction] Extracting text from DOCX for Gemini API');
    const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
    
    if (value && value.trim().length > 50) {
      console.log('[Extraction] DOCX text extracted, length:', value.length);
      console.log('[Extraction] Sending DOCX text to Gemini API');
      
      const geminiResult = await extractTextWithGemini(value);
      
      // If Gemini succeeded with good data, return it
      if (geminiResult.rows.length >= 2 && geminiResult.subjects.length >= 2) {
        console.log('[Extraction] Gemini text extraction successful:', {
          rows: geminiResult.rows.length,
          subjects: geminiResult.subjects.length
        });
        return geminiResult;
      }
      
      console.log('[Extraction] DOCX text extraction produced poor results:', {
        rows: geminiResult.rows.length,
        subjects: geminiResult.subjects.length
      });
    }
  } catch (error: any) {
    console.log('[Extraction] Gemini text extraction failed:', error.message);
    // Continue to image extraction fallback
  }
  
  // Second: Try extracting embedded images and send to Gemini (for scanned/pasted images)
  try {
    console.log('[Extraction] Attempting to extract images from DOCX for Gemini API');
      
      // Store extracted images
      const extractedImages: Array<{ buffer: string; contentType: string }> = [];
      
      // Extract images using mammoth with a custom converter
      const result = await mammoth.convertToHtml(
        { arrayBuffer: buffer },
        {
          convertImage: mammoth.images.imgElement(function(image: any) {
            // Return a promise that reads the image as base64
            return image.read('base64').then(function(imageBuffer: string) {
              // Store the image data
              const contentType = image.contentType || 'image/png';
              extractedImages.push({
                buffer: imageBuffer,
                contentType: contentType
              });
              // Return a data URL for the HTML
              return {
                src: `data:${contentType};base64,${imageBuffer}`
              };
            });
          })
        }
      );
      
      console.log(`[Extraction] Found ${extractedImages.length} image(s) in DOCX`);
      
      if (extractedImages.length > 0) {
        // Try each image with Gemini (usually the first one contains the table)
        for (let i = 0; i < extractedImages.length; i++) {
          const imgData = extractedImages[i];
          
          try {
            // Convert base64 to binary
            const binaryString = atob(imgData.buffer);
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            
            // Convert to File object
            const blob = new Blob([bytes], { type: imgData.contentType });
            const imageFile = new File([blob], `embedded-image-${i}.png`, { type: imgData.contentType });
            
            console.log(`[Extraction] Sending DOCX image ${i + 1}/${extractedImages.length} to Gemini API (size: ${bytes.length} bytes)`);
            const geminiResult = await extractWithGemini(imageFile);
            
            // If Gemini succeeded with good data, return the result
            if (geminiResult.rows.length >= 2 && geminiResult.subjects.length >= 2) {
              console.log('[Extraction] Gemini successfully extracted table from DOCX image');
              return geminiResult;
            }
            console.log(`[Extraction] DOCX image ${i + 1} produced insufficient results:`, {
              rows: geminiResult.rows.length,
              subjects: geminiResult.subjects.length
            });
          } catch (imageError: any) {
            console.log(`[Extraction] Gemini failed for DOCX image ${i + 1}:`, imageError.message);
            continue; // Try next image
          }
        }
      } else {
        console.log('[Extraction] No images found in DOCX file');
      }
    } catch (error: any) {
      console.error('[Extraction] DOCX image extraction error:', error);
      // Fall through to final fallback
    }
  
  // Final fallback: Use structured text extraction (without OCR heuristics)
  console.log('[Extraction] Using DOCX text extraction fallback');
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  
  // For DOCX, we want to use a simpler text parsing that doesn't run through
  // the OCR correction pipeline (which was designed for noisy scanned images)
  return fromText(value);
}

async function fromDOC(buffer: ArrayBuffer): Promise<Extracted> {
  try {
    const res = await fromDOCX(buffer);
    if (res.rows.length || res.subjects.length) return res;
  } catch { /* not a docx */ }
  const bytes = new Uint8Array(buffer);
  const decode = (enc: 'utf16le' | 'latin1') => {
    let out = '';
    if (enc === 'utf16le') {
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = bytes[i] | (bytes[i + 1] << 8);
        if (code === 0) continue;
        out += String.fromCharCode(code);
      }
    } else {
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    }
    return out.replace(/[^\x20-\x7E\n\r\t]/g, '\n')
      .split('\n').map((l) => l.trim()).filter((l) => l.length >= 2).join('\n');
  };
  const text = decode('utf16le').length > decode('latin1').length * 2
    ? decode('utf16le') : decode('latin1');
  const res = fromText(text);
  if (res.rows.length || res.subjects.length) return res;
  throw new Error('This legacy DOC file could not be read. Please convert to DOCX or PDF and upload again.');
}

/* ------------------------------------------------------------------ */
/* Image pre-processing & OCR                                         */
/* ------------------------------------------------------------------ */

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image file.')); };
    img.src = url;
  });
}

/**
 * Pre-process an image for better OCR accuracy:
 * 1. Upscale small images to at least 1800px wide
 * 2. Convert to grayscale
 * 3. Stretch contrast (normalize histogram)
 * 4. Apply mild unsharp mask to sharpen text edges
 */
async function preprocess(file: File): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  let w = img.naturalWidth || 1200;
  let h = img.naturalHeight || 900;
  // Target width 1800px for OCR — upscale small images, cap huge ones at 3000px
  const target = 1800;
  const scale = w < target ? target / w : w > 3000 ? 3000 / w : 1;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  try {
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const d = imgData.data;
    // Grayscale + contrast stretch
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = lum;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.min(255, Math.max(0, ((d[i] - min) / range) * 255));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
  } catch { /* keep plain scaled image */ }
  return canvas;
}

let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, { logger: () => {} });
      return worker;
    })();
  }
  return workerPromise;
}

async function runOcr(worker: any, canvas: HTMLCanvasElement, psm: string) {
  if (worker.setParameters) {
    try { await worker.setParameters({ tessedit_pageseg_mode: psm }); } catch { /* ignore */ }
  }
  return worker.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true });
}

function wordsFromData(data: any): { tokens: Token[]; text: string } {
  const tokens: Token[] = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          const text = clean(stripToken(word.text));
          if (!text || NOISE_TOKEN.test(text)) continue;
          tokens.push({
            text,
            x: word.bbox.x0,
            y: word.bbox.y0,
            w: word.bbox.x1 - word.bbox.x0,
            h: word.bbox.y1 - word.bbox.y0,
            conf: word.confidence,
          });
        }
      }
    }
  }
  return { tokens, text: data.text || '' };
}

/**
 * Run multiple OCR passes with different page-segmentation modes and
 * merge results. This dramatically reduces missed tokens on tables where
 * Tesseract's default auto-mode struggles with dense column layouts.
 */
async function ocrTokens(canvas: HTMLCanvasElement): Promise<{ tokens: Token[]; text: string }> {
  const worker = await getWorker();
  // PSM 6 = assume uniform block of text (good for clean printed tables)
  // PSM 4 = assume a single column of text (good for narrow scanned sheets)
  // PSM 11 = sparse text (good for mixed-layout pages)
  const passes: string[] = ['6', '3', '11'];
  let best = { tokens: [] as Token[], text: '' };
  for (const psm of passes) {
    try {
      const result = wordsFromData((await runOcr(worker, canvas, psm)).data);
      if (result.tokens.length > best.tokens.length) best = result;
      // If the first pass found plenty of tokens, skip additional passes
      if (best.tokens.length >= 50) break;
    } catch { /* keep best so far */ }
  }
  return best;
}

async function fromImage(file: File): Promise<Extracted> {
  // Try Gemini API via server
  try {
    console.log('[Extraction] Using Gemini API for image extraction');
    return await extractWithGemini(file);
  } catch (error: any) {
    console.error('[Extraction] Gemini API failed:', error.message);
    // Fallback to OCR
    console.log('[Extraction] Falling back to Tesseract OCR');
  }
  
  // Fallback to traditional OCR pipeline
  const canvas = await preprocess(file);
  const { tokens, text } = await ocrTokens(canvas);
  const built = buildTable(tokens);
  if (built) return built;
  const salvaged = salvageFromTokens(tokens);
  if (salvaged) return salvaged;
  // Last resort: surface raw OCR lines for manual correction
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    subjects: [],
    rows: lines.map((l) => ({ id: '', name: l.slice(0, 80), scores: {}, uncertain: ['name'] })),
    note: 'OCR produced no clear table — the raw text is shown for manual correction.',
  };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

async function renderPageToCanvas(page: any): Promise<HTMLCanvasElement | null> {
  try {
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } catch { return null; }
}

async function fromPDF(buffer: ArrayBuffer): Promise<Extracted> {
  // Try Gemini API via server
  try {
    console.log('[Extraction] Using Gemini API for PDF extraction');
    // Convert ArrayBuffer to File object for Gemini
    const blob = new Blob([buffer], { type: 'application/pdf' });
    const pdfFile = new File([blob], 'document.pdf', { type: 'application/pdf' });
    return await extractWithGemini(pdfFile);
  } catch (error: any) {
    console.error('[Extraction] Gemini PDF extraction failed:', error.message);
    // Fallback to text extraction + OCR
    console.log('[Extraction] Falling back to PDF text extraction + OCR');
  }
  
  // Fallback: traditional PDF text extraction
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Fix: configure the worker src so PDF.js can spin up its worker thread.
  // Without this the browser throws "No GlobalWorkerOptions.workerSrc specified".
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/pdf.worker.min.mjs`;
  }

  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const allTokens: Token[] = [];
  const rawLines: string[] = [];

  for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const content = await page.getTextContent();
    const items = (content.items || []) as any[];
    const pageTokens: Token[] = [];

    for (const it of items) {
      const str = clean(stripToken(it.str));
      if (!str || NOISE_TOKEN.test(str)) continue;
      const tr = it.transform as number[];
      // PDF coordinate system has y=0 at the BOTTOM of the page.
      // Flip y so that top-of-page items have lower y values — this makes
      // clusterRows() work correctly (it sorts ascending by y).
      const x = tr[4];
      const yPdf = tr[5];
      const h = Math.abs(it.height) || 12;
      const yFlipped = pageHeight - yPdf - h;
      pageTokens.push({
        text: str,
        x,
        y: yFlipped,
        w: it.width || str.length * 8,
        h,
        conf: 100,
      });
    }

    if (pageTokens.length) {
      // Strip "(100)" / "(50)" sub-header lines that appear directly under
      // subject names in many result sheet templates. These tokens look like
      // numeric data and confuse the table builder into stopping header merge.
      // We detect them as lines where every token matches /^\(?\d{2,3}\)?$/.
      const clustered = clusterRows(pageTokens);
      const filtered: Token[] = [];
      for (const row of clustered) {
        const allSubMax = row.every((t) =>
          /^\(?\d{2,3}\)?$/.test(t.text.trim())
        );
        if (!allSubMax) filtered.push(...row);
      }
      allTokens.push(...(filtered.length ? filtered : pageTokens));
    } else {
      // Scanned PDF page — render and OCR
      const canvas = await renderPageToCanvas(page);
      if (canvas) {
        const { tokens } = await ocrTokens(canvas);
        allTokens.push(...tokens);
      }
    }
    rawLines.push(items.map((it: any) => it.str).join(' '));
  }

  const built = buildTable(allTokens);
  if (built) return built;
  const salvaged = salvageFromTokens(allTokens);
  if (salvaged) return salvaged;
  const text = fromText(rawLines.join('\n'));
  if (text.rows.length || text.subjects.length) return text;
  return { subjects: [], rows: [] };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function extractFromFile(file: File): Promise<Extracted> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'csv') return fromCSV(await file.text());
  if (ext === 'xlsx' || ext === 'xls') return fromXLSX(await file.arrayBuffer());
  if (ext === 'pdf') return fromPDF(await file.arrayBuffer());
  if (ext === 'docx') return fromDOCX(await file.arrayBuffer());
  if (ext === 'doc') return fromDOC(await file.arrayBuffer());
  if (file.type.startsWith('image/')) return fromImage(file);
  throw new Error(
    'Choose a JPG, PNG, PDF, DOCX, XLSX, XLS, or CSV file to extract results.'
  );
}

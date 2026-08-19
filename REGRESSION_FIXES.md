# Regression Fixes for OCR Extraction

## Summary

Fixed 4 critical regressions introduced by the previous "OCR extraction accuracy improvements" changes:

1. **Header detection completely broken** - All subjects showing as "Subject 1", "Subject 2", etc.
2. **Row-index column being extracted as subject** - "No." column numbers appearing in Subject 1
3. **Row offset bug** - All rows shifted down by one (row 1 showing metadata, row 2 showing row 1 data, etc.)
4. **Student Name extraction broken** - Most names appearing as blank

Also addressed the pre-existing ID-splitting bug (GA250811 → "GA25081" + "1 Kevin Kiptoo").

---

## Root Causes Identified

### Regression 1: Header Detection Broken

**Problem:** The `correctSubjectName()` function was being applied too early in the pipeline, during column classification. When a valid subject name like "English" was OCR'd correctly, it was being processed through aggressive correction logic that sometimes returned generic placeholders or failed to match, causing the column to be filtered out.

**Fix:** Moved `correctSubjectName()` application to AFTER column classification, and only apply it when the text fuzzy-matches a subject or looks like a subject word (3-20 alphabetic characters). This preserves correctly-read subject names while still correcting OCR errors.

**Location:** `buildTable()` function, subject extraction block

**Code changed:**
```typescript
// OLD: Applied clean() which lost the original text
subjects = cols.filter((c) => c.kind === 'subject').map((c) => clean(c.text))

// NEW: Selective correction only when needed
subjects = cols
  .filter((c) => c.kind === 'subject')
  .map((c) => {
    const cleaned = clean(c.text);
    if (fuzzySubject(cleaned) || /^[A-Za-z]{3,20}$/i.test(cleaned)) {
      return correctSubjectName(cleaned);
    }
    return cleaned;
  })
```

---

### Regression 2: Row-Index Column Treated as Subject

**Problem:** The "No." column (containing row numbers 1, 2, 3, ...) was not being explicitly excluded from subject columns. It was being classified as a subject and its numbers populated "Subject 1".

**Fix:** Added explicit row-index detection at the TOP of `classifyColumns()`, before any other classification logic. Columns matching `/^no\.?$/i`, `/^#$/i`, or `/^s\/?n$/i` are immediately marked as `kind: 'skip'`.

**Location:** `classifyColumns()` function

**Code changed:**
```typescript
function classifyColumns(header: Token[]): Column[] {
  // ...
  return meaningful.map((h, i) => {
    const t = clean(h.text).toLowerCase();
    let kind: Column['kind'] = 'subject';
    
    // CRITICAL: Exclude row-index column FIRST
    if (/^no\.?$/i.test(t) || /^#$/i.test(t) || /^s\/?n$/i.test(t)) {
      kind = 'skip';
    } else if (SKIP_HEADER.test(t)) {
      kind = 'skip';
    } else if (NAME_HEADER.test(t)) {
      kind = 'name';
    } else if (ID_HEADER.test(t)) {
      kind = 'id';
    }
    return { text: clean(h.text), x: h.x, w: nextX - h.x, kind };
  });
}
```

---

### Regression 3: Row Offset Bug (All Rows Shifted Down)

**Problem:** `findHeaderBlock()` was merging multiple OCR lines into one header block (e.g., if subjects were split across 3 lines, it merged them), but `buildTable()` was only skipping `header.index + 1` when starting data extraction. This caused it to read the 2nd and 3rd header-merge lines as if they were data rows.

**Example:**
- Row 0: "Student ID | Student Name" (detected as header)
- Row 1: "English | Mathematics | Physics" (merged into header)
- Row 2: "2025" (Academic Year metadata - **incorrectly read as row 1 data**)
- Row 3: "GA250801 Amina Yusuf ..." (**incorrectly read as row 2 data**)

**Fix:** 
1. Changed `findHeaderBlock()` to return `{ tokens: Token[]; rowsConsumed: number }` instead of just `Token[]`
2. Changed `findStrictHeader()` to return `{ line: Token[]; index: number; rowsConsumed: number }`
3. Changed `buildTable()` to skip `header.index + header.rowsConsumed` rows, not just `header.index + 1`

**Location:** `findHeaderBlock()`, `findStrictHeader()`, `buildTable()`

**Code changed:**
```typescript
// findHeaderBlock now tracks how many rows it consumed
function findHeaderBlock(rows: Token[][], start: number): { tokens: Token[]; rowsConsumed: number } {
  const block = [...rows[start]];
  let consumed = 1;
  for (let i = start + 1; i < rows.length && i - start <= 4; i++) {
    // ... merge logic ...
    consumed++;
  }
  return { tokens: block, rowsConsumed: consumed };
}

// buildTable skips the correct number of rows
for (let i = header.index + header.rowsConsumed; i < rows.length; i++) {
  // process data rows
}
```

---

### Regression 4: Student Name Extraction Broken

**Problem:** The `parseStudentRow()` function was calculating `nameHi` (the right boundary for name tokens) as `tokenForColumn(line, subjCols[0])?.x ?? Infinity`. When the first subject column had no token in a row, it returned `undefined`, and the `?? Infinity` fallback caused all tokens to be considered name tokens, including score columns.

Additionally, row-index numbers (1, 2, 3, ...) were leaking into the name field because they weren't being filtered out.

**Fix:**
1. Changed nameHi calculation to find the leftmost ACTUAL score token in the row, not just assume subjCols[0] position
2. Added explicit filter for small numbers (≤ 100, ≤ 2 digits) that are likely row indices

**Location:** `parseStudentRow()` function

**Code changed:**
```typescript
// Calculate name boundary more carefully
let nameHi: number;
if (nameCol) {
  nameHi = nameCol.x + nameCol.w;
} else if (subjCols.length > 0) {
  // Find the leftmost ACTUAL score token in this row
  const firstScoreToken = subjCols
    .map((col) => tokenForColumn(line, col))
    .filter((t): t is Token => t !== null)
    .sort((a, b) => a.x - b.x)[0];
  nameHi = firstScoreToken ? firstScoreToken.x : Infinity;
} else {
  nameHi = Infinity;
}

// Filter out row-index numbers
for (const t of line) {
  if (t.x >= nameHi) break;
  if (t.text === id) continue;
  // NEW: Skip row-index numbers
  if (isNumeric(t.text) && t.text.length <= 2 && parseInt(t.text) <= 100) continue;
  if (isScore(t.text)) continue;
  // ... rest of name extraction
}
```

---

### Bonus Fix: ID-Splitting Bug (GA250811 → GA25081 + 1)

**Problem:** OCR sometimes splits IDs like "GA250811" into two tokens: "GA25081" and "1". The "1" then leaked into the name field, producing "1 Kevin Kiptoo".

**Fix:** Added ID-repair logic in `parseStudentRow()` that checks if:
1. The extracted ID looks incomplete (matches `^[A-Za-z]{1,6}\d{5,7}$` - e.g., 7 digits when 8 are expected)
2. The next token within 30px is a single digit
3. Concatenating them produces a valid ID

If all conditions are met, the ID is repaired and the extra token is removed from the line before name extraction.

**Location:** `parseStudentRow()` function

**Code changed:**
```typescript
// Extract student ID with repair logic for split IDs
let id = idCol ? tokenForColumn(line, idCol)?.text || '' : '';
if (!id) {
  const lead = line.filter((t) => t.x <= (nameCol ? nameCol.x : line[0]?.x + 400)).slice(0, 3);
  const hit = lead.find((t) => isID(t.text) && !isScore(t.text));
  if (hit) id = hit.text;
}
id = id.trim();

// Fix for ID-splitting bug
if (id && /^[A-Za-z]{1,6}\d{5,7}$/i.test(id)) {
  const idToken = line.find((t) => t.text.trim() === id);
  if (idToken) {
    const idX = idToken.x + idToken.w;
    const nextToken = line.find(
      (t) => t.x >= idX && t.x - idX < 30 && /^\d$/.test(t.text.trim())
    );
    if (nextToken) {
      const candidateId = id + nextToken.text.trim();
      if (isID(candidateId)) {
        id = candidateId;
        line = line.filter((t) => t !== nextToken);
      }
    }
  }
}
```

---

## Testing Instructions

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Start dev server:**
   ```bash
   npm run dev
   ```

3. **Open test page:**
   Navigate to `http://localhost:3002/test-ocr.html` (or whichever port Next.js uses)

4. **Run extraction:**
   Click "▶️ Run Extraction Test" button

5. **Verify results:**
   The test page will show:
   - Metrics (rows extracted, subjects found, match rates)
   - Full extracted table with color-coded cells (green=correct, red=mismatch, pink=uncertain)
   - Detailed comparison for rows 1, 2, and 11
   - Full JSON output

**Expected Results:**
- All 8 subject names: English, Mathematics, Physics, Chemistry, Biology, History, Geography, Computer
- 15 student rows
- Row 1: GA250801, Amina Yusuf, scores 92, 95, 89, 94, 91, 93, 90, 96
- Row 2: GA250802, Brian Otieno, scores 85, 90, 78, 82, 76, 88, 91, 84
- Row 11: GA250811, Kevin Kiptoo (NOT "GA25081" or "1 Kevin Kiptoo"), scores 52, 58, 48, 51, 55, 51, 55, 60
- No "Subject 1", "Subject 2" placeholders
- No "2025" in Student ID field
- No sequential numbers (1, 2, 3, ...) in score columns

---

## Files Modified

1. `src/lib/extract.ts` - Core extraction logic (all 4 regressions + ID-split fix)
2. `src/app/AppWrappers.tsx` - Removed unused @ts-expect-error directive
3. `src/components/charts/BarChart.tsx` - Removed unused @ts-expect-error directive
4. `src/components/charts/PieChart.tsx` - Removed unused @ts-expect-error directive
5. `src/components/charts/LineChart.tsx` - Removed unused @ts-expect-error directive
6. `src/components/charts/LineAreaChart.tsx` - Removed unused @ts-expect-error directive

---

## Verification Checklist

- [ ] Header detection works: Real subject names extracted, no "Subject N" placeholders
- [ ] Row-index column excluded: No "1, 2, 3, ..." appearing in score data
- [ ] Row alignment correct: Row 1 shows first student data, not metadata
- [ ] Student names extracted: All rows have names, not blank
- [ ] ID-split bug fixed: GA250811 appears as "GA250811", not "GA25081" with "1" in name
- [ ] No regression in other rows: Rows 1-10 and 12-15 still extract correctly
- [ ] Build succeeds without TypeScript errors
- [ ] Test page loads and executes without errors

---

## Notes

- The fixes are conservative and surgical - only the broken logic was changed
- All existing OCR correction heuristics (normalizeNumber, fuzzySubject, correctSubjectName) remain intact
- The reconcileColumns logic (filling missing subject headers) is unchanged
- No changes to UI components or business logic

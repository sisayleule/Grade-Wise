# OCR Extraction Improvements

## Summary of Changes

This update significantly improves OCR accuracy for student result sheet uploads, eliminating the need for manual corrections in most cases.

## Key Improvements

### 1. **Advanced Subject Name Correction** (`correctSubjectName` function)
   - **Pattern-based corrections** for common OCR misreads:
     - "GEKGGR PHY" → "Geography"
     - "CHEMBJ" → "Chemistry"  
     - "MATEMATICS" → "Mathematics"
     - "GEOGRAFY" → "Geography"
   
   - **Substring matching** for partially corrupted reads:
     - Detects valid subject names embedded in OCR noise
     - E.g., "CHEM" in "CHEMBJ" correctly maps to "Chemistry"
   
   - **Phonetic-like matching** for extreme OCR errors:
     - Collapses vowels and normalizes phonetic equivalents
     - Handles severe character substitutions
   
   - **Comprehensive vocabulary** with 35+ subjects including:
     - Core subjects: Mathematics, English, Physics, Chemistry, Biology
     - Languages: Kiswahili, French, German, Spanish, Arabic
     - Other: Economics, ICT, Business, Agriculture, etc.

### 2. **Improved Column Reconciliation**
   - Applies subject name corrections during column matching
   - Handles cases where:
     - OCR misses some subject headers entirely
     - Subject names are partially read
     - Column alignment is off due to OCR errors
   
   - Uses data-driven column detection from actual score positions
   - Falls back to `COMMON_SUBJECT_ORDER` for intelligent gap-filling

### 3. **Enhanced Student Name Parsing**
   - Filters out misread subject names that leak into name fields
   - Removes single-character OCR noise (leading/trailing)
   - Deduplicates consecutive tokens (OCR word-split errors)
   - Prevents metadata words from appearing in names
   - Example fixes:
     - "Ugekile GA O People" → "Ugekile People" (filters out stray tokens)

### 4. **Reduced False Positives for Uncertainty Flags**
   - Lowered confidence threshold from 45 to 40
   - Only flags cells where BOTH conditions are met:
     - Low OCR confidence (<40%)
     - Heavy normalization was required
   - Reduces amber highlighting on clearly readable values

### 5. **Robust Header Detection**
   - Improved scoring for header row detection
   - Better handles misread subject names in headers
   - Gives higher scores to exact subject matches after correction

## Testing Recommendations

### Test with Various Document Types:
1. **Clean printed sheets** - Should extract perfectly with no amber cells
2. **Low-quality scans** - Should correct common OCR errors automatically
3. **Mixed layouts** - Should handle split headers and multi-line cells
4. **Photos** - Should work on mobile phone captures with reasonable quality

### Expected Results:
- **Subject names**: Should match standard vocabulary exactly
- **Scores**: Should align correctly to their subject columns
- **Student names**: Should be clean without OCR noise or subject name fragments
- **Amber flags**: Should only appear on genuinely ambiguous cells

## Technical Details

### OCR Correction Pipeline:
```
Raw OCR Token
    ↓
Normalize (lowercase, strip special chars)
    ↓
Check against patterns & corrections dictionary
    ↓
Try substring matching with subject vocabulary
    ↓
Apply phonetic-like matching for severe errors
    ↓
Return corrected title-cased subject name
```

### Column Alignment Strategy:
```
Detect header row
    ↓
Classify columns (ID, Name, Subject, Skip)
    ↓
Apply OCR corrections to subject names
    ↓
Extract score positions from data rows
    ↓
Match corrected subjects to score columns by proximity
    ↓
Fill gaps using COMMON_SUBJECT_ORDER
    ↓
Create aligned column mappings
```

## Files Modified

- **`src/lib/extract.ts`** - Core extraction and OCR correction logic

## Backward Compatibility

- Existing functionality is preserved
- Changes are additive - no breaking changes to the API
- Previously extracted data remains compatible

## Future Enhancements

Potential improvements for future versions:
1. Machine learning-based subject name recognition
2. Support for custom subject vocabularies per school
3. Multi-language support (non-English result sheets)
4. Handwritten result sheet OCR (requires different ML model)

---

**Note**: While these improvements significantly enhance accuracy, OCR on extremely low-quality scans or heavily damaged documents may still require manual verification of amber-flagged cells.

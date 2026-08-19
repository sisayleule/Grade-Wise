import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from 'lib/supabase/service';
import { requireApproved } from 'lib/supabase/requireApproved';

/**
 * Server-side API route for Gemini-based extraction.
 * 
 * This route handles file uploads and calls the Gemini API server-side,
 * keeping the API key secure and never exposing it to the browser.
 */

type GeminiResponse = {
  subjects: string[];
  students: Array<{
    id: string;
    name: string;
    scores: Record<string, number | null>;
  }>;
};

type ExtractedRow = {
  id: string;
  name: string;
  scores: Record<string, string>;
  uncertain?: string[];
};

type ExtractedResult = {
  subjects: string[];
  rows: ExtractedRow[];
  note?: string;
};

/**
 * Convert file to base64 data URL
 */
async function fileToBase64(file: File): Promise<{ mimeType: string; base64Content: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const base64Content = buffer.toString('base64');
  const mimeType = file.type || 'application/octet-stream';
  
  return { mimeType, base64Content };
}

/**
 * Extract table data from image/PDF using Gemini Vision API
 */
async function extractWithGemini(
  file: File,
  apiKey: string
): Promise<ExtractedResult> {
  console.log('[Server] Extracting with Gemini, file type:', file.type);
  
  const { mimeType, base64Content } = await fileToBase64(file);

  const prompt = `You are analyzing a student result sheet / grade report. Extract ONLY the student data table.

INSTRUCTIONS:
1. Ignore the school header, logo, title, exam information, grading scale, summary section, and signature area
2. Extract ONLY the main student table with columns for Student ID, Student Name, and subject scores
3. Return subject names exactly as they appear in the table header (e.g., "English", "Mathematics", "Physics", etc.)
4. Preserve full student names exactly as written - do not truncate or split them
5. For each student, extract their ID, full name, and ALL subject scores
6. If a score cell is empty, unclear, or you're not confident, use null instead of guessing
7. Return scores as numbers (integers or decimals), not strings
8. The "No." or "#" column is just a row number - DO NOT include it as a subject

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "subjects": ["English", "Mathematics", "Physics", "Chemistry", "Biology", "History", "Geography", "Computer"],
  "students": [
    { "id": "GA250801", "name": "Amina Yusuf", "scores": { "English": 92, "Mathematics": 95, "Physics": 89, "Chemistry": 94, "Biology": 91, "History": 93, "Geography": 90, "Computer": 96 } }
  ]
}`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Content,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 1,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
  console.log('[Server] Calling Gemini API, file type:', file.type);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  console.log('[Server] Response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Server] Gemini API error response:', errorText);
    if (response.status === 429) {
      throw Object.assign(
        new Error('Daily extraction limit reached — try again after midnight Pacific Time, or contact your administrator.'),
        { isQuotaError: true }
      );
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  if (data.promptFeedback?.blockReason) {
    console.error('[Server] Content blocked:', data.promptFeedback);
    throw new Error('Content was blocked by Gemini safety filters');
  }
  
  const candidates = data.candidates;
  if (!candidates || !candidates.length) {
    throw new Error('Gemini returned no response');
  }

  const content = candidates[0].content;
  if (!content || !content.parts || !content.parts.length) {
    throw new Error('Gemini returned empty content');
  }

  let textResponse = content.parts[0].text;
  if (!textResponse) {
    throw new Error('Gemini returned no text');
  }
  
  // Clean up markdown code blocks
  textResponse = textResponse.trim();
  if (textResponse.startsWith('```json')) {
    textResponse = textResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (textResponse.startsWith('```')) {
    textResponse = textResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  // Parse JSON
  let geminiData: GeminiResponse;
  try {
    geminiData = JSON.parse(textResponse);
  } catch (parseError) {
    console.error('[Server] Failed to parse Gemini response:', textResponse.substring(0, 200));
    throw new Error('Gemini returned invalid JSON');
  }

  if (!geminiData.subjects || !Array.isArray(geminiData.subjects)) {
    throw new Error('Gemini response missing subjects array');
  }
  if (!geminiData.students || !Array.isArray(geminiData.students)) {
    throw new Error('Gemini response missing students array');
  }

  // Convert to expected format
  const subjects = geminiData.subjects;
  const rows: ExtractedRow[] = geminiData.students.map((student) => {
    const scores: Record<string, string> = {};
    const uncertain: string[] = [];

    subjects.forEach((subject) => {
      const score = student.scores[subject];
      if (score === null || score === undefined) {
        scores[subject] = '';
        uncertain.push(subject);
      } else {
        scores[subject] = String(score);
      }
    });

    const row: ExtractedRow = {
      id: student.id || '',
      name: student.name || '',
      scores,
    };

    if (uncertain.length > 0) {
      row.uncertain = Array.from(new Set(uncertain));
    }

    if (!student.id) {
      row.uncertain = row.uncertain || [];
      if (!row.uncertain.includes('id')) row.uncertain.push('id');
    }
    if (!student.name) {
      row.uncertain = row.uncertain || [];
      if (!row.uncertain.includes('name')) row.uncertain.push('name');
    }

    return row;
  });

  return {
    subjects,
    rows,
    note: rows.some((r) => r.uncertain?.length)
      ? 'Some values could not be read with certainty — check the highlighted cells.'
      : undefined,
  };
}

/**
 * Extract table data from text using Gemini API
 */
async function extractTextWithGemini(
  text: string,
  apiKey: string
): Promise<ExtractedResult> {
  console.log('[Server] Extracting text with Gemini, length:', text.length);

  const prompt = `You are analyzing a student result sheet / grade report that has been extracted as text from a Word document. Extract the student data table.

INSTRUCTIONS:
1. Ignore the school header, logo, title, exam information, grading scale, summary section, and signature area
2. Extract ONLY the main student table with columns for Student ID, Student Name, and subject scores
3. Return subject names exactly as they appear in the table header (e.g., "English", "Mathematics", "Physics", etc.)
4. Preserve full student names exactly as written - do not truncate or split them
5. For each student, extract their ID, full name, and ALL subject scores
6. If a score cell is empty, unclear, or you're not confident, use null instead of guessing
7. Return scores as numbers (integers or decimals), not strings
8. The "No." or "#" column is just a row number - DO NOT include it as a subject

Here is the extracted text:

${text}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "subjects": ["English", "Mathematics", "Physics", "Chemistry", "Biology", "History", "Geography", "Computer"],
  "students": [
    { "id": "GA250801", "name": "Amina Yusuf", "scores": { "English": 92, "Mathematics": 95, "Physics": 89, "Chemistry": 94, "Biology": 91, "History": 93, "Geography": 90, "Computer": 96 } }
  ]
}`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt }
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 1,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
  console.log('[Server] Calling Gemini text API, text length:', text.length);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  console.log('[Server] Text API response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Server] Gemini text API error response:', errorText);
    if (response.status === 429) {
      throw Object.assign(
        new Error('Daily extraction limit reached — try again after midnight Pacific Time, or contact your administrator.'),
        { isQuotaError: true }
      );
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  if (data.promptFeedback?.blockReason) {
    throw new Error('Content was blocked by Gemini safety filters');
  }
  
  const candidates = data.candidates;
  if (!candidates || !candidates.length) {
    throw new Error('Gemini returned no response');
  }

  const content = candidates[0].content;
  if (!content || !content.parts || !content.parts.length) {
    throw new Error('Gemini returned empty content');
  }

  let textResponse = content.parts[0].text;
  if (!textResponse) {
    throw new Error('Gemini returned no text');
  }
  
  textResponse = textResponse.trim();
  if (textResponse.startsWith('```json')) {
    textResponse = textResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (textResponse.startsWith('```')) {
    textResponse = textResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let geminiData: GeminiResponse;
  try {
    geminiData = JSON.parse(textResponse);
  } catch (parseError) {
    throw new Error('Gemini returned invalid JSON from text extraction');
  }

  if (!geminiData.subjects || !Array.isArray(geminiData.subjects)) {
    throw new Error('Gemini response missing subjects array');
  }
  if (!geminiData.students || !Array.isArray(geminiData.students)) {
    throw new Error('Gemini response missing students array');
  }

  const subjects = geminiData.subjects;
  const rows: ExtractedRow[] = geminiData.students.map((student) => {
    const scores: Record<string, string> = {};
    const uncertain: string[] = [];

    subjects.forEach((subject) => {
      const score = student.scores[subject];
      if (score === null || score === undefined) {
        scores[subject] = '';
        uncertain.push(subject);
      } else {
        scores[subject] = String(score);
      }
    });

    const row: ExtractedRow = {
      id: student.id || '',
      name: student.name || '',
      scores,
    };

    if (uncertain.length > 0) {
      row.uncertain = Array.from(new Set(uncertain));
    }

    if (!student.id) {
      row.uncertain = row.uncertain || [];
      if (!row.uncertain.includes('id')) row.uncertain.push('id');
    }
    if (!student.name) {
      row.uncertain = row.uncertain || [];
      if (!row.uncertain.includes('name')) row.uncertain.push('name');
    }

    return row;
  });

  return {
    subjects,
    rows,
    note: rows.some((r) => r.uncertain?.length)
      ? 'Some values could not be read with certainty — check the highlighted cells.'
      : undefined,
  };
}

/**
 * POST /api/extract
 *
 * Identifies the logged-in school from the Supabase session, fetches their
 * stored Gemini API key, and uses it for extraction.  The global env-var key
 * is never used — each school's uploads consume only their own quota.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Approval gate: must be authenticated AND approved ──────────────────
    const guard = await requireApproved();
    if (guard.error) return guard.error;
    const userId = guard.user.id;

    // ── Resolve the API key for this school via Vault ───────────────────────
    let apiKey: string | null = null;

    {
      // Decrypt this school's key using the service-role RPC that reads from
      // vault.decrypted_secrets — the plaintext key never touches a DB column
      try {
        const service = createServiceClient();
        const { data, error: rpcErr } = await (service as any).rpc('get_school_gemini_key', {
          school_id: userId,
        });
        if (rpcErr) throw rpcErr;
        apiKey = data as string | null;
      } catch (err: any) {
        console.error('[extract] vault key lookup error:', err?.message);
        return NextResponse.json(
          { error: 'Failed to retrieve API key. Contact your administrator.' },
          { status: 500 }
        );
      }

      if (!apiKey) {
        return NextResponse.json(
          {
            error:
              'No Gemini API key configured for your school. ' +
              'Go to Settings → Gemini API Key to add one.',
            noKey: true,
          },
          { status: 422 }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const extractionType = formData.get('type') as string | null; // 'image', 'pdf', or 'text'
    const textContent = formData.get('text') as string | null;

    if (!file && !textContent) {
      return NextResponse.json(
        { error: 'No file or text provided' },
        { status: 400 }
      );
    }

    let result: ExtractedResult;

    if (extractionType === 'text' && textContent) {
      // Text extraction (for DOCX text tables)
      result = await extractTextWithGemini(textContent, apiKey);
    } else if (file) {
      // Image/PDF extraction
      result = await extractWithGemini(file, apiKey);
    } else {
      return NextResponse.json(
        { error: 'Invalid extraction parameters' },
        { status: 400 }
      );
    }

    console.log('[Server] Extraction successful:', {
      subjects: result.subjects.length,
      rows: result.rows.length
    });

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[Server] Extraction error:', error);
    const isQuota = error?.isQuotaError === true ||
      (error?.message && /429|quota|resource.exhausted|daily.*limit/i.test(error.message));
    return NextResponse.json(
      { error: error.message || 'Extraction failed', quota: isQuota },
      { status: isQuota ? 429 : 500 }
    );
  }
}

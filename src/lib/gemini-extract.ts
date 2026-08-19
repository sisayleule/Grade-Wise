/**
 * Gemini-based result sheet extraction (client-side wrapper).
 * 
 * Calls the server-side API route which securely handles Gemini API calls.
 */

import { ScoreRow } from './grades';

export type Extracted = {
  subjects: string[];
  rows: ScoreRow[];
  note?: string;
};

/**
 * Extract result sheet data from image/PDF using server-side Gemini API
 */
export async function extractWithGemini(file: File): Promise<Extracted> {
  console.log('[Extraction] Calling server API for image/PDF extraction');
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'image');

  const response = await fetch('/api/extract', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    console.error('[Extraction] Server API error:', error);
    if (response.status === 429 || error.quota) {
      throw new Error(error.error || 'Daily extraction limit reached — try again after midnight Pacific Time, or contact your administrator.');
    }
    if (response.status === 422 && error.noKey) {
      throw new Error(error.error || 'No Gemini API key configured — go to Settings → Gemini API Key to add one.');
    }
    if (response.status === 401) {
      throw new Error('You must be signed in to extract files. Please sign in and try again.');
    }
    throw new Error(error.error || 'Server extraction failed');
  }

  const result = await response.json();
  console.log('[Extraction] Server API returned:', {
    subjects: result.subjects?.length || 0,
    rows: result.rows?.length || 0
  });

  return result;
}

/**
 * Extract result sheet data from plain text using server-side Gemini API
 */
export async function extractTextWithGemini(text: string): Promise<Extracted> {
  console.log('[Extraction] Calling server API for text extraction');
  
  const formData = new FormData();
  formData.append('text', text);
  formData.append('type', 'text');

  const response = await fetch('/api/extract', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    console.error('[Extraction] Server API error:', error);
    if (response.status === 429 || error.quota) {
      throw new Error(error.error || 'Daily extraction limit reached — try again after midnight Pacific Time, or contact your administrator.');
    }
    if (response.status === 422 && error.noKey) {
      throw new Error(error.error || 'No Gemini API key configured — go to Settings → Gemini API Key to add one.');
    }
    if (response.status === 401) {
      throw new Error('You must be signed in to extract files. Please sign in and try again.');
    }
    throw new Error(error.error || 'Server text extraction failed');
  }

  const result = await response.json();
  console.log('[Extraction] Server API returned:', {
    subjects: result.subjects?.length || 0,
    rows: result.rows?.length || 0
  });

  return result;
}

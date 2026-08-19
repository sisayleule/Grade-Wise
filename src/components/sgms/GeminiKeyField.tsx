'use client';
/**
 * GeminiKeyField
 *
 * Renders the Gemini API Key section of the Settings page.
 *
 * Behaviour:
 * - On mount: GETs /api/settings/gemini-key to check if a key is already stored.
 * - If a key is stored: shows a masked value (AQ.••••••••LMg) and a "Replace key" button.
 * - If no key: shows an input field with a Save button.
 * - On save: POSTs the key to the API route which verifies it with Gemini before storing.
 *   Shows "Key saved and verified ✓" or "This key didn't work — check it and try again."
 * - The raw key is NEVER stored in component state after save; only the masked version is kept.
 */
import { useState, useEffect, FormEvent } from 'react';
import {
  MdKey,
  MdCheckCircle,
  MdWarningAmber,
  MdVisibility,
  MdVisibilityOff,
  MdDelete,
} from 'react-icons/md';

type KeyStatus = 'loading' | 'none' | 'saved';

export default function GeminiKeyField() {
  const [status, setStatus] = useState<KeyStatus>('loading');
  const [masked, setMasked] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Load current key status on mount ───────────────────────────────────────
  useEffect(() => {
    fetch('/api/settings/gemini-key')
      .then((r) => r.json())
      .then((data) => {
        if (data.hasKey) {
          setStatus('saved');
          setMasked(data.masked);
        } else {
          setStatus('none');
        }
      })
      .catch(() => setStatus('none'));
  }, []);

  // ── Save handler ────────────────────────────────────────────────────────────
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const trimmed = keyInput.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      });
      const data = await res.json();

      if (res.ok) {
        // Saved — fetch the masked version and clear the raw input immediately
        setKeyInput('');
        setFeedback({ ok: true, msg: data.message || 'Key saved and verified.' });
        // Reload masked value from server
        const refreshed = await fetch('/api/settings/gemini-key').then((r) => r.json());
        setMasked(refreshed.masked ?? null);
        setStatus('saved');
        setReplacing(false);
      } else {
        setFeedback({ ok: false, msg: data.error || 'Failed to save key.' });
      }
    } catch {
      setFeedback({ ok: false, msg: 'Network error — please try again.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Remove handler ──────────────────────────────────────────────────────────
  const handleRemove = async () => {
    if (!confirm('Remove your Gemini API key? Extraction will stop working until you add a new one.')) return;
    setSaving(true);
    setFeedback(null);
    try {
      await fetch('/api/settings/gemini-key', { method: 'DELETE' });
      setStatus('none');
      setMasked(null);
      setReplacing(false);
      setFeedback({ ok: true, msg: 'Key removed.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-lightPrimary p-5 dark:border-navy-600 dark:bg-navy-700/40">
      <div className="mb-3 flex items-center gap-2">
        <MdKey className="text-xl text-brand-500" />
        <span className="text-sm font-bold text-navy-900 dark:text-white">
          Gemini API Key
        </span>
        {status === 'saved' && !replacing && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-horizonGreen-100 px-2.5 py-0.5 text-xs font-bold text-horizonGreen-700 dark:bg-horizonGreen-900/30 dark:text-horizonGreen-300">
            <MdCheckCircle className="text-sm" /> Active
          </span>
        )}
      </div>

      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        Your key is stored securely in the database and is never sent back to the browser.
        Get one free at{' '}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-500 underline hover:text-brand-600"
        >
          aistudio.google.com/apikey
        </a>
        .
      </p>

      {status === 'loading' && (
        <div className="h-10 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-600" />
      )}

      {status === 'saved' && !replacing && (
        <div className="flex items-center gap-3">
          <code className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-mono text-sm text-navy-900 dark:border-navy-600 dark:bg-navy-800 dark:text-white">
            {masked}
          </code>
          <button
            onClick={() => { setReplacing(true); setFeedback(null); }}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-navy-900 transition hover:border-brand-500 hover:text-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white"
          >
            Replace
          </button>
          <button
            onClick={handleRemove}
            disabled={saving}
            title="Remove key"
            className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 bg-white text-lg text-gray-400 transition hover:border-red-300 hover:text-red-500 dark:border-navy-600 dark:bg-navy-800"
          >
            <MdDelete />
          </button>
        </div>
      )}

      {(status === 'none' || replacing) && (
        <form onSubmit={handleSave} className="space-y-3">
          <div className="relative">
            <input
              required
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste your Gemini API key (AQ.Ab…)"
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-4 pr-12 font-mono text-sm text-navy-900 outline-none transition focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <MdVisibilityOff /> : <MdVisibility />}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !keyInput.trim()}
              className="flex-1 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Verifying…' : 'Save and verify'}
            </button>
            {replacing && (
              <button
                type="button"
                onClick={() => { setReplacing(false); setFeedback(null); setKeyInput(''); }}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition hover:border-gray-400 dark:border-navy-600 dark:text-gray-400"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {feedback && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
            feedback.ok
              ? 'border-horizonGreen-200 bg-horizonGreen-50 text-horizonGreen-800 dark:border-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-200'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300'
          }`}
        >
          {feedback.ok ? (
            <MdCheckCircle className="mt-0.5 shrink-0" />
          ) : (
            <MdWarningAmber className="mt-0.5 shrink-0" />
          )}
          <span>{feedback.msg}</span>
        </div>
      )}
    </div>
  );
}

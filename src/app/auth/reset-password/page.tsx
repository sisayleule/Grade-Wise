'use client';
import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import {
  MdLock,
  MdChevronLeft,
  MdWarningAmber,
  MdCheckCircle,
  MdSchool,
} from 'react-icons/md';

type PageState = 'loading' | 'ready' | 'success' | 'invalid';

export default function ResetPassword() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  useEffect(() => {
    // Supabase sends the user to this page with a session embedded in the URL
    // fragment (#access_token=...&type=recovery). The Supabase client picks
    // this up automatically via onAuthStateChange when it detects a
    // SIGNED_IN event with type=recovery.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'PASSWORD_RECOVERY') {
          // Token is valid — show the new-password form
          setPageState('ready');
        } else if (event === 'SIGNED_IN') {
          // Already authenticated (e.g. user navigated here directly)
          // Check if we have a recovery session
          setPageState('ready');
        }
      }
    );

    // Fallback: if no auth event fires within 3 s, assume the link is invalid
    const fallback = setTimeout(() => {
      setPageState((prev) => (prev === 'loading' ? 'invalid' : prev));
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      // Common case: the reset link has expired or was already used
      if (
        /expired/i.test(error.message) ||
        /invalid/i.test(error.message) ||
        /token/i.test(error.message)
      ) {
        setPageState('invalid');
      } else {
        setError(error.message);
      }
      setLoading(false);
      return;
    }

    // Sign out so the user is forced to sign in with the new password
    await supabase.auth.signOut();
    setPageState('success');
  };

  /* ── Render ──────────────────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-screen font-dm">
      {/* ── Left panel ────────────────────────────────────────────────────── */}
      <div className="flex w-full flex-col bg-white px-8 py-10 dark:bg-navy-900 lg:w-1/2 xl:px-16">
        <a
          href="/auth/sign-in"
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-400 transition hover:text-navy-700 dark:text-gray-500 dark:hover:text-white"
        >
          <MdChevronLeft className="text-lg" />
          Back to Sign In
        </a>

        <div className="my-auto mx-auto w-full max-w-[420px] pt-10 pb-6">

          {/* ── Loading ──────────────────────────────────────────────────── */}
          {pageState === 'loading' && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Verifying reset link…</p>
            </div>
          )}

          {/* ── Invalid / expired link ───────────────────────────────────── */}
          {pageState === 'invalid' && (
            <>
              <h1 className="text-[32px] font-bold leading-tight text-navy-900 dark:text-white">
                Link expired
              </h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                This password reset link is invalid or has expired. Reset links
                are single-use and expire after 1 hour.
              </p>
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                <MdWarningAmber className="mt-0.5 shrink-0 text-lg" />
                <div>
                  <p className="font-bold">Request a new link</p>
                  <p className="mt-1">
                    <a
                      href="/auth/forgot-password"
                      className="font-bold text-brand-500 underline hover:no-underline"
                    >
                      Click here
                    </a>{' '}
                    to request a fresh password reset link.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* ── Success ──────────────────────────────────────────────────── */}
          {pageState === 'success' && (
            <>
              <h1 className="text-[32px] font-bold leading-tight text-navy-900 dark:text-white">
                Password updated
              </h1>
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-200">
                <MdCheckCircle className="mt-0.5 shrink-0 text-lg" />
                <div>
                  <p className="font-bold">Your password has been changed.</p>
                  <p className="mt-1 text-green-700 dark:text-green-300">
                    Sign in with your new password to continue.
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/auth/sign-in?reset=1')}
                className="mt-6 h-12 w-full rounded-xl bg-brand-500 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)] transition hover:bg-brand-600"
              >
                Go to Sign In
              </button>
            </>
          )}

          {/* ── New password form ─────────────────────────────────────────── */}
          {pageState === 'ready' && (
            <>
              <h1 className="text-[32px] font-bold leading-tight text-navy-900 dark:text-white">
                Set new password
              </h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Choose a strong password — at least 8 characters.
              </p>

              {error && (
                <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                  <MdWarningAmber className="mt-0.5 shrink-0 text-base" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                {/* New password */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    New password<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      minLength={8}
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>

                {/* Confirm password */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    Confirm password<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repeat your new password"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-xl bg-brand-500 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)] transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Updating password…' : 'Set new password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* ── Right branding panel ──────────────────────────────────────────── */}
      <div className="hidden flex-col items-center justify-center bg-gradient-to-br from-[#4318FF] via-[#5e35e0] to-[#7B2FF7] lg:flex lg:w-1/2">
        <div className="relative mb-10 flex h-[170px] w-[170px] items-center justify-center">
          <div className="absolute inset-0 rounded-full border-[10px] border-white/20" />
          <div className="flex h-[130px] w-[130px] items-center justify-center rounded-full bg-white shadow-[0_0_60px_rgba(255,255,255,0.25)]">
            <MdSchool className="text-[56px] text-[#4318FF]" />
          </div>
        </div>
        <p className="text-[40px] font-extrabold tracking-tight text-white">GradeWise</p>
        <p className="mt-2 text-base font-medium text-white/70">School Management System</p>
        <div className="mt-12 rounded-2xl border border-white/20 bg-white/10 px-8 py-5 text-center backdrop-blur-sm">
          <p className="text-sm font-medium text-white/60">Manage smarter with</p>
          <p className="mt-0.5 text-lg font-bold text-white">gradewise.app</p>
        </div>
      </div>
    </div>
  );
}

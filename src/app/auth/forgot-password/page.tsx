'use client';
import { useState, FormEvent } from 'react';
import { createClient } from 'lib/supabase/client';
import {
  MdEmail,
  MdChevronLeft,
  MdWarningAmber,
  MdCheckCircle,
  MdSchool,
} from 'react-icons/md';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const redirectTo = `${siteUrl}/auth/reset-password`;

    // We call resetPasswordForEmail regardless of whether the email exists.
    // This prevents the form from being used to enumerate registered emails.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    // Surface only genuine technical errors (network, config) — NOT
    // "user not found", which we intentionally swallow.
    if (error && !/user not found/i.test(error.message)) {
      setError('Something went wrong. Please try again in a moment.');
      setLoading(false);
      return;
    }

    setLoading(false);
    setSubmitted(true);
  };

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
          <h1 className="text-[32px] font-bold leading-tight text-navy-900 dark:text-white">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Enter the email address on your account and we'll send you a reset link.
          </p>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              <MdWarningAmber className="mt-0.5 shrink-0 text-base" />
              <span>{error}</span>
            </div>
          )}

          {submitted ? (
            /* ── Success state ─────────────────────────────────────────────── */
            <div className="mt-8">
              <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-200">
                <MdCheckCircle className="mt-0.5 shrink-0 text-lg" />
                <div>
                  <p className="font-bold">Check your inbox</p>
                  <p className="mt-1 text-green-700 dark:text-green-300">
                    If an account exists for <strong>{email}</strong>, a
                    password reset link has been sent. It expires in 1 hour.
                  </p>
                </div>
              </div>

              <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Didn't receive it?{' '}
                <button
                  onClick={() => { setSubmitted(false); setEmail(''); }}
                  className="font-bold text-brand-500 hover:underline"
                >
                  Try again
                </button>
              </p>
            </div>
          ) : (
            /* ── Request form ──────────────────────────────────────────────── */
            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                  Email address<span className="ml-0.5 text-brand-500">*</span>
                </label>
                <div className="relative">
                  <MdEmail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl bg-brand-500 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)] transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
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

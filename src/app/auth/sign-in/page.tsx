'use client';
import Link from 'next/link';
import { useState, FormEvent, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import {
  MdSchool,
  MdEmail,
  MdLock,
  MdWarningAmber,
  MdCheckCircle,
  MdPerson,
  MdChevronLeft,
} from 'react-icons/md';

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [contactName, setContactName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (searchParams.get('error') === 'auth_callback_failed') {
      setError('Authentication failed. Please try again.');
    }
    if (searchParams.get('verified') === '1') {
      setSuccess('Email confirmed! You can now sign in.');
    }
    if (searchParams.get('reset') === '1') {
      setSuccess('Password updated — sign in with your new password.');
    }
  }, [searchParams]);

  const supabase = createClient();

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        setError(
          'Your account is awaiting admin approval, or your email is not yet confirmed. ' +
            'Contact ssisayleule@gmail.com if you believe your account should be active.',
        );
      } else {
        setError(error.message);
      }
      setLoading(false);
      return;
    }

    try {
      const check = await fetch('/api/admin/schools');
      if (check.ok) {
        router.push('/school-admin');
        router.refresh();
        return;
      }
    } catch {
      /* not admin — fall through */
    }

    const next = searchParams.get('next') || '/';
    router.push(next);
    router.refresh();
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (!contactName.trim()) {
      setError('Please enter your full name.');
      setLoading(false);
      return;
    }
    if (!schoolName.trim()) {
      setError('Please enter your school name.');
      setLoading(false);
      return;
    }

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        school_name: schoolName.trim(),
        contact_name: contactName.trim(),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Could not create account. Please try again.');
      setLoading(false);
      return;
    }

    setSuccess(
      'Account created — awaiting admin approval. You can sign in once your account is approved.',
    );
    setMode('signin');
    setLoading(false);
  };

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m);
    setError('');
    setSuccess('');
  };

  /* ─────────────────────────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-screen font-dm">
      {/* ── Left panel: form ──────────────────────────────────────────────── */}
      <div className="flex w-full flex-col bg-white px-8 py-10 dark:bg-navy-900 lg:w-1/2 xl:px-16">
        {/* Back to Dashboard */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-400 transition hover:text-navy-700 dark:text-gray-500 dark:hover:text-white"
        >
          <MdChevronLeft className="text-lg" />
          Back to Dashboard
        </Link>

        {/* Vertically centre the form within the remaining space */}
        <div className="my-auto mx-auto w-full max-w-[420px] pt-10 pb-6">
          {/* Title */}
          <h1 className="text-[32px] font-bold leading-tight text-navy-900 dark:text-white">
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {mode === 'signin'
              ? 'Enter your email and password to sign in!'
              : 'Fill in the details below to register your school.'}
          </p>

          {/* Alerts */}
          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              <MdWarningAmber className="mt-0.5 shrink-0 text-base" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm text-green-800 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-200">
              <MdCheckCircle className="mt-0.5 shrink-0 text-base" />
              <span>{success}</span>
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
            className="mt-7 space-y-5"
          >
            {mode === 'signup' && (
              <>
                {/* Your name */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    Your name<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdPerson className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="text"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="e.g. Jane Doe"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>

                {/* School name */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    School name<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdSchool className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="text"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      placeholder="e.g. Greenfield Academy"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Email */}
            <div>
              <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                Email<span className="ml-0.5 text-brand-500">*</span>
              </label>
              <div className="relative">
                <MdEmail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={mode === 'signup' ? 'any@email.com' : 'mail@simmmple.com'}
                  className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-bold text-navy-900 dark:text-white">
                  Password<span className="ml-0.5 text-brand-500">*</span>
                </label>
                {mode === 'signin' && (
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs font-medium text-brand-500 hover:underline"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <MdLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Min. 8 characters' : 'Min. 8 characters'}
                  minLength={mode === 'signup' ? 8 : undefined}
                  className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 h-12 w-full rounded-xl bg-brand-500 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)] transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? mode === 'signin'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'signin'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>

          {/* Switch mode */}
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {mode === 'signin' ? (
              <>
                Not registered yet?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="font-bold text-brand-500 hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => switchMode('signin')}
                  className="font-bold text-brand-500 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Right panel: GradeWise branding ───────────────────────────────── */}
      <div className="hidden flex-col items-center justify-center bg-gradient-to-br from-[#4318FF] via-[#5e35e0] to-[#7B2FF7] lg:flex lg:w-1/2">
        {/* White logo circle */}
        <div className="relative mb-10 flex h-[170px] w-[170px] items-center justify-center">
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-[10px] border-white/20" />
          {/* Inner filled circle */}
          <div className="flex h-[130px] w-[130px] items-center justify-center rounded-full bg-white shadow-[0_0_60px_rgba(255,255,255,0.25)]">
            {/* GradeWise cap icon in brand colour */}
            <MdSchool className="text-[56px] text-[#4318FF]" />
          </div>
        </div>

        {/* Wordmark */}
        <p className="text-[40px] font-extrabold tracking-tight text-white">
          GradeWise
        </p>
        <p className="mt-2 text-base font-medium text-white/70">
          School Management System
        </p>

        {/* Info pill */}
        <div className="mt-12 rounded-2xl border border-white/20 bg-white/10 px-8 py-5 text-center backdrop-blur-sm">
          <p className="text-sm font-medium text-white/60">Manage smarter with</p>
          <p className="mt-0.5 text-lg font-bold text-white">gradewise.app</p>
        </div>
      </div>
    </div>
  );
}

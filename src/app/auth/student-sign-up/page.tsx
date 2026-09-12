'use client';
import Link from 'next/link';
import { useState, FormEvent } from 'react';
import {
  MdSchool,
  MdEmail,
  MdLock,
  MdPerson,
  MdBadge,
  MdKey,
  MdWarningAmber,
  MdCheckCircle,
  MdChevronLeft,
} from 'react-icons/md';

export default function StudentSignUp() {
  const [fullName,     setFullName]     = useState('');
  const [studentCode,  setStudentCode]  = useState('');
  const [schoolCode,   setSchoolCode]   = useState('');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/student-signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name:    fullName.trim(),
        student_code: studentCode.trim(),
        school_code:  schoolCode.trim().toUpperCase(),
        email:        email.trim(),
        password,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Could not create account. Please try again.');
      setLoading(false);
      return;
    }

    setLoading(false);
    setSuccess(true);
  };

  return (
    <div className="flex min-h-screen font-dm">
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div className="flex w-full flex-col bg-white px-8 py-10 dark:bg-navy-900 lg:w-1/2 xl:px-16">
        <Link
          href="/auth/sign-in"
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-400 transition hover:text-navy-700 dark:text-gray-500 dark:hover:text-white"
        >
          <MdChevronLeft className="text-lg" /> Back to Sign In
        </Link>

        <div className="my-auto mx-auto w-full max-w-[420px] pt-10 pb-6">

          {success ? (
            /* ── Success state ─────────────────────────────────────────────── */
            <div className="text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-green-50 text-3xl text-green-500 dark:bg-green-900/20">
                <MdCheckCircle />
              </div>
              <h1 className="mt-5 text-2xl font-bold text-navy-900 dark:text-white">
                Account created!
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                Your account is awaiting your teacher&apos;s approval.
                You&apos;ll be able to sign in once they approve your request.
              </p>
              <Link
                href="/auth/sign-in"
                className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-brand-500 px-8 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)] transition hover:bg-brand-600"
              >
                Go to Sign In
              </Link>
            </div>
          ) : (
            /* ── Sign-up form ──────────────────────────────────────────────── */
            <>
              <h1 className="text-[32px] font-bold leading-tight text-navy-900 dark:text-white">
                Student Sign Up
              </h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Create your GradeWise student portal account.
                You&apos;ll need your <strong>School Code</strong> and
                <strong> Student ID</strong> from your teacher.
              </p>

              {error && (
                <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                  <MdWarningAmber className="mt-0.5 shrink-0 text-base" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                {/* School Code */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    School Code<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdKey className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="text"
                      value={schoolCode}
                      onChange={e => setSchoolCode(e.target.value.toUpperCase())}
                      placeholder="e.g. GRN8K2"
                      maxLength={6}
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 font-mono text-sm uppercase text-navy-900 outline-none transition placeholder:normal-case placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Get this 6-character code from your teacher.
                  </p>
                </div>

                {/* Student ID */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    Student ID<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdBadge className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="text"
                      value={studentCode}
                      onChange={e => setStudentCode(e.target.value)}
                      placeholder="e.g. GA250801"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    This is the ID on your result sheet — check with your teacher.
                  </p>
                </div>

                {/* Full Name */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    Your Full Name<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdPerson className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="text"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="e.g. Amina Yusuf"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>

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
                      onChange={e => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-navy-900 dark:text-white">
                    Password<span className="ml-0.5 text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <MdLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400" />
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      minLength={8}
                      className="h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-xl bg-brand-500 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)] transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Creating account…' : 'Create Student Account'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Already have an account?{' '}
                <Link href="/auth/sign-in" className="font-bold text-brand-500 hover:underline">
                  Sign in
                </Link>
              </p>
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
        <p className="mt-2 text-base font-medium text-white/70">Student Portal</p>
        <div className="mt-12 max-w-xs rounded-2xl border border-white/20 bg-white/10 px-8 py-5 text-center backdrop-blur-sm">
          <p className="text-sm font-medium text-white/60">You need:</p>
          <ul className="mt-2 space-y-1 text-sm text-white/80">
            <li>📋 Your <strong>School Code</strong> from your teacher</li>
            <li>🪪 Your <strong>Student ID</strong> from your result sheet</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useRef, useState, FormEvent, KeyboardEvent } from 'react';
import {
  MdSchool,
  MdEmail,
  MdLock,
  MdPerson,
  MdBadge,
  MdKey,
  MdClass,
  MdPhone,
  MdWarningAmber,
  MdCheckCircle,
  MdChevronLeft,
} from 'react-icons/md';

// ── Shared input class ─────────────────────────────────────────────────────────
const inputCls = (extra = '') =>
  `h-12 w-full rounded-xl border border-gray-200 bg-lightPrimary pl-10 pr-4 text-sm text-navy-900 outline-none transition placeholder:text-gray-400 focus:border-brand-500 focus:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-navy-600 ${extra}`.trim();

// ── Field wrapper — defined OUTSIDE the page component so it never remounts ───
// Remounting destroys focus, which is what caused the "can't type" bug.
function Field({
  id,
  label,
  icon,
  hint,
  optional,
  children,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-bold text-navy-900 dark:text-white"
      >
        {label}
        {optional
          ? <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-500">(optional)</span>
          : <span className="ml-0.5 text-brand-500">*</span>
        }
      </label>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-gray-400">
            {icon}
          </span>
        )}
        {children}
      </div>
      {hint && (
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}

// ── Page component ─────────────────────────────────────────────────────────────
export default function StudentSignUp() {
  const [fullName,    setFullName]    = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [schoolCode,  setSchoolCode]  = useState('');
  const [grade,       setGrade]       = useState('');
  const [section,     setSection]     = useState('');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [parentName,  setParentName]  = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState(false);

  // ── Refs for Enter-to-next-field navigation ───────────────────────────────
  const refSchoolCode  = useRef<HTMLInputElement>(null);
  const refStudentCode = useRef<HTMLInputElement>(null);
  const refGrade       = useRef<HTMLInputElement>(null);
  const refSection     = useRef<HTMLInputElement>(null);
  const refFullName    = useRef<HTMLInputElement>(null);
  const refEmail       = useRef<HTMLInputElement>(null);
  const refPassword    = useRef<HTMLInputElement>(null);
  const refParentName  = useRef<HTMLInputElement>(null);
  const refParentPhone = useRef<HTMLInputElement>(null);
  const refSubmit      = useRef<HTMLButtonElement>(null);

  /** Focus the next element when Enter is pressed (unless it's the last field). */
  const next = (target: React.RefObject<HTMLInputElement | HTMLButtonElement | null>) =>
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (target.current as HTMLElement | null)?.focus();
      }
    };

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
        grade:        grade.trim(),
        section:      section.trim(),
        email:        email.trim(),
        password,
        parent_name:  parentName.trim() || undefined,
        parent_phone: parentPhone.trim() || undefined,
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
                Create your GradeWise student portal account. You&apos;ll need
                your <strong>School Code</strong>, <strong>Student ID</strong>,
                and your <strong>Grade</strong> and <strong>Section</strong>
                — all exactly as your teacher has them on record.
              </p>

              {error && (
                <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                  <MdWarningAmber className="mt-0.5 shrink-0 text-base" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-5">

                {/* School Code */}
                <Field
                  id="school-code"
                  label="School Code"
                  icon={<MdKey />}
                  hint="The 6-character code from your teacher."
                >
                  <input
                    ref={refSchoolCode}
                    id="school-code"
                    required
                    autoFocus
                    type="text"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value.toUpperCase())}
                    onKeyDown={next(refStudentCode)}
                    placeholder="e.g. GRN8K2"
                    maxLength={6}
                    className={inputCls('font-mono uppercase')}
                  />
                </Field>

                {/* Student ID */}
                <Field
                  id="student-id"
                  label="Student ID"
                  icon={<MdBadge />}
                  hint="The ID on your result sheet or school register (e.g. GA250801)."
                >
                  <input
                    ref={refStudentCode}
                    id="student-id"
                    required
                    type="text"
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    onKeyDown={next(refGrade)}
                    placeholder="e.g. GA250801"
                    className={inputCls()}
                  />
                </Field>

                {/* Grade + Section — side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id="grade"
                    label="Grade"
                    icon={<MdClass />}
                    hint='Enter just the number — e.g. 9 or 10 (not "Grade 9")'
                  >
                    <input
                      ref={refGrade}
                      id="grade"
                      required
                      type="text"
                      value={grade}
                      onChange={(e) => setGrade(e.target.value)}
                      onKeyDown={next(refSection)}
                      placeholder="e.g. 8"
                      className={inputCls()}
                    />
                  </Field>
                  <Field
                    id="section"
                    label="Section"
                    icon={<MdClass />}
                    hint="e.g. A, B, Gold"
                  >
                    <input
                      ref={refSection}
                      id="section"
                      required
                      type="text"
                      value={section}
                      onChange={(e) => setSection(e.target.value)}
                      onKeyDown={next(refFullName)}
                      placeholder="e.g. A"
                      className={inputCls()}
                    />
                  </Field>
                </div>

                {/* Full Name */}
                <Field id="full-name" label="Your Full Name" icon={<MdPerson />}>
                  <input
                    ref={refFullName}
                    id="full-name"
                    required
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onKeyDown={next(refEmail)}
                    placeholder="e.g. Amina Yusuf"
                    className={inputCls()}
                  />
                </Field>

                {/* Email */}
                <Field id="email" label="Email" icon={<MdEmail />}>
                  <input
                    ref={refEmail}
                    id="email"
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={next(refPassword)}
                    placeholder="your@email.com"
                    className={inputCls()}
                  />
                </Field>

                {/* Password */}
                <Field id="password" label="Password" icon={<MdLock />}>
                  <input
                    ref={refPassword}
                    id="password"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={next(refParentName)}
                    placeholder="Min. 8 characters"
                    minLength={8}
                    className={inputCls()}
                  />
                </Field>

                {/* Parent / Guardian Name */}
                <Field
                  id="parent-name"
                  label="Parent / Guardian Name"
                  icon={<MdPerson />}
                  hint="Optional — helps your teacher reach your family if needed."
                  optional
                >
                  <input
                    ref={refParentName}
                    id="parent-name"
                    type="text"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    onKeyDown={next(refParentPhone)}
                    placeholder="e.g. Fatuma Abdi"
                    className={inputCls()}
                  />
                </Field>

                {/* Parent / Guardian Phone */}
                <Field
                  id="parent-phone"
                  label="Parent / Guardian Phone"
                  icon={<MdPhone />}
                  hint="Optional — used only for emergency contact."
                  optional
                >
                  <input
                    ref={refParentPhone}
                    id="parent-phone"
                    type="tel"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        refSubmit.current?.click();
                      }
                    }}
                    placeholder="e.g. +251 911 234 567"
                    className={inputCls()}
                  />
                </Field>

                <button
                  ref={refSubmit}
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
          <p className="text-sm font-medium text-white/60">You need all four:</p>
          <ul className="mt-2 space-y-1 text-sm text-white/80">
            <li>🔑 <strong>School Code</strong> — from your teacher</li>
            <li>🪪 <strong>Student ID</strong> — on your result sheet</li>
            <li>📚 <strong>Grade</strong> — exactly as recorded</li>
            <li>🏷️ <strong>Section</strong> — exactly as recorded</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

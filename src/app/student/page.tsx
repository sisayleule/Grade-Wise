'use client';
import { useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import { MdSchool, MdLogout } from 'react-icons/md';

/**
 * /student — Student Portal placeholder.
 * Phase 2 only: establishes the route and account routing.
 * Real portal content is built in Phase 4.
 */
export default function StudentPortal() {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/sign-in');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-lightPrimary font-dm dark:bg-navy-900">
      <div className="w-full max-w-md px-4 py-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-blueSecondary text-3xl text-white shadow-[0_8px_24px_rgba(67,24,255,0.35)]">
          <MdSchool />
        </div>

        <h1 className="mt-6 text-2xl font-bold text-navy-900 dark:text-white">
          GradeWise
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Student Portal
        </p>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700">
            <MdSchool />
          </div>
          <h2 className="mt-4 text-lg font-bold text-navy-900 dark:text-white">
            Coming soon
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Your student portal is being set up. Your results will be
            available here once your teacher publishes them.
          </p>
        </div>

        <button
          onClick={handleSignOut}
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-white dark:border-navy-700 dark:text-gray-400 dark:hover:bg-navy-800"
        >
          <MdLogout /> Sign out
        </button>
      </div>
    </div>
  );
}

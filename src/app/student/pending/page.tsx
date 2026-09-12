'use client';
import { useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import { MdHourglassTop, MdLogout } from 'react-icons/md';

export default function StudentPending() {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/sign-in');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-lightPrimary font-dm dark:bg-navy-900">
      <div className="w-full max-w-md px-4 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-3xl text-amber-500 dark:bg-amber-900/20">
            <MdHourglassTop />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-navy-900 dark:text-white">
            Awaiting approval
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Your student portal account is awaiting your teacher&apos;s approval.
            You&apos;ll be able to access your results once they approve your request.
          </p>
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
            If you haven&apos;t heard back within 24 hours, contact your class teacher.
          </div>
          <button
            onClick={handleSignOut}
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-gray-400 dark:hover:bg-navy-700"
          >
            <MdLogout /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

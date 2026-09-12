'use client';
import { useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import { MdDoNotDisturbOn, MdLogout } from 'react-icons/md';

export default function StudentRejected() {
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
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-50 text-3xl text-red-500 dark:bg-red-900/20">
            <MdDoNotDisturbOn />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-navy-900 dark:text-white">
            Account not approved
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Your portal account request was not approved by your teacher.
            This may be because the Student ID or details you provided did not match
            their records.
          </p>
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
            Contact your class teacher to resolve this. They can re-activate your
            account if needed.
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

/** Loading UI for /student/contact — matches the skeleton in page.tsx. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading messages…">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
        <div className="h-4 w-72 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
      </div>
      {/* Form skeleton */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-navy-700 dark:bg-navy-800">
        <div className="mb-4 h-5 w-36 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
        <div className="mb-4 h-10 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-navy-800" />
        <div className="mb-2 h-24 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-navy-800" />
        <div className="h-10 w-32 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
      </div>
      {/* Thread list skeleton */}
      <div>
        <div className="mb-3 h-3 w-28 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
        {[1, 2].map((i) => (
          <div key={i} className="mb-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-navy-700 dark:bg-navy-800">
            <div className="flex gap-2">
              <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-gray-100 dark:bg-navy-800" />
            </div>
            <div className="mt-2 h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
            <div className="mt-1 h-3 w-24 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

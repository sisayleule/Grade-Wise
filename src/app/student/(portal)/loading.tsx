/**
 * Loading UI for the student profile page (/student).
 * Shown instantly when the Link is clicked — replaces page content while
 * the route segment and data load. Matches the inline skeleton in page.tsx.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-8" aria-busy="true" aria-label="Loading profile…">
      {/* Header card skeleton */}
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-8 shadow-[0_8px_24px_rgba(112,144,176,0.10)] dark:border-navy-700 dark:bg-navy-800 sm:flex-row">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
          <div className="h-7 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          <div className="h-4 w-32 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
        </div>
      </div>
      {/* Details grid skeleton */}
      <div>
        <div className="mb-3 h-3 w-20 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-lightPrimary p-4 dark:border-navy-700 dark:bg-navy-900/60">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-14 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                <div className="h-4 w-28 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Quick links skeleton */}
      <div>
        <div className="mb-3 h-3 w-24 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800">
              <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-28 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
                <div className="h-3 w-48 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

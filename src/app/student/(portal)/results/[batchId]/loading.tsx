/** Loading UI for /student/results/[batchId] — shown while the result detail loads. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-busy="true" aria-label="Loading result…">
      {/* Back + actions bar */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
        <div className="flex gap-2">
          <div className="h-9 w-36 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
          <div className="h-9 w-20 animate-pulse rounded-xl bg-gray-100 dark:bg-navy-800" />
        </div>
      </div>
      {/* Report card skeleton */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_8px_32px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 border-b-2 border-gray-100 px-4 py-6 text-center dark:border-navy-700">
          <div className="h-14 w-14 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
          <div className="h-6 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          <div className="h-4 w-32 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
        </div>
        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 px-4 py-5 sm:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
          ))}
        </div>
        {/* Table */}
        <div className="space-y-2 px-4 pb-4">
          <div className="h-9 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
          ))}
        </div>
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 px-4 py-6 sm:grid-cols-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-navy-800" />
          ))}
        </div>
      </div>
    </div>
  );
}

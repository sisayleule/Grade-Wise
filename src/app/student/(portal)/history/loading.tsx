/** Loading UI for /student/history — matches the inline skeleton in page.tsx. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading history…">
      <div className="space-y-2">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
        <div className="h-4 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
      </div>
      {[1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
          {[1, 2, 3].map((j) => (
            <div key={j} className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-700 dark:bg-navy-800">
              <div className="flex flex-col items-center gap-1 pt-1">
                <div className="h-3 w-3 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                <div className="h-10 w-px animate-pulse bg-gray-100 dark:bg-navy-700" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-4 w-28 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
                <div className="h-3 w-40 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
                <div className="h-3 w-20 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Loading UI for /student/results — matches the inline skeleton in page.tsx. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading results…">
      <div className="space-y-2">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
        <div className="h-4 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
            <div className="h-3 w-48 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
            <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
          </div>
          <div className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
        </div>
      ))}
    </div>
  );
}

/** Loading UI for /student/activities — matches the inline skeleton in page.tsx. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading activities…">
      <div className="space-y-2">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
        <div className="h-4 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="h-5 w-14 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                <div className="h-5 w-20 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
              </div>
              <div className="h-4 w-48 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
              <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
            </div>
            <div className="shrink-0 space-y-1 text-right">
              <div className="h-8 w-10 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
              <div className="h-3 w-14 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
            </div>
          </div>
          <div className="mt-4">
            <div className="h-2 w-full animate-pulse rounded-full bg-gray-100 dark:bg-navy-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

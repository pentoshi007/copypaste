export default function Loading() {
  return (
    <div className="flex flex-1 overflow-hidden" aria-busy="true">
      <aside className="hidden w-64 shrink-0 space-y-2 border-r border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-[#1c1c1c] md:block">
        <div className="mb-4 h-6 w-32 rounded bg-neutral-200 dark:bg-neutral-800 cp-skeleton" />
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            key={row}
            className="h-6 rounded bg-neutral-200/70 dark:bg-neutral-800 cp-skeleton"
            style={{ animationDelay: `${row * 90}ms`, width: `${85 - row * 7}%` }}
          />
        ))}
      </aside>
      <div className="flex-1">
        <div className="h-12" />
        <div className="mx-auto max-w-3xl space-y-4 px-6 pt-16 md:px-16">
          <div className="h-10 w-2/3 rounded bg-neutral-100 dark:bg-neutral-900 cp-skeleton" />
          <div className="h-4 w-full rounded bg-neutral-100 dark:bg-neutral-900 cp-skeleton" />
          <div className="h-4 w-5/6 rounded bg-neutral-100 dark:bg-neutral-900 cp-skeleton" />
          <div className="h-4 w-3/4 rounded bg-neutral-100 dark:bg-neutral-900 cp-skeleton" />
        </div>
      </div>
    </div>
  );
}

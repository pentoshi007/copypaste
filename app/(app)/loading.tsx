export default function Loading() {
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar skeleton */}
      <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 space-y-2">
        <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </aside>

      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 p-4 sm:p-6">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="h-6 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-40 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          </div>
        </div>
        <div className="border-t border-slate-200 dark:border-slate-800 p-4 sm:p-6">
          <div className="h-24 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        </div>
      </div>
    </div>
  );
}

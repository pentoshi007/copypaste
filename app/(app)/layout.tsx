import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ViewportFix from "@/components/ViewportFix";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  return (
    <div className="app-viewport flex flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <ViewportFix />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

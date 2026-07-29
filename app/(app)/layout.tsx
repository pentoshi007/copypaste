import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Header from "@/components/Header";
import ViewportFix from "@/components/ViewportFix";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    // `app-viewport` pins this shell to the visual viewport (see globals.css)
    // so the composer stays above the mobile keyboard instead of being pushed
    // off-screen into a clipped, unscrollable area.
    <div className="app-viewport flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <ViewportFix />
      <Header username={session.user.name ?? "user"} />
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        {children}
      </main>
    </div>
  );
}

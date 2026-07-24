import Link from "next/link";
import Logo from "@/components/Logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 dark:from-slate-950 dark:to-slate-900 px-4">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <Logo className="w-9 h-9" />
        <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
          CopyPaste
        </span>
      </Link>
      {children}
    </div>
  );
}

import { after } from "next/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import dbConnect from "@/lib/db";
import Workspace from "@/components/workspace/Workspace";
import { createPageDocument, listActivePages, loadPageBlocks } from "@/lib/server/pages";
import { purgeExpired } from "@/lib/server/purge";
import { isObjectId } from "@/lib/guards";
import type { Block, Page } from "@/lib/types";

export const dynamic = "force-dynamic";

function mostRecent(pages: Page[]): Page | undefined {
  return pages.reduce<Page | undefined>(
    (latest, page) => (!latest || page.updatedAt > latest.updatedAt ? page : latest),
    undefined,
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const { p } = await searchParams;
  const requested = isObjectId(p) ? p : null;

  await dbConnect();
  let pages = await listActivePages(userId);
  if (pages.length === 0) {
    pages = [await createPageDocument(userId, { parentId: null, title: "", icon: "" })];
  }

  const active = (requested && pages.find((page) => page._id === requested)) || mostRecent(pages) || null;
  const blocks: Block[] = active ? await loadPageBlocks(userId, active._id) : [];

  after(() => purgeExpired(userId));

  return (
    <Workspace
      username={session?.user?.name ?? "user"}
      initialPages={pages}
      initialPageId={active?._id ?? null}
      initialBlocks={blocks}
    />
  );
}

import { toast } from "sonner";

export type SyncStatus = "idle" | "saving" | "error";

type Task = () => Promise<boolean>;

const RETRY_DELAYS_MS = [800, 2000, 5000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runWithRetries(task: Task, retries: number): Promise<boolean> {
  for (let tries = 0; ; tries++) {
    try {
      return await task();
    } catch {
      if (tries >= retries) {
        toast.error("You seem to be offline — some changes weren't saved");
        return false;
      }
      await wait(RETRY_DELAYS_MS[tries]);
    }
  }
}

class SyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private failed = false;
  private status: SyncStatus = "idle";
  private readonly listeners = new Set<() => void>();

  enqueue(task: Task, options: { idempotent?: boolean } = {}): Promise<boolean> {
    this.pending += 1;
    this.publish();

    const retries = options.idempotent === false ? 0 : RETRY_DELAYS_MS.length;
    const run = this.tail.then(() => runWithRetries(task, retries));
    this.tail = run.then((ok) => {
      this.pending -= 1;
      if (!ok) this.failed = true;
      else if (this.pending === 0) this.failed = false;
      this.publish();
    });
    return run;
  }

  idle(): Promise<void> {
    return this.tail;
  }

  isBusy(): boolean {
    return this.pending > 0;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = (): SyncStatus => this.status;

  private publish() {
    const next: SyncStatus = this.pending > 0 ? "saving" : this.failed ? "error" : "idle";
    if (next === this.status) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }
}

export const syncQueue = new SyncQueue();

export function reportFailure<T extends { ok: boolean; error?: string }>(result: T): boolean {
  if (!result.ok) toast.error(result.error ?? "Something went wrong");
  return result.ok;
}

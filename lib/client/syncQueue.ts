import { toast } from "sonner";

export type SyncStatus = "idle" | "saving" | "error";

type Task = () => Promise<boolean>;

const RETRY_DELAYS_MS = [800, 2000, 5000];
const OFFLINE_TOAST_INTERVAL_MS = 15_000;

let lastOfflineToast = 0;

function announceOffline() {
  const now = Date.now();
  if (now - lastOfflineToast < OFFLINE_TOAST_INTERVAL_MS) return;
  lastOfflineToast = now;
  toast.error("You seem to be offline — changes will be retried");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runWithRetries(task: Task, retries: number): Promise<boolean | "gave-up"> {
  for (let tries = 0; ; tries++) {
    try {
      return await task();
    } catch {
      if (tries >= retries) {
        announceOffline();
        return "gave-up";
      }
      await wait(RETRY_DELAYS_MS[tries]);
    }
  }
}

class SyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private failed = false;
  private unsaved = 0;
  private status: SyncStatus = "idle";
  private readonly listeners = new Set<() => void>();

  enqueue(task: Task, options: { idempotent?: boolean; onGiveUp?: () => void } = {}): Promise<boolean> {
    this.pending += 1;
    this.publish();

    const retries = options.idempotent === false ? 0 : RETRY_DELAYS_MS.length;
    const run = this.tail.then(async () => {
      const outcome = await runWithRetries(task, retries);
      if (outcome === "gave-up") options.onGiveUp?.();
      return outcome === true;
    });
    this.tail = run.then((ok) => {
      this.pending -= 1;
      if (!ok) this.failed = true;
      else if (this.pending === 0 && this.unsaved === 0) this.failed = false;
      this.publish();
    });
    return run;
  }

  setUnsaved(delta: number) {
    this.unsaved = Math.max(0, this.unsaved + delta);
    if (this.unsaved > 0) this.failed = true;
    this.publish();
  }

  idle(): Promise<void> {
    return this.tail;
  }

  isBusy(): boolean {
    return this.pending > 0;
  }

  hasUnsaved(): boolean {
    return this.pending > 0 || this.unsaved > 0;
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

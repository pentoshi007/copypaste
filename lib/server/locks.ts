const queues = new Map<string, Promise<unknown>>();

export async function withUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(userId, settled);
  try {
    return await run;
  } finally {
    if (queues.get(userId) === settled) queues.delete(userId);
  }
}

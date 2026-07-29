/**
 * A tiny bridge between the navbar's refresh button and the app shell.
 *
 * The button lives in `Header`, which is rendered by the (app) layout, while the
 * chats and notes it refreshes live in `AppShell`, rendered by the page. They're
 * siblings, so there's no prop path between them and no shared provider. Rather
 * than hoist all of AppShell's state into a context just to drive one button,
 * the two talk through this module: Header fires a request and reads the busy
 * flag, AppShell handles the request and sets the flag.
 *
 * Both halves are client components in the same bundle, so this is a plain
 * module-level store — no React context, no re-render of the tree in between.
 */

type Listener = () => void;

const requestListeners = new Set<Listener>();
const stateListeners = new Set<Listener>();

let refreshing = false;

/** Registers the handler that performs the refresh. Returns an unsubscriber. */
export function onRefreshRequest(handler: Listener): () => void {
  requestListeners.add(handler);
  return () => {
    requestListeners.delete(handler);
  };
}

/** Asks whoever is listening to refetch. No-op if nothing is mounted yet. */
export function requestRefresh(): void {
  for (const handler of requestListeners) handler();
}

// --- Busy flag, shaped for useSyncExternalStore ----------------------------

export function subscribeRefreshing(callback: Listener): () => void {
  stateListeners.add(callback);
  return () => {
    stateListeners.delete(callback);
  };
}

export function getRefreshing(): boolean {
  return refreshing;
}

/** Nothing is in flight during a server render. */
export function getRefreshingServerSnapshot(): boolean {
  return false;
}

export function setRefreshing(value: boolean): void {
  if (refreshing === value) return;
  refreshing = value;
  for (const callback of stateListeners) callback();
}

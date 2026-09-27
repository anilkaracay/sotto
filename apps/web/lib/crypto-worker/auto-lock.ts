// Auto lock (10 section 3): lock after 15 minutes without activity or 5 minutes after the tab is
// hidden. While an execution or a proof holds the lock open, neither timer fires; they restart when the
// last hold is released.
export const IDLE_LOCK_MS = 15 * 60 * 1000;
export const HIDDEN_LOCK_MS = 5 * 60 * 1000;

type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export function createAutoLock(options: {
  onLock: () => void;
  idleMs?: number;
  hiddenMs?: number;
  timers?: Timers;
}) {
  const idleMs = options.idleMs ?? IDLE_LOCK_MS;
  const hiddenMs = options.hiddenMs ?? HIDDEN_LOCK_MS;
  const timers: Timers = options.timers ?? {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let idleTimer: unknown = null;
  let hiddenTimer: unknown = null;
  let hidden = false;
  let holds = 0;
  let stopped = false;

  const clearAll = () => {
    if (idleTimer !== null) timers.clear(idleTimer);
    if (hiddenTimer !== null) timers.clear(hiddenTimer);
    idleTimer = null;
    hiddenTimer = null;
  };

  const lock = () => {
    if (stopped) return;
    stop();
    options.onLock();
  };

  const arm = () => {
    clearAll();
    if (stopped || holds > 0) return;
    idleTimer = timers.set(lock, idleMs);
    if (hidden) hiddenTimer = timers.set(lock, hiddenMs);
  };

  function stop(): void {
    stopped = true;
    clearAll();
  }

  arm();
  return {
    /** Pointer or key activity in the tab. */
    activity: () => {
      if (!hidden) arm();
    },
    visibility: (isHidden: boolean) => {
      hidden = isHidden;
      arm();
    },
    /** Keeps the keys open during an execution or proof; call the returned function when done. */
    hold: () => {
      holds += 1;
      clearAll();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        arm();
      };
    },
    stop,
  };
}

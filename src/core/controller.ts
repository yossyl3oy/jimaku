// Decides whether the translated captions should run, from "the video open now" and "jimaku on/off".
// The work itself (fetching captions, display, translation) comes in from outside as start, so it can be tested without a DOM.

// onMounted is called once the display is up.
// If start returns normally without mounting (no captions to translate, etc.), don't retry. It starts again the next time the same video opens or jimaku is turned on.
// If start throws (a network failure, etc.), it retries automatically at the retryDelays intervals.
export type StartFn = (videoId: string, signal: AbortSignal, onMounted: () => void) => Promise<void>;

export type ControllerOptions = {
  onError?: (error: unknown) => void;
  retryDelays?: readonly number[];
  // How to wait. Tests swap in one that doesn't need time to pass
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

type Running = { videoId: string; controller: AbortController; mounted: boolean; attempt: number };

const defaultWait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

export const createController = (start: StartFn, options: ControllerOptions = {}) => {
  const { onError, retryDelays = [3000, 10000, 30000], wait = defaultWait } = options;
  let enabled = true;
  let videoId: string | null = null;
  let running: Running | null = null;

  const launch = async (entry: Running) => {
    const { signal } = entry.controller;
    try {
      await start(entry.videoId, signal, () => (entry.mounted = true));
    } catch (error) {
      if (signal.aborted) return;
      onError?.(error);
      const delay = retryDelays[entry.attempt];
      if (running === entry && !entry.mounted && delay !== undefined) {
        try {
          await wait(delay, signal);
        } catch {
          return;
        }
        if (running !== entry) return;
        running = { ...entry, controller: new AbortController(), attempt: entry.attempt + 1 };
        void launch(running);
        return;
      }
    }
    if (running === entry && !entry.mounted) running = null;
  };

  const sync = () => {
    const want = enabled ? videoId : null;
    if (running?.videoId === want) return;
    running?.controller.abort();
    running = null;
    if (!want) return;
    running = { videoId: want, controller: new AbortController(), mounted: false, attempt: 0 };
    void launch(running);
  };

  return {
    // A video was opened or changed (null when not on a video page)
    navigate(id: string | null) {
      videoId = id;
      sync();
    },
    setEnabled(on: boolean) {
      enabled = on;
      sync();
    },
    // Starts the current video again from scratch (after signing in, for example)
    restart() {
      running?.controller.abort();
      running = null;
      sync();
    },
    isEnabled: () => enabled,
  };
};

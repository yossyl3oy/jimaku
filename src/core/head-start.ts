// Starts a video's preparation a moment before it is asked for: when the pointer goes down on the jimaku button,
// before the click that turns jimaku on when it is released. The click then takes what the head start prepared (or is
// still preparing) instead of starting from scratch, which shortens TTFT by as long as the press lasted (around 0.1s
// with a mouse button, next to nothing with a tap on a trackpad).
// The work itself (prepare) comes in from outside, so this is testable without a DOM.
//
// - One video at a time. Another video, or drop() (leaving the video, a new target language), stops and forgets it
// - Taken once: turning jimaku on again, or a retry, prepares anew, as without a head start
// - A head start that fails is never handed over. The click then prepares in full, so start fails only as it did before

// early is true for a head start: prepare may then give up (throw) where the full way would wait or try harder
export type PrepareFn<T> = (videoId: string, signal: AbortSignal, early: boolean) => Promise<T>;

type Slot<T> = { videoId: string; controller: AbortController; result: Promise<T> };

export const createHeadStart = <T>(prepare: PrepareFn<T>) => {
  let slot: Slot<T> | null = null;

  const drop = () => {
    slot?.controller.abort();
    slot = null;
  };

  return {
    // Starts preparing the video, unless its head start is already there
    begin(videoId: string) {
      if (slot?.videoId === videoId) return;
      drop();
      const controller = new AbortController();
      const entry: Slot<T> = { videoId, controller, result: (async () => prepare(videoId, controller.signal, true))() };
      slot = entry;
      // A failed one is forgotten, so the next begin tries again
      entry.result.catch(() => {
        if (slot === entry) slot = null;
      });
    },

    // The video's preparation: its head start if there is one (from then on it stops with signal), else a full one
    take(videoId: string, signal: AbortSignal): Promise<T> {
      const entry = slot;
      slot = null;
      if (entry?.videoId !== videoId) {
        entry?.controller.abort();
        return prepare(videoId, signal, false);
      }
      const stop = () => entry.controller.abort(signal.reason);
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
      return entry.result
        .catch(() => {
          signal.throwIfAborted();
          return prepare(videoId, signal, false);
        })
        .finally(() => signal.removeEventListener('abort', stop));
    },

    drop,
  };
};

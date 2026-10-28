// Measures how long the "…" placeholder lasted. The yardstick for shortening TTFT (time until the first translation is visible).
// The time comes from now, so tests can swap the clock.

export const createWaitMeter = (now: () => number) => {
  let pending: { index: number; since: number } | null = null;

  return {
    // Pass, every frame, the line being shown (or null) and whether its translation is shown.
    // Returns the wait (ms) only at the moment a waiting line gets its translation.
    observe(index: number | null, translated: boolean): number | null {
      if (index === null) {
        pending = null;
        return null;
      }
      if (!translated) {
        if (pending?.index !== index) pending = { index, since: now() };
        return null;
      }
      const waited = pending?.index === index ? now() - pending.since : null;
      pending = null;
      return waited;
    },
  };
};

/* lib/fetch-loop.js
 * Tracks one setInterval per distinct calendar-URL set so re-requests (a
 * module re-start, a browser reload without a server restart, etc.) reuse
 * and refresh the same timer instead of accumulating a new one each time.
 */

class FetchLoopManager {
  constructor() {
    this.loops = new Map();
  }

  static keyFor(config) {
    const calendars = (config && config.calendars) || [];
    return JSON.stringify(calendars.map((c) => c && c.url));
  }

  // Starts (or restarts) the fetch loop for this calendar set. Always
  // triggers one immediate fetch, then re-fetches every config.interval ms.
  start(config, fetchAllFn, setIntervalFn = setInterval, clearIntervalFn = clearInterval) {
    const key = FetchLoopManager.keyFor(config);

    if (this.loops.has(key)) {
      clearIntervalFn(this.loops.get(key));
      this.loops.delete(key);
    }

    fetchAllFn(config);

    const interval = (config && config.interval) || 5 * 60 * 1000;
    const timer = setIntervalFn(() => fetchAllFn(config), interval);
    this.loops.set(key, timer);
    return key;
  }

  stopAll(clearIntervalFn = clearInterval) {
    for (const timer of this.loops.values()) clearIntervalFn(timer);
    this.loops.clear();
  }
}

module.exports = { FetchLoopManager };

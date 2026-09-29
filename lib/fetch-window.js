/* lib/fetch-window.js
 * Computes the local-midnight-anchored window node_helper expands recurring
 * events over. Must track the front end's display window (startOffsetDays,
 * which can be negative, through numDays) rather than a fixed "today..+60",
 * while still guaranteeing at least a 60-day lookahead so a short display
 * window doesn't starve the client-side cache.
 */

const MIN_FETCH_DAYS = 60;

function computeFetchWindow(config, now = new Date()) {
  const startOffsetDays = Number(config && config.startOffsetDays) || 0;
  const numDays = Number(config && config.numDays) || 1;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const startDays = Math.min(0, startOffsetDays);
  const endDays = Math.max(MIN_FETCH_DAYS, startOffsetDays + numDays + 1);

  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() + startDays);

  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + endDays);

  return { windowStart, windowEnd };
}

module.exports = { computeFetchWindow, MIN_FETCH_DAYS };

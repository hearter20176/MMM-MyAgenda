/* lib/agenda-state.js
 * Pure helper for turning per-source fetch status (ok / error / stale-cache)
 * into the lines MMM-MyAgenda.js renders. No DOM access here so it can be
 * loaded both in the browser (via Module.getScripts) and under node --test.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MyAgendaState = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function formatAge(ms) {
    const hours = Math.max(1, Math.round(ms / 3600000));
    return `${hours}h`;
  }

  // errors: Map<sourceName, { error?: string, stale?: boolean, cachedAgeMs?: number }>
  // hasEvents: whether any event is currently available to display.
  function buildStatusLines(errors, hasEvents) {
    const errorLines = [];
    const warnLines = [];
    let anyFailed = false;

    if (errors && typeof errors.forEach === "function") {
      errors.forEach((info, sourceName) => {
        if (!info) return;
        if (info.error) {
          anyFailed = true;
          errorLines.push(`Calendar unavailable: ${sourceName} (${info.error})`);
        } else if (info.stale) {
          warnLines.push(`Offline, showing data from ${formatAge(info.cachedAgeMs || 0)} ago (${sourceName})`);
        }
      });
    }

    if (hasEvents && anyFailed) {
      warnLines.unshift("Some calendars failed to update");
    }

    // Stale-cache warnings apply whether or not the cache happened to have
    // any events left in the current display window, so they're returned
    // unconditionally (only the "some calendars failed" summary line is
    // gated on hasEvents, above).
    return {
      showError: anyFailed && !hasEvents,
      errorLines,
      warnLines
    };
  }

  return { buildStatusLines, formatAge };
});

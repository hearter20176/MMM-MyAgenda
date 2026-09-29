/* lib/ics-expand.js
 * Pure RRULE expansion for node-ical's parseICS() output: honours EXDATE
 * (cancelled instances) and RECURRENCE-ID overrides (moved/edited instances),
 * and does full-day detection. Server-side only (required by node_helper.js),
 * no dependency on the "node_helper" or "logger" MagicMirror shims so it can
 * be unit tested directly with node --test.
 */

function detectFullDay(start, end, icalEvent) {
  if (!start || !end) return false;
  const ev = icalEvent || {};

  // 1) DATE-type events (no specific time) are always full-day.
  if (ev.datetype === "date" || ev.datetype === "DATE") return true;

  // 2) Identical start/end timestamp -> treat as full-day.
  if (start.getTime() === end.getTime()) return true;

  // 3) Duration approx 24 hours, starting in the small hours (covers
  //    all-day events exported with a local midnight offset).
  const diffH = (end - start) / 3600000;
  if (diffH >= 23.5 && diffH <= 24.5) {
    const h = start.getHours();
    if (h >= 0 && h <= 3) return true;
  }

  return false;
}

function dateKeyUTC(d) {
  return d.toISOString().slice(0, 10);
}

// All-day (DATE-only) RRULE instances: rebuild from the UTC calendar date so
// the instance doesn't drift a day west of UTC.
function rebuildDateOnlyInstant(dt) {
  return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

// Expand a single parsed VEVENT (recurring or not) into concrete instances
// within [windowStart, windowEnd].
function expandEvent(ev, name, windowStart, windowEnd) {
  const events = [];
  if (!ev || ev.type !== "VEVENT") return events;

  // Overrides (RECURRENCE-ID) are normally folded into the parent's
  // `recurrences` map by node-ical rather than surfacing as their own
  // top-level entry, but guard against them appearing standalone anyway so
  // they aren't double-counted alongside the base RRULE expansion.
  if (ev.recurrenceid) return events;

  const start = ev.start ? new Date(ev.start) : null;
  const end = ev.end ? new Date(ev.end) : null;
  if (!start || !end) return events;

  if (!ev.rrule) {
    events.push({
      title: ev.summary || "",
      description: ev.description || "",
      startDate: start.getTime(),
      endDate: end.getTime(),
      isFullday: detectFullDay(start, end, ev),
      calendar: name
    });
    return events;
  }

  const duration = end - start;
  const dates = ev.rrule.between(windowStart, windowEnd, true);

  dates.forEach((dt) => {
    const key = dateKeyUTC(dt);

    // Cancelled instance -> drop it entirely.
    if (ev.exdate && ev.exdate[key]) return;

    // Moved/edited instance -> use the override's own fields instead of the
    // original-time occurrence, so it isn't shown twice.
    if (ev.recurrences && ev.recurrences[key]) {
      const override = ev.recurrences[key];
      const oStart = override.start ? new Date(override.start) : dt;
      const oEnd = override.end ? new Date(override.end) : new Date(oStart.getTime() + duration);
      events.push({
        title: override.summary || ev.summary || "",
        description: override.description || ev.description || "",
        startDate: oStart.getTime(),
        endDate: oEnd.getTime(),
        isFullday: detectFullDay(oStart, oEnd, override),
        calendar: name
      });
      return;
    }

    let instStart = new Date(dt);
    let instEnd = new Date(instStart.getTime() + duration);
    if (ev.datetype === "date") {
      instStart = rebuildDateOnlyInstant(dt);
      instEnd = new Date(instStart.getTime() + duration);
    }

    events.push({
      title: ev.summary || "",
      description: ev.description || "",
      startDate: instStart.getTime(),
      endDate: instEnd.getTime(),
      isFullday: detectFullDay(instStart, instEnd, ev),
      calendar: name
    });
  });

  return events;
}

// Expand every VEVENT in a node-ical parseICS() result.
function expandCalendar(parsed, name, windowStart, windowEnd) {
  let events = [];
  Object.values(parsed || {}).forEach((ev) => {
    events = events.concat(expandEvent(ev, name, windowStart, windowEnd));
  });
  return events;
}

module.exports = { expandEvent, expandCalendar, detectFullDay, dateKeyUTC };

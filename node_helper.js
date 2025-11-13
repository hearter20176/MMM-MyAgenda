/* Node Helper for MMM-MyAgenda
 * Robust ICS fetching + local all-day normalization
 */

const NodeHelper = require("node_helper");
const ical = require("ical");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

module.exports = NodeHelper.create({
  start() {
    console.log("[MMM-MyAgenda Helper] Started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_I_C_FETCH") {
      this.fetchCalendars(payload);
    }
  },

  async fetchCalendars(config) {
    if (!config || !Array.isArray(config.calendars)) return;
    for (const cal of config.calendars) {
      const name = cal.name || cal.url || "Unnamed";
      try {
        const res = await fetch(cal.url);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        const events = this.parseICS(text, name);
        this.sendSocketNotification("MYAG_ICS_EVENTS", {
          sourceName: name,
          events: JSON.parse(JSON.stringify(events))
        });
      } catch (err) {
        console.error(`[MMM-MyAgenda Helper] Error fetching ${name}: ${err.message}`);
        this.sendSocketNotification("MYAG_ICS_ERROR", { sourceName: name, error: err.message });
      }
    }
  },

  parseICS(rawText, calendarName) {
    const parsed = ical.parseICS(rawText);
    const events = [];
  
    for (const k in parsed) {
      const ev = parsed[k];
      if (!ev || ev.type !== "VEVENT") continue;
  
      let start = ev.start ? new Date(ev.start) : null;
      let end = ev.end ? new Date(ev.end) : null;
      if (!start || isNaN(start)) continue;
      if (!end || isNaN(end)) end = new Date(start.getTime() + 3600000);
  
      const durationHrs = (end - start) / 3600000;
  
      // --- Robust full-day detection ---
      let isFullDay = false;
  
      // 1. Explicit VALUE=DATE or similar flag
      if (ev.datetype === "date" || (ev.type === "VEVENT" && ev.start && ev.start.dateOnly)) {
        isFullDay = true;
      }
  
      // 2. Spans >= 23 hours and <= 25 hours → typical all-day
      if (durationHrs >= 23 && durationHrs <= 25) {
        isFullDay = true;
      }
  
      // 3. Midnight-to-midnight (UTC or local)
      const localStart = new Date(start);
      const localEnd = new Date(end);
      if (
        (localStart.getHours() === 0 && localStart.getMinutes() === 0) &&
        (localEnd.getHours() === 0 && localEnd.getMinutes() === 0) &&
        durationHrs <= 24.5
      ) {
        isFullDay = true;
      }
  
      // --- Normalize all-day to local midnight boundaries ---
      if (isFullDay) {
        const normStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
        const normEnd = new Date(normStart);
        normEnd.setDate(normEnd.getDate() + 1);
        start = normStart;
        end = normEnd;
      }
  
      events.push({
        title: ev.summary || "",
        description: ev.description || "",
        startDate: start.getTime(),
        endDate: end.getTime(),
        isFullday: isFullDay,
        calendar: calendarName
      });
    }
  
    return events;
  }
});

const NodeHelper = require("node_helper");
const ical = require("ical");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

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
    for (const cal of config.calendars) {
      if (!cal.url) continue;

      const name = cal.name || "Unnamed";

      try {
        const response = await fetch(cal.url);
        const text = await response.text();
        const events = this.parseICS(text, name);

        this.sendSocketNotification("MYAG_ICS_EVENTS", {
          sourceName: name,
          events
        });
      } catch (err) {
        console.error(`[MMM-MyAgenda] Error fetching ${name}:`, err);
      }
    }
  },

  parseICS(data, sourceName) {
    const raw = ical.parseICS(data);
    const events = [];

    for (const key in raw) {
      const ev = raw[key];
      if (!ev || ev.type !== "VEVENT") continue;

      let start = new Date(ev.start);
      let end = new Date(ev.end);

      if (isNaN(start.getTime())) continue;
      if (isNaN(end.getTime())) end = new Date(start.getTime());

      const durationMs = end - start;

      let isFullday = false;

      if (ev.datetype === "date") {
        isFullday = true;
      } else if (durationMs === 0) {
        isFullday = true;
      } else {
        const hours = durationMs / (1000 * 60 * 60);
        if (hours >= 23.5 && hours <= 24.5) isFullday = true;
      }

      events.push({
        title: ev.summary || "",
        description: ev.description || "",
        startDate: start.getTime(),
        endDate: end.getTime(),
        isFullday,
        calendarName: sourceName
      });
    }

    return events;
  }
});

/* global require, module */
const NodeHelper = require("node_helper");
const ical = require("ical");
const fetch = require("node-fetch"); // fallback for remote ICS fetches
const logPrefix = "[MMM-MyAgenda Helper]";

module.exports = NodeHelper.create({
  start: function () {
    this.feeds = {};
    this.timers = {};
    console.log(`${logPrefix} Node helper started`);
  },

  stop: function () {
    for (const k in this.timers) clearInterval(this.timers[k]);
    console.log(`${logPrefix} stopped`);
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "MYAG_I_C_FETCH") {
      this.setupFeeds(payload);
    }
  },

  setupFeeds: function (config) {
    if (!config || !Array.isArray(config.calendars)) return;
    const interval = config.interval || 1000 * 60 * 30;
    const userAgent = config.userAgent || "MMM-MyAgenda/1.1 (ical parser)";

    config.calendars.forEach((cal) => {
      const name = cal.name || cal.url;
      if (this.timers[name]) clearInterval(this.timers[name]);

      this.fetchCalendar(cal, userAgent)
        .then((events) => this.sendSocketNotification("MYAG_ICS_EVENTS", { sourceName: name, events }))
        .catch((err) => this._sendError(name, err));

      this.timers[name] = setInterval(() => {
        this.fetchCalendar(cal, userAgent)
          .then((events) => this.sendSocketNotification("MYAG_ICS_EVENTS", { sourceName: name, events }))
          .catch((err) => this._sendError(name, err));
      }, interval);

      console.log(`${logPrefix} Registered calendar: ${name}, update every ${interval / 60000} min`);
    });
  },

  async fetchCalendar(cal, userAgent) {
    try {
      const response = await fetch(cal.url, {
        headers: { "User-Agent": userAgent, "Cache-Control": "no-cache" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();

      const parsed = ical.parseICS(text);
      const events = [];

      for (const key in parsed) {
        const ev = parsed[key];
        if (ev.type !== "VEVENT") continue;

        let start = ev.start instanceof Date ? ev.start.getTime() : null;
        let end = ev.end instanceof Date ? ev.end.getTime() : start;

        // Handle recurring events (ical automatically expands recurrences)
        if (ev.rrule) {
          const now = new Date();
          const windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const windowEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
          const dates = ev.rrule.between(windowStart, windowEnd, true, () => true);

          for (const date of dates) {
            const duration = ev.end.getTime() - ev.start.getTime();
            const eStart = date.getTime();
            const eEnd = eStart + duration;

            // skip EXDATEs
            if (ev.exdate && Object.values(ev.exdate).find((ex) => +ex === +date)) continue;

            events.push({
              title: ev.summary || "Untitled",
              startDate: eStart,
              endDate: eEnd,
              description: ev.description || "",
              location: ev.location || "",
              calendar: cal.name,
              color: cal.color,
              icon: cal.icon,
              isFullday: isFullDay(ev),
            });
          }
        } else {
          // Non-recurring
          events.push({
            title: ev.summary || "Untitled",
            startDate: start,
            endDate: end,
            description: ev.description || "",
            location: ev.location || "",
            calendar: cal.name,
            color: cal.color,
            icon: cal.icon,
            isFullday: isFullDay(ev),
          });
        }
      }

      return events.sort((a, b) => a.startDate - b.startDate);
    } catch (err) {
      this._sendError(cal.name, err);
      return [];
    }
  },

  _sendError(name, err) {
    console.error(`${logPrefix} Error fetching ${name}: ${err.message}`);
    this.sendSocketNotification("MYAG_ICS_ERROR", { sourceName: name, error: String(err) });
  },
});

function isFullDay(ev) {
  if (!ev.start || !ev.end) return false;
  const dur = ev.end.getTime() - ev.start.getTime();
  return dur >= 86400000 && ev.start.getUTCHours() === 0;
}

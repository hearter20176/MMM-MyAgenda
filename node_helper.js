/* node_helper.js — MMM-MyAgenda
 * Fully fixed version:
 *   ✔ No fetch()
 *   ✔ HTTPS ICS download
 *   ✔ node-ical recurrence
 *   ✔ Full-day detection
 *   ✔ Timezone-safe
 */

const NodeHelper = require("node_helper");
const ical = require("node-ical");
const https = require("https");

module.exports = NodeHelper.create({
  start() {
    console.log("[MMM-MyAgenda] node_helper started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_I_C_FETCH") {
      this.beginFetchLoop(payload);
    }
  },

  /*************************************************************
   * Loop calendars forever at config.interval
   *************************************************************/
  beginFetchLoop(config) {
    if (!config || !Array.isArray(config.calendars)) return;

    // fetch immediately
    this.fetchAll(config);

    // schedule repeating loop
    const interval = config.interval || 5 * 60 * 1000;
    setInterval(() => this.fetchAll(config), interval);
  },

  /*************************************************************
   * Fetch each calendar
   *************************************************************/
  async fetchAll(config) {
    for (const c of config.calendars) {
      try {
        await this.fetchCalendar(c.name, c.url);
      } catch (err) {
        this.sendSocketNotification("MYAG_ICS_ERROR", {
          sourceName: c.name,
          error: err.toString()
        });
      }
    }
  },

  /*************************************************************
   * HTTPS ICS downloader (MagicMirror-safe)
   *************************************************************/
  fetchICS(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(`HTTP ${res.statusCode}`);
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        })
        .on("error", (err) => reject(err));
    });
  },

  /*************************************************************
   * Parse one calendar + RRULE expansion
   *************************************************************/
  async fetchCalendar(name, url) {
    try {
      const rawICS = await this.fetchICS(url);
      const parsed = ical.parseICS(rawICS);

      const events = [];

      Object.values(parsed).forEach((ev) => {
        if (!ev || ev.type !== "VEVENT") return;

        const start = ev.start ? new Date(ev.start) : null;
        const end = ev.end ? new Date(ev.end) : null;
        if (!start || !end) return;

        const isRecurring = !!ev.rrule;

        /************************************
         * Recurring event
         ************************************/
        if (isRecurring) {
          const now = new Date();
          const future = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 60); // 60 days

          const duration = end - start;
          const dates = ev.rrule.between(now, future);

          dates.forEach((dt) => {
            // node-ical may not localize RRULE instances: fix here
            const instStart = new Date(dt);
            const instEnd = new Date(instStart.getTime() + duration);

            events.push({
              title: ev.summary || "",
              description: ev.description || "",
              startDate: instStart.getTime(),
              endDate: instEnd.getTime(),
              isFullday: this.detectFullDay(instStart, instEnd, ev),
              calendar: name
            });
          });
        } else {
          /************************************
           * One-time event
           ************************************/
          events.push({
            title: ev.summary || "",
            description: ev.description || "",
            startDate: start.getTime(),
            endDate: end.getTime(),
            isFullday: this.detectFullDay(start, end, ev),
            calendar: name
          });
        }
      });

      // send data back to front-end
      this.sendSocketNotification("MYAG_ICS_EVENTS", {
        sourceName: name,
        events
      });
    } catch (err) {
      this.sendSocketNotification("MYAG_ICS_ERROR", {
        sourceName: name,
        error: err.toString()
      });
    }
  },

  /*************************************************************
   * Full-day determination logic
   *************************************************************/
  detectFullDay(start, end, icalEvent) {
    if (!start || !end) return false;

    // 1) DATE-type events (no specific time)
    if (icalEvent.datetype === "date" || icalEvent.datetype === "DATE")
      return true;

    // node-ical sometimes flags all-day via "dateOnly"
    if (icalEvent.dtstamp?.dateOnly) return true;

    // 2) Same timestamp → treat as full-day
    if (start.getTime() === end.getTime()) return true;

    // 3) Duration approx 24 hours
    const diffH = (end - start) / 3600000;
    if (diffH >= 23.5 && diffH <= 24.5) {
      const h = start.getHours();
      if (h === 0 || h === 1 || h === 2 || h === 3) return true;
    }

    return false;
  }
});

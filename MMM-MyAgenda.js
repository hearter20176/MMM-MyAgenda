/* global Module, Log */

Module.register("MMM-MyAgenda", {
  defaults: {
    useCalendarModule: false,
    calendars: [],
    animationSpeed: 1000,
    waitFetch: 5000,
    interval: 30 * 60 * 1000,
    startDayIndex: 0,
    endDayIndex: 7
  },

  eventPool: null,
  activeConfig: null,
  _ready: false,
  domObj: null,

  start() {
    Log.info(`[${this.name}] starting module`);
    this.eventPool = new Map();
    this.activeConfig = { ...this.defaults, ...this.config };

    if (!this.activeConfig.useCalendarModule && this.activeConfig.calendars.length) {
      this.sendSocketNotification("MYAG_I_C_FETCH", this.activeConfig);
    }

    setTimeout(() => {
      if (this.isDisplayed()) this.updateDom(this.activeConfig.animationSpeed);
    }, this.activeConfig.waitFetch);
  },

  isDisplayed() {
    return !this.hidden && this.data && this.data.position && this._ready;
  },

  getDom() {
    this._ready = true;

    const wrapper = document.createElement("div");
    wrapper.className = "MMM-MyAgenda";

    const card = document.createElement("div");
    card.className = "glass-card raised-edge";

    const header = document.createElement("div");
    header.className = "myag-header";
    header.innerText = this.data.header || "My Agenda";
    card.appendChild(header);

    const agenda = document.createElement("div");
    agenda.className = "myag-agenda";

    const events = this.getAllEvents();
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events";
      agenda.appendChild(empty);
    } else {
      events.forEach((ev) => {
        const eventEl = document.createElement("div");
        eventEl.className = "myag-event";
        if (ev.color) eventEl.style.borderLeftColor = ev.color;

        const left = document.createElement("div");
        left.className = "myag-left";

        const icon = document.createElement("span");
        icon.className = "myag-icon";
        icon.innerText = ev.icon || "🗓️";
        left.appendChild(icon);

        const title = document.createElement("span");
        title.className = "myag-title";
        title.innerText = ev.title;
        left.appendChild(title);

        const right = document.createElement("div");
        right.className = "myag-right";

        const time = document.createElement("span");
        const startNum = Number(ev.startDate);
        const endNum = Number(ev.endDate);
        const start = isNaN(startNum) ? null : new Date(startNum);
        const end = isNaN(endNum) ? null : new Date(endNum);

        if (!start || isNaN(start.getTime())) {
          time.innerText = "";
        } else if (ev.isFullday) {
          time.innerText = "All day";
        } else {
          const startStr = this.formatTime(start);
          const endStr = end && !isNaN(end.getTime()) ? this.formatTime(end) : "";
          time.innerText = `${startStr}${endStr ? "–" + endStr : ""}`;
        }

        right.appendChild(time);
        eventEl.appendChild(left);
        eventEl.appendChild(right);
        agenda.appendChild(eventEl);
      });
    }

    card.appendChild(agenda);
    wrapper.appendChild(card);
    this.domObj = wrapper;
    return wrapper;
  },

  formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  },

  getAllEvents() {
    let all = [];
    for (const [, list] of this.eventPool.entries()) all = all.concat(list);
    const now = Date.now();
    const end = now + 1000 * 60 * 60 * 24 * this.activeConfig.endDayIndex;
    return all.filter((e) => Number(e.startDate) <= end && Number(e.endDate) >= now);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_ICS_EVENTS") {
      if (!payload || !payload.sourceName) return;
      this.eventPool.set(payload.sourceName, JSON.parse(JSON.stringify(payload.events)));
      if (this.isDisplayed()) this.updateDom(this.activeConfig.animationSpeed);
    }
    if (notification === "MYAG_ICS_ERROR") {
      Log.error(`[${this.name}] ${payload.sourceName} fetch error: ${payload.error}`);
    }
  },

  notificationReceived(notification, payload) {
    if (notification === "CALENDAR_EVENTS" && this.activeConfig.useCalendarModule) {
      this.eventPool.set("core", payload);
      if (this.isDisplayed()) this.updateDom(this.activeConfig.animationSpeed);
    }
  },

  getStyles() {
    return [this.file("MMM-MyAgenda.css")];
  }
});

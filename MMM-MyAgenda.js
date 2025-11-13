/* global Module, Log */

Module.register("MMM-MyAgenda", {
  defaults: {
    useCalendarModule: false,
    calendars: [],
    animationSpeed: 1000,
    waitFetch: 5000,
    interval: 30 * 60 * 1000,
    startOffsetDays: 0,
    numDays: 7,
    maxTitleLength: 0,
    showDescription: true,
    maxDescriptionLength: 80,
    filterText: [] // array of strings to strip from titles
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
    const cfg = this.activeConfig;

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

    const grouped = this.groupEventsByDay(this.getAllEvents());
    const dayKeys = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));

    if (!dayKeys.length) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events";
      agenda.appendChild(empty);
    } else {
      dayKeys.forEach((day) => {
        const daySection = document.createElement("div");
        daySection.className = "myag-day-section";

        const dateHeader = document.createElement("div");
        dateHeader.className = "myag-date-header";
        const dateObj = new Date(day);
        dateHeader.innerText = dateObj.toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric"
        });
        daySection.appendChild(dateHeader);

        grouped[day].forEach((ev) => {
          const { icon, color } = this.getIconAndColor(ev.title);
          const eventEl = document.createElement("div");
          eventEl.className = "myag-event";
          eventEl.style.borderLeftColor = color;

          const left = document.createElement("div");
          left.className = "myag-left";

          const iconSpan = document.createElement("span");
          iconSpan.className = "myag-icon";
          iconSpan.style.color = color;
          iconSpan.textContent = icon;
          left.appendChild(iconSpan);

          const textWrap = document.createElement("div");
          textWrap.className = "myag-textwrap";

          // --- title cleanup ---
          let titleText = ev.title || "";
          cfg.filterText.forEach((pattern) => {
            const regex = new RegExp(pattern, "ig");
            titleText = titleText.replace(regex, "");
          });
          titleText = titleText.trim();

          if (cfg.maxTitleLength > 0 && titleText.length > cfg.maxTitleLength) {
            titleText = titleText.slice(0, cfg.maxTitleLength - 1) + "…";
          }

          const title = document.createElement("span");
          title.className = "myag-title";
          title.textContent = titleText;
          textWrap.appendChild(title);

          if (cfg.showDescription && ev.description) {
            let desc = ev.description.trim();
            if (cfg.maxDescriptionLength > 0 && desc.length > cfg.maxDescriptionLength) {
              desc = desc.slice(0, cfg.maxDescriptionLength - 1) + "…";
            }
            const descEl = document.createElement("div");
            descEl.className = "myag-desc";
            descEl.textContent = desc;
            textWrap.appendChild(descEl);
          }

          left.appendChild(textWrap);

          const right = document.createElement("div");
          right.className = "myag-right";
          const time = document.createElement("span");

          // --- Smart time rendering ---
          if (!this.isFullDayEvent(ev)) {
            const start = new Date(Number(ev.startDate));
            const end = new Date(Number(ev.endDate));
            const startStr = this.formatTime(start);
            const endStr = this.formatTime(end);
            time.textContent = startStr && endStr ? `${startStr}–${endStr}` : startStr;
          } else {
            time.textContent = "";
          }

          right.appendChild(time);
          eventEl.appendChild(left);
          eventEl.appendChild(right);
          daySection.appendChild(eventEl);
        });

        agenda.appendChild(daySection);
      });
    }

    card.appendChild(agenda);
    wrapper.appendChild(card);
    this.domObj = wrapper;
    return wrapper;
  },

  // --- Smart full-day detector ---
  isFullDayEvent(ev) {
    if (ev.isFullday) return true;
    const start = new Date(Number(ev.startDate));
    const end = new Date(Number(ev.endDate));
    if (isNaN(start) || isNaN(end)) return false;
    const diff = (end - start) / (1000 * 60 * 60); // in hours
    const startHour = start.getHours();
    // near 24h duration and start near midnight (handles TZ shifts)
    return diff >= 23.8 && diff <= 24.2 && startHour <= 5;
  },

  formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  },

  groupEventsByDay(events) {
    const grouped = {};
    events.forEach((e) => {
      const date = new Date(Number(e.startDate));
      if (isNaN(date)) return;
      const key = date.toISOString().split("T")[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    });
    return grouped;
  },

  getAllEvents() {
    let all = [];
    for (const [, list] of this.eventPool.entries()) all = all.concat(list);

    // --- Remove duplicates ---
    const seen = new Set();
    all = all.filter((ev) => {
      const key = `${(ev.title || "").toLowerCase()}_${ev.startDate}_${ev.endDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const cfg = this.activeConfig;
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() + cfg.startOffsetDays);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + cfg.numDays);
    end.setHours(23, 59, 59, 999);

    return all
      .filter((e) => Number(e.startDate) <= end.getTime() && Number(e.endDate) >= start.getTime())
      .sort((a, b) => a.startDate - b.startDate);
  },

  getIconAndColor(title = "") {
    const lower = title.toLowerCase();
    if (lower.includes("birthday") || lower.includes("anniversary"))
      return { icon: "🎂", color: "#f472b6" };
    if (lower.includes("meeting") || lower.includes("call") || lower.includes("zoom"))
      return { icon: "📞", color: "#3b82f6" };
    if (lower.includes("doctor") || lower.includes("dentist"))
      return { icon: "🏥", color: "#60a5fa" };
    if (lower.includes("math") || lower.includes("exam") || lower.includes("test"))
      return { icon: "🧮", color: "#a78bfa" };
    if (lower.includes("soccer") || lower.includes("game") || lower.includes("sport"))
      return { icon: "⚽", color: "#22c55e" };
    if (lower.includes("travel") || lower.includes("flight"))
      return { icon: "✈️", color: "#f59e0b" };
    return { icon: "🗓️", color: "#9ca3af" };
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

/* MagicMirror² Module: MMM-MyAgenda
 * Frosted iOS glass agenda with color-coded icons and full-day detection
 */

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
    filterText: [],
    debug: false,
    wrapEventTitles: true,
    maxTitleLength: "",
    calendarColors: {},
    iconMapping: {},
    keywordColors: {}
  },

  start() {
    this.eventPool = new Map();
    this.activeConfig = { ...this.defaults, ...this.config };
    if (!this.activeConfig.useCalendarModule && this.activeConfig.calendars.length) {
      this.sendSocketNotification("MYAG_I_C_FETCH", this.activeConfig);
    }
    setTimeout(() => this.updateDom(this.activeConfig.animationSpeed), this.activeConfig.waitFetch);
  },

  getDom() {
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
    const days = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

    if (!days.length) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events";
      agenda.appendChild(empty);
    } else {
      days.forEach((dayKey) => {
        const section = document.createElement("div");
        section.className = "myag-day-section";

        const [y, m, d] = dayKey.split("-").map((v) => Number(v));
        const dateObj = new Date(y, m - 1, d);
        const dateHeader = document.createElement("div");
        dateHeader.className = "myag-date-header";
        dateHeader.innerText = dateObj.toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric"
        });
        section.appendChild(dateHeader);

        grouped[dayKey].forEach((ev) => {
          let title = ev.title || "";
          (cfg.filterText || []).forEach((pattern) => {
            const regex = new RegExp(pattern, "ig");
            title = title.replace(regex, "");
          });
          title = title.trim();
          if (cfg.maxTitleLength > 0 && title.length > cfg.maxTitleLength)
            title = title.slice(0, cfg.maxTitleLength - 1) + "…";

          const { icon, color } = this.getIconAndColor(title);

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

          const titleEl = document.createElement("span");
          titleEl.className = "myag-title";
          titleEl.textContent = title;
          textWrap.appendChild(titleEl);

          if (cfg.showDescription && ev.description) {
            let desc = ev.description.trim();
            if (cfg.maxDescriptionLength > 0 && desc.length > cfg.maxDescriptionLength)
              desc = desc.slice(0, cfg.maxDescriptionLength - 1) + "…";
            const descEl = document.createElement("div");
            descEl.className = "myag-desc";
            descEl.textContent = desc;
            textWrap.appendChild(descEl);
          }

          left.appendChild(textWrap);

          const right = document.createElement("div");
          right.className = "myag-right";
          const timeSpan = document.createElement("span");

          if (!ev.isFullday) {
            const s = Number(ev.startDate);
            const e = Number(ev.endDate);
            const startDate = new Date(s);
            const endDate = new Date(e);
            const durationHrs = (endDate - startDate) / 3600000;
          
            // Treat any event longer than 23 hours as full-day visually
            if (durationHrs >= 23) {
              timeSpan.textContent = ""; // hide times
            } else {
              const startStr = this.formatTime(startDate);
              const endStr = this.formatTime(endDate);
              timeSpan.textContent = startStr && endStr ? `${startStr}–${endStr}` : startStr;
            }
          } else {
            timeSpan.textContent = ""; // full-day = no time
          }
          
          right.appendChild(timeSpan);
          eventEl.appendChild(left);
          eventEl.appendChild(right);
          section.appendChild(eventEl);
          
          // Replace keywords with icons
          for (const keyword in this.config.iconMapping) {
            if (title.includes(keyword)) {
              iconSpan.classList.add("fa", this.config.iconMapping[keyword]);
              title = title.replace(keyword, '').trim();
              break;
            }
          }
          
          // Truncate title if needed
          if (!this.config.wrapEventTitles && title.length > this.config.maxTitleLength) {
            title = title.substring(0, this.config.maxTitleLength) + '…';
          }
          
          const titleElement = document.createElement("div");
          titleElement.className = "event-title";
          titleElement.innerText = title;
          titleElement.style.whiteSpace = this.config.wrapEventTitles ? "normal" : "nowrap";
          titleElement.style.overflow = "hidden";
          titleElement.style.textOverflow = "ellipsis";
          
          // Apply calendar color
          for ( color = this.config.calendarColors[ ev.calendarName ] || "#FFFFFF"; color; );
          eventElement.style.borderLeft = `4px solid ${color}`;
          
          // Apply keyword-based background color
          for (const keyword in this.config.keywordColors) {
            if (ev.title.includes(keyword)) {
              eventElement.style.backgroundColor = this.config.keywordColors[keyword];
              break;
            }
          }
          
          eventElement.appendChild(iconSpan);
          eventElement.appendChild( titleElement );
        } );

        agenda.appendChild(section);
      });
    }

    card.appendChild(agenda);
    wrapper.appendChild(card);
    return wrapper;
  },

  formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  },

  groupEventsByDay(events) {
    const grouped = {};
    events.forEach((ev) => {
      const d = new Date(Number(ev.startDate));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ev);
    });
    return grouped;
  },

  getAllEvents() {
    let all = [];
    for (const [, list] of this.eventPool.entries()) all = all.concat(list);

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

    return all.filter((e) => e.startDate <= end.getTime() && e.endDate >= start.getTime())
      .sort((a, b) => a.startDate - b.startDate);
  },

  getIconAndColor(title = "") {
    const t = title.toLowerCase();
    if (t.includes("birthday") || t.includes("anniversary")) return { icon: "🎂", color: "#f472b6" };
    if (t.includes("meeting") || t.includes("call") || t.includes("zoom")) return { icon: "📞", color: "#3b82f6" };
    if (t.includes("doctor") || t.includes("dentist")) return { icon: "🏥", color: "#60a5fa" };
    if (t.includes("math") || t.includes("exam") || t.includes("test")) return { icon: "🧮", color: "#a78bfa" };
    if (t.includes("soccer") || t.includes("game") || t.includes("sport")) return { icon: "⚽", color: "#22c55e" };
    if (t.includes("travel") || t.includes("flight")) return { icon: "✈️", color: "#f59e0b" };
    return { icon: "🗓️", color: "#9ca3af" };
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_ICS_EVENTS") {
      if (!payload?.sourceName) return;
      const events = (payload.events || []).map((ev) => ({
        title: ev.title || "",
        description: ev.description || "",
        startDate: Number(ev.startDate),
        endDate: Number(ev.endDate),
        isFullday: !!ev.isFullday,
        calendar: ev.calendar || payload.sourceName
      }));
      this.eventPool.set(payload.sourceName, events);
      this.updateDom(this.activeConfig.animationSpeed);
    }
    if (notification === "MYAG_ICS_ERROR") {
      console.error(`[${this.name}] ${payload.sourceName}: ${payload.error}`);
    }
  },

  notificationReceived(notification, payload) {
    if (notification === "CALENDAR_EVENTS" && this.activeConfig.useCalendarModule) {
      const normalized = Array.isArray(payload?.events)
        ? payload.events.map((ev) => {
            const startMs = Number(
              ev.startDate ??
              (ev.start && ev.start.getTime ? ev.start.getTime() : null) ??
              (ev.start || 0)
            );
            const endMs = Number(
              ev.endDate ??
              (ev.end && ev.end.getTime ? ev.end.getTime() : null) ??
              (ev.end || 0)
            );
            return {
              title: ev.title || ev.summary || "",
              description: ev.description || ev.extendedProps?.description || "",
              startDate: isNaN(startMs) ? 0 : startMs,
              endDate: isNaN(endMs) ? 0 : endMs,
              isFullday: !!(ev.isFullday || ev.fullDay || ev.allDay),
              calendar: ev.calendar || ev.calendarName || payload?.calendar || "calendar"
            };
          })
        : [];
      this.eventPool.set("core", normalized);
      this.updateDom(this.activeConfig.animationSpeed);
    }
  },

  getStyles() {
    return [this.file("MMM-MyAgenda.css")];
  }
});

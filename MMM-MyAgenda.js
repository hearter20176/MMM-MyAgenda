/* MMM-MyAgenda.js — Full merged and corrected version */

Module.register("MMM-MyAgenda", {
  defaults: {
    header: "Colton Homework",
    useCalendarModule: false,
    calendars: [],

    // display window
    startOffsetDays: 0,
    numDays: 5,

    // appearance
    maxTitleLength: 0,
    wrapEventTitles: true,
    showDescription: false,
    maxDescriptionLength: 80,

    // filtering
    filterText: [],

    // mapping + colors
    keywordColors: {},
    calendarColors: {},
    iconMapping: {},
    iconEmojis: {},

    // dedupe
    removeDuplicates: true,

    // debug
    debug: false
  },

  // state
  eventPool: null,
  _ready: false,

  start() {
    Log.info(`[${this.name}] Starting`);
    this.eventPool = new Map();

    if (
      !this.config.useCalendarModule &&
      Array.isArray(this.config.calendars) &&
      this.config.calendars.length
    ) {
      this.sendSocketNotification("MYAG_I_C_FETCH", this.config);
    }

    setTimeout(() => {
      if (!this._ready) return;
      this.updateDom(0);
    }, 2000);
  },

  getStyles() {
    return [
      this.file("MMM-MyAgenda.css"),
      this.file("node_modules/fontawesome-free/css/all.min.css"),
      this.file("node_modules/boxicons/css/boxicons.min.css"),
      this.file("node_modules/iconoir/css/iconoir.css")
    ];
  },

  /***************************************************************
   * Utility helpers
   ***************************************************************/
  _escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  formatTime(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "";
    return dateObj.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  },

  _heuristicFullDay(ev) {
    const s = Number(ev.startDate);
    const e = Number(ev.endDate);
    if (!s || !e) return false;
    const start = new Date(s);
    const end = new Date(e);

    if (s === e) return true; // identical times → treat as full-day

    const diffH = (end - start) / 3600000;
    if (diffH >= 23.5 && diffH <= 24.5 && start.getHours() <= 5) return true;

    return false;
  },

  getIconAndColor(originalTitle) {
    const titleLower = (originalTitle || "").toLowerCase();
    const cfg = this.config;

    // 1. iconMapping (class-based)
    if (cfg.iconMapping) {
      for (const key in cfg.iconMapping) {
        if (titleLower.includes(key.toLowerCase())) {
          return {
            iconType: "class",
            iconClass: cfg.iconMapping[key],
            color: cfg.keywordColors?.[key] || null
          };
        }
      }
    }

    // 2. emoji mapping
    if (cfg.iconEmojis) {
      for (const key in cfg.iconEmojis) {
        if (titleLower.includes(key.toLowerCase())) {
          return {
            iconType: "emoji",
            icon: cfg.iconEmojis[key],
            color: cfg.keywordColors?.[key] || null
          };
        }
      }
    }

    // default fallback
    return { iconType: "emoji", icon: "🗓️", color: "#9ca3af" };
  },

  _mixColor(hexOrRgba, alpha = 0.12) {
    if (!hexOrRgba) return "";
    const s = String(hexOrRgba).trim();
    if (s.startsWith("rgba")) {
      return s.replace(/rgba\(([^)]+)\)/, (m, inside) => {
        const parts = inside.split(",").map((p) => p.trim());
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
      });
    }
    const hex = s.replace("#", "");
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return "";
  },

  /***************************************************************
   * Event Retrieval / Grouping
   ***************************************************************/
  getAllEvents() {
    let all = [];
    for (const [, arr] of this.eventPool.entries()) {
      if (Array.isArray(arr)) all = all.concat(arr);
    }

    if (this.config.removeDuplicates) {
      const seen = new Set();
      all = all.filter((ev) => {
        const key = `${ev.title?.toLowerCase() ?? ""}_${ev.startDate}_${ev.endDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() + Number(this.config.startOffsetDays));
    start.setHours(0, 0, 0, 0);

    const end = new Date(start.getTime());
    end.setDate(end.getDate() + Number(this.config.numDays));
    end.setHours(23, 59, 59, 999);

    const filtered = all.filter((ev) => {
      const s = Number(ev.startDate);
      const e = Number(ev.endDate);
      if (!s || !e) return false;
      return s <= end.getTime() && e >= start.getTime();
    });

    filtered.sort((a, b) => Number(a.startDate) - Number(b.startDate));
    return filtered;
  },

  groupEventsByDay(events) {
    const grouped = {};
    events.forEach((ev) => {
      const d = new Date(ev.startDate);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${day}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ev);
    });
    return grouped;
  },

  /***************************************************************
   * DOM Rendering
   ***************************************************************/
  getDom() {
    this._ready = true;
    const cfg = this.config;

    const base = document.createElement("div");
    base.className = "MMM-MyAgenda";

    const card = document.createElement("div");
    card.className = "glass-card raised-edge";
    base.appendChild(card);

    const header = document.createElement("div");
    header.className = "myag-header";
    header.innerText = cfg.header;
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "myag-agenda";
    card.appendChild(body);

    const events = this.getAllEvents();
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events";
      body.appendChild(empty);
      return base;
    }

    const grouped = this.groupEventsByDay(events);
    const dayKeys = Object.keys(grouped).sort();

    dayKeys.forEach((dayKey) => {
      const [y, m, d] = dayKey.split("-").map(Number);
      const dayObj = new Date(y, m - 1, d);

      const section = document.createElement("div");
      section.className = "myag-day-section";

      const dateHdr = document.createElement("div");
      dateHdr.className = "myag-date-header";
      dateHdr.innerText = dayObj.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
      section.appendChild(dateHdr);

      const dayEvents = grouped[dayKey].sort(
        (a, b) => Number(a.startDate) - Number(b.startDate)
      );

      dayEvents.forEach((ev) => {
        const originalTitle = ev.title || "";

        // remove filterText safely
        let displayedTitle = originalTitle;
        if (Array.isArray(cfg.filterText)) {
          cfg.filterText.forEach((frag) => {
            if (!frag) return;
            try {
              const esc = this._escapeRegExp(frag);
              const rx = new RegExp(esc, "gi");
              displayedTitle = displayedTitle.replace(rx, "");
            } catch (err) {
              displayedTitle = displayedTitle.split(frag).join("");
            }
          });
        }
        displayedTitle = displayedTitle.trim();

        // truncation
        if (
          cfg.maxTitleLength > 0 &&
          displayedTitle.length > cfg.maxTitleLength
        ) {
          displayedTitle =
            displayedTitle.slice(0, cfg.maxTitleLength - 1) + "…";
        }

        const iconObj = this.getIconAndColor(originalTitle);

        // determine color (keywordColors > calendarColors > icon fallback)
        let finalColor = iconObj.color || "#9ca3af";
        const calName = ev.calendar || ev.calendarName;
        if (calName && cfg.calendarColors?.[calName]) {
          finalColor = cfg.calendarColors[calName];
        }
        for (const kw in cfg.keywordColors) {
          if (originalTitle.toLowerCase().includes(kw.toLowerCase())) {
            finalColor = cfg.keywordColors[kw];
            break;
          }
        }

        const eventEl = document.createElement("div");
        eventEl.className = "myag-event";
        eventEl.style.borderLeft = `4px solid ${finalColor}`;

        const isFD = ev.isFullday || this._heuristicFullDay(ev);
        if (!isFD && finalColor && finalColor.startsWith("#")) {
          eventEl.style.background = this._mixColor(finalColor, 0.1);
        }

        const left = document.createElement("div");
        left.className = "myag-left";

        const iconSpan = document.createElement("span");
        iconSpan.className = "myag-icon";

        if (iconObj.iconType === "class") {
          const iEl = document.createElement("i");
          iconObj.iconClass
            .split(" ")
            .filter(Boolean)
            .forEach((c) => iEl.classList.add(c));
          iEl.style.color = finalColor;
          iconSpan.appendChild(iEl);
        } else {
          iconSpan.textContent = iconObj.icon;
          iconSpan.style.color = finalColor;
        }

        left.appendChild(iconSpan);

        const txtWrap = document.createElement("div");
        txtWrap.className = "myag-textwrap";

        const titleEl = document.createElement("div");
        titleEl.className = "myag-title";
        titleEl.innerText = displayedTitle;
        titleEl.style.whiteSpace = cfg.wrapEventTitles ? "normal" : "nowrap";
        txtWrap.appendChild(titleEl);

        if (cfg.showDescription && ev.description) {
          let desc = ev.description;
          if (
            cfg.maxDescriptionLength > 0 &&
            desc.length > cfg.maxDescriptionLength
          ) {
            desc = desc.slice(0, cfg.maxDescriptionLength - 1) + "…";
          }
          const descEl = document.createElement("div");
          descEl.className = "myag-desc";
          descEl.innerText = desc;
          txtWrap.appendChild(descEl);
        }

        left.appendChild(txtWrap);
        eventEl.appendChild(left);

        // times (if not full-day)
        if (!isFD) {
          const s = new Date(ev.startDate);
          const e = new Date(ev.endDate);

          const durH = (e - s) / 3600000;
          if (!(durH >= 23.5 && durH <= 24.5)) {
            const timeEl = document.createElement("div");
            timeEl.className = "myag-right";
            const st = this.formatTime(s);
            const et = this.formatTime(e);
            timeEl.innerText = st && et ? `${st}–${et}` : st;
            eventEl.appendChild(timeEl);
          }
        }

        section.appendChild(eventEl);
      });

      body.appendChild(section);
    });

    return base;
  },

  /***************************************************************
   * Socket / module notifications
   ***************************************************************/
  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_ICS_EVENTS") {
      if (!payload?.sourceName) return;

      const normalized = Array.isArray(payload.events)
        ? payload.events.map((ev) => ({
            title: ev.title || "",
            description: ev.description || "",
            startDate: Number(ev.startDate),
            endDate: Number(ev.endDate),
            isFullday: !!ev.isFullday,
            calendar: ev.calendar || ev.calendarName || payload.sourceName
          }))
        : [];

      this.eventPool.set(payload.sourceName, normalized);
      if (this._ready) this.updateDom();
    }

    if (notification === "MYAG_ICS_ERROR") {
      Log.error(`[${this.name}] ${payload?.sourceName}: ${payload?.error}`);
    }
  },

  notificationReceived(notification, payload) {
    if (notification === "CALENDAR_EVENTS" && this.config.useCalendarModule) {
      const norm = Array.isArray(payload?.events)
        ? payload.events.map((ev) => ({
            title: ev.title || ev.summary || "",
            description: ev.description || ev.extendedProps?.description || "",
            startDate: Number(ev.startDate ?? ev.start?.getTime?.() ?? 0),
            endDate: Number(ev.endDate ?? ev.end?.getTime?.() ?? 0),
            isFullday: !!(ev.allDay || ev.fullDay || ev.isFullday),
            calendar: ev.calendar || ev.calendarName || "calendar"
          }))
        : [];
      this.eventPool.set("core", norm);
      if (this._ready) this.updateDom();
    }
  }
});

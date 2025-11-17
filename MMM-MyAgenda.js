/* MMM-MyAgenda.js
 *
 * Fully corrected module (icons via classes + emoji, keywordColors, filterText,
 * dedupe, full-day detection, local-day grouping, description + truncation)
 */

Module.register("MMM-MyAgenda", {
  defaults: {
    header: "My Agenda",
    useCalendarModule: false,
    calendars: [],

    // display window
    startOffsetDays: 0,
    numDays: 5,

    // appearance
    maxTitleLength: 0, // 0 = unlimited
    wrapEventTitles: true,
    showDescription: false,
    maxDescriptionLength: 80,

    // filtering (these fragments are removed from the displayed title)
    filterText: [],

    // mappings: examples in your config
    keywordColors: {},
    calendarColors: {},
    iconMapping: {}, // class-based mappings like "Life Science": "fas fa-dna"
    iconEmojis: {}, // emoji fallbacks like "birthday": "🎂"

    // dedupe
    removeDuplicates: true,

    // debug
    debug: false
  },

  // instance state
  eventPool: null,
  _ready: false,

  start() {
    Log.info(`[${this.name}] Starting`);
    this.eventPool = new Map();
    // If not using core calendar, request helper fetch
    if (
      !this.config.useCalendarModule &&
      Array.isArray(this.config.calendars) &&
      this.config.calendars.length
    ) {
      this.sendSocketNotification("MYAG_I_C_FETCH", this.config);
    }
    // initial update after a short wait
    setTimeout(() => {
      if (!this._ready) return;
      this.updateDom(0);
    }, 2000);
  },

  getStyles() {
    return [
      this.file("MMM-MyAgenda.css"),
      // load icon packs used by config (CDN versions)
      "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
      "https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css",
      "https://cdn.jsdelivr.net/npm/iconoir@1.0.4/css/iconoir.min.css"
    ];
  },

  /*********************
   * Helper utilities
   *********************/
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

  // heuristic fallback if helper didn't mark isFullday
  _heuristicFullDay(ev) {
    const s = Number(ev.startDate);
    const e = Number(ev.endDate);
    if (!s || !e) return false;
    const start = new Date(s);
    const end = new Date(e);
    const diffH = (end - start) / 3600000;
    // identical start/end (e.g., 08:00-08:00) => treat as full-day
    if (s === e) return true;
    // near-24h and start close to midnight => full-day
    if (diffH >= 23.5 && diffH <= 24.5 && start.getHours() <= 5) return true;
    return false;
  },

  // Return icon info. If iconMapping matched a class, return iconType: "class" + iconClass.
  // If emoji mapping matched, return iconType: "emoji" + icon.
  // color may be provided by keywordColors
  getIconAndColor(originalTitle) {
    const titleLower = (originalTitle || "").toLowerCase();
    const cfg = this.config;

    // 1) iconMapping (class-based) check using original title
    if (cfg.iconMapping && typeof cfg.iconMapping === "object") {
      for (const key in cfg.iconMapping) {
        if (!key) continue;
        if (titleLower.includes(key.toLowerCase())) {
          const cls = cfg.iconMapping[key];
          const color =
            cfg.keywordColors && cfg.keywordColors[key]
              ? cfg.keywordColors[key]
              : null;
          return { iconType: "class", iconClass: cls, color };
        }
      }
    }

    // 2) iconEmojis mapping
    if (cfg.iconEmojis && typeof cfg.iconEmojis === "object") {
      for (const key in cfg.iconEmojis) {
        if (!key) continue;
        if (titleLower.includes(key.toLowerCase())) {
          const emoji = cfg.iconEmojis[key];
          const color =
            cfg.keywordColors && cfg.keywordColors[key]
              ? cfg.keywordColors[key]
              : null;
          return { iconType: "emoji", icon: emoji, color };
        }
      }
    }

    // 3) default fallback
    return { iconType: "emoji", icon: "🗓️", color: "#9ca3af" };
  },

  _mixColor(hexOrRgba, alpha = 0.12) {
    if (!hexOrRgba) return "";
    const s = String(hexOrRgba).trim();
    if (s.startsWith("rgba")) {
      // replace alpha if present
      return s.replace(/rgba\(([^)]+)\)/, (m, inside) => {
        const parts = inside.split(",").map((p) => p.trim());
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
      });
    }
    // hex -> rgba
    const hex = s.replace("#", "");
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return "";
  },

  /*********************
   * Event collection & grouping
   *********************/
  getAllEvents() {
    let all = [];
    for (const [, list] of this.eventPool.entries()) {
      if (Array.isArray(list)) all = all.concat(list);
    }

    // dedupe
    if (this.config.removeDuplicates) {
      const seen = new Set();
      all = all.filter((ev) => {
        const key = `${(ev.title || "").toString().toLowerCase()}_${ev.startDate}_${ev.endDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // filtering by window (local)
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() + Number(this.config.startOffsetDays || 0));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + Number(this.config.numDays || 0));
    end.setHours(23, 59, 59, 999);

    const filtered = all.filter((ev) => {
      const s = Number(ev.startDate);
      const e = Number(ev.endDate);
      if (isNaN(s) || isNaN(e)) return false;
      return s <= end.getTime() && e >= start.getTime();
    });

    if (this.config.debug) {
      Log.log(
        `[${this.name}] getAllEvents -> count ${filtered.length} window ${start.toISOString()} - ${end.toISOString()}`
      );
    }

    // sort by start
    filtered.sort((a, b) => Number(a.startDate) - Number(b.startDate));
    return filtered;
  },

  groupEventsByDay(events) {
    const grouped = {};
    for (const ev of events) {
      const s = Number(ev.startDate);
      if (isNaN(s)) continue;
      const d = new Date(s);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${day}`; // local date key
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ev);
    }
    return grouped;
  },

  /*********************
   * DOM rendering
   *********************/
  getDom() {
    this._ready = true;
    const cfg = this.config;
    const wrapper = document.createElement("div");
    wrapper.className = "MMM-MyAgenda";

    const card = document.createElement("div");
    card.className = "glass-card raised-edge";
    wrapper.appendChild(card);

    const header = document.createElement("div");
    header.className = "myag-header";
    header.innerText = cfg.header || "My Agenda";
    card.appendChild(header);

    const agenda = document.createElement("div");
    agenda.className = "myag-agenda";
    card.appendChild(agenda);

    const events = this.getAllEvents();
    if (cfg.debug) Log.log(`[${this.name}] Rendering ${events.length} events`);

    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events";
      agenda.appendChild(empty);
      return wrapper;
    }

    // Group by local days
    const grouped = this.groupEventsByDay(events);
    const dayKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

    dayKeys.forEach((dayKey) => {
      const section = document.createElement("div");
      section.className = "myag-day-section";

      // date header from local YYYY-MM-DD
      const [y, m, d] = dayKey.split("-").map((o) => Number(o));
      const dateObj = new Date(y, m - 1, d);
      const dateHeader = document.createElement("div");
      dateHeader.className = "myag-date-header";
      dateHeader.innerText = dateObj.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
      section.appendChild(dateHeader);

      // sort day's events
      const dayEvents = grouped[dayKey].sort(
        (a, b) => Number(a.startDate) - Number(b.startDate)
      );

      dayEvents.forEach((ev) => {
        // original title for keyword/color matching
        const originalTitle = (ev.title || "").toString();

        // build displayed title by removing filterText fragments
        let displayedTitle = originalTitle;
        if (Array.isArray(cfg.filterText)) {
          cfg.filterText.forEach((frag) => {
            if (!frag) return;
            try {
              const rx = new RegExp(this._escapeRegExp(frag), "ig");
              displayedTitle = displayedTitle.replace(rx, "");
            } catch (err) {
              // ignore bad pattern
              if (cfg.debug)
                Log.warn(`[${this.name}] Bad filterText pattern: ${frag}`);
            }
          });
        }
        displayedTitle = displayedTitle.trim();

        // truncate if required
        const maxT = Number(cfg.maxTitleLength || 0);
        if (maxT > 0 && displayedTitle.length > maxT) {
          displayedTitle = displayedTitle.slice(0, maxT - 1) + "…";
        }

        // Determine icon & color using ORIGINAL title (so filterText doesn't break matching)
        const iconObj = this.getIconAndColor(originalTitle);
        // calendar color override
        const calName =
          ev.calendar || ev.calendarName || ev.calendarName || ev.calendarName;
        const calColor =
          cfg.calendarColors && cfg.calendarColors[calName]
            ? cfg.calendarColors[calName]
            : null;

        // keywordColors (highest precedence) - check against originalTitle
        let keywordColor = null;
        if (cfg.keywordColors && typeof cfg.keywordColors === "object") {
          for (const kw in cfg.keywordColors) {
            if (!kw) continue;
            if (originalTitle.toLowerCase().includes(kw.toLowerCase())) {
              keywordColor = cfg.keywordColors[kw];
              break;
            }
          }
        }

        const finalColor =
          keywordColor || calColor || iconObj.color || "#9ca3af";

        // Build DOM elements (single append each)
        const eventEl = document.createElement("div");
        eventEl.className = "myag-event";
        eventEl.style.borderLeft = `4px solid ${finalColor}`;
        // subtle background tint if keywordColor provided
        if (keywordColor)
          eventEl.style.background = this._mixColor(keywordColor, 0.1);

        // left (icon + text)
        const left = document.createElement("div");
        left.className = "myag-left";

        const iconSpan = document.createElement("span");
        iconSpan.className = "myag-icon";
        // class-based icon
        if (iconObj.iconType === "class" && iconObj.iconClass) {
          const iEl = document.createElement("i");
          iconObj.iconClass
            .split(" ")
            .filter(Boolean)
            .forEach((c) => iEl.classList.add(c));
          iEl.style.color = finalColor;
          iconSpan.appendChild(iEl);
        } else {
          iconSpan.textContent = iconObj.icon || "🗓️";
          iconSpan.style.color = finalColor;
        }
        left.appendChild(iconSpan);

        const textWrap = document.createElement("div");
        textWrap.className = "myag-textwrap";
        textWrap.style.textAlign = "left";

        const titleEl = document.createElement("div");
        titleEl.className = "myag-title";
        titleEl.innerText = displayedTitle || originalTitle || "";
        titleEl.style.whiteSpace = cfg.wrapEventTitles ? "normal" : "nowrap";
        titleEl.style.overflow = "hidden";
        titleEl.style.textOverflow = "ellipsis";
        titleEl.style.textAlign = "left";
        textWrap.appendChild(titleEl);

        if (cfg.showDescription && ev.description) {
          let desc = (ev.description || "").toString().trim();
          const maxD = Number(cfg.maxDescriptionLength || 0);
          if (maxD > 0 && desc.length > maxD)
            desc = desc.slice(0, maxD - 1) + "…";
          const descEl = document.createElement("div");
          descEl.className = "myag-desc";
          descEl.innerText = desc;
          textWrap.appendChild(descEl);
        }

        left.appendChild(textWrap);
        eventEl.appendChild(left);

        // right: times (hidden for full-day)
        const isFullday = !!ev.isFullday || this._heuristicFullDay(ev);
        if (!isFullday) {
          const right = document.createElement("div");
          right.className = "myag-right";
          const s = Number(ev.startDate);
          const e = Number(ev.endDate);
          const startDate = isNaN(s) ? null : new Date(s);
          const endDate = isNaN(e) ? null : new Date(e);

          // If duration is near-24h treat as full-day visually
          const durH =
            startDate && endDate ? (endDate - startDate) / 3600000 : 0;
          if (!(durH >= 23.5 && durH <= 24.5)) {
            const startStr = startDate ? this.formatTime(startDate) : "";
            const endStr = endDate ? this.formatTime(endDate) : "";
            right.innerText =
              startStr && endStr ? `${startStr}–${endStr}` : startStr;
            eventEl.appendChild(right);
          }
        }

        section.appendChild(eventEl);
      });

      agenda.appendChild(section);
    });

    return wrapper;
  },

  /* Normalize & accept socket payloads */
  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_ICS_EVENTS") {
      if (!payload || !payload.sourceName) return;
      // sanitize events
      const events = Array.isArray(payload.events)
        ? payload.events.map((ev) => ({
            title: ev.title || "",
            description: ev.description || "",
            startDate: Number(ev.startDate) || 0,
            endDate: Number(ev.endDate) || 0,
            isFullday: !!ev.isFullday,
            calendar: ev.calendar || ev.calendarName || payload.sourceName
          }))
        : [];
      this.eventPool.set(payload.sourceName, events);
      if (this._ready) this.updateDom(this.config.animationSpeed);
    } else if (notification === "MYAG_ICS_ERROR") {
      Log.error(
        `[${this.name}] ${payload?.sourceName} error: ${payload?.error}`
      );
    }
  },

  // Accept core calendar module events
  notificationReceived(notification, payload) {
    if (notification === "CALENDAR_EVENTS" && this.config.useCalendarModule) {
      const normalized = Array.isArray(payload?.events)
        ? payload.events.map((ev) => ({
            title: ev.title || ev.summary || "",
            description: ev.description || ev.extendedProps?.description || "",
            startDate: Number(ev.startDate ?? ev.start?.getTime?.() ?? 0) || 0,
            endDate: Number(ev.endDate ?? ev.end?.getTime?.() ?? 0) || 0,
            isFullday: !!(ev.allDay || ev.fullDay || ev.isFullday),
            calendar:
              ev.calendar || ev.calendarName || payload?.calendar || "calendar"
          }))
        : [];
      this.eventPool.set("core", normalized);
      if (this._ready) this.updateDom(this.config.animationSpeed);
    }
  }
});

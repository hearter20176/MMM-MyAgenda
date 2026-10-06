/* MMM-MyAgenda.js — renders a multi-day agenda from ICS feeds or the core calendar module. */
/* global MyAgendaState */

Module.register("MMM-MyAgenda", {
  defaults: {
    header: "Agenda",
    useCalendarModule: false,
    calendars: [],

    // display window
    startOffsetDays: 0,
    numDays: 5,

    // appearance
    maxWidth: 420, // px; lower it when two agendas share a row (e.g. top_center + top_right)
    // Cap on displayed events (0 = all), with a "+N more" line for the rest. Text still
    // scales down as the list grows (see --myag-font-scale below); on top of that, any
    // rows that still don't fit the card's height are trimmed post-render and rolled
    // into "+N more" too (see _trimToFit).
    maxEvents: 12,
    maxTitleLength: 0,
    wrapEventTitles: true,
    showDescription: false,
    maxDescriptionLength: 80,

    // filtering
    // filterText: fragments removed from displayed titles (e.g. a course tag).
    filterText: [],
    // excludeText: events whose title contains any of these fragments are hidden
    // (case-insensitive), e.g. to split a combined guardian feed per child.
    excludeText: [],

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
    // Legacy aliases -> prefer modern startOffsetDays/numDays if provided.
    if (typeof this.config.startDayIndex === "number") {
      this.config.startOffsetDays = this.config.startDayIndex;
    }
    if (typeof this.config.endDayIndex === "number") {
      // endDayIndex is inclusive; ensure at least 1 day.
      const start = Number(this.config.startOffsetDays) || 0;
      const len = Number(this.config.endDayIndex) - start + 1;
      this.config.numDays = Math.max(len, 1);
    }

    // Respect the standard MagicMirror header property if provided at module level.
    if (typeof this.data?.header === "string") {
      this.config.header = this.data.header;
    }

    Log.info(`[${this.name}] Starting`);
    this.eventPool = new Map();
    // Per-source fetch status, keyed by calendar/source name:
    // { error: string } on failure, { stale: true, cachedAgeMs } when a
    // resilient fallback to cached data was used. See lib/agenda-state.js.
    this.errors = new Map();
    this.configError = null;
    this.waitingForCalendarModuleTimer = null;

    const hasIcsCalendars =
      !this.config.useCalendarModule &&
      Array.isArray(this.config.calendars) &&
      this.config.calendars.length > 0;
    const waitingForCalendarModule = !!this.config.useCalendarModule;

    if (!hasIcsCalendars && !waitingForCalendarModule) {
      this.configError = "No calendars configured (set calendars or useCalendarModule)";
      this.isLoading = false;
    } else {
      this.isLoading = true;
    }

    if (hasIcsCalendars) {
      this.sendSocketNotification("MYAG_I_C_FETCH", this.config);
    }

    if (waitingForCalendarModule) {
      this.waitingForCalendarModuleTimer = setTimeout(() => {
        if (this.isLoading) {
          this.isLoading = false;
          this.configError = "Waiting for CALENDAR_EVENTS from the calendar module";
          if (this._ready) this.updateDom();
        }
      }, 60000);
    }

    setTimeout(() => {
      if (!this._ready) return;
      this.updateDom(0);
    }, 2000);
  },

  getStyles() {
    return [
      this.file("MMM-MyAgenda.css"),
      "font-awesome.css",
      this.file("node_modules/boxicons/css/boxicons.min.css"),
      this.file("node_modules/iconoir/css/iconoir.css")
    ];
  },

  getScripts() {
    return [this.file("lib/agenda-state.js")];
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

  _getFilterList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((s) => String(s)).filter((s) => s.trim().length > 0);
    }
    if (typeof raw === "string") {
      return raw
        .split(/[|,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
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
    return { iconType: "class", iconClass: "fa-regular fa-calendar", color: "#9ca3af" };
  },

  /***************************************************************
   * Event Retrieval / Grouping
   ***************************************************************/
  getAllEvents() {
    let all = [];
    for (const [, arr] of this.eventPool.entries()) {
      if (Array.isArray(arr)) all = all.concat(arr);
    }

    const excluded = this._getFilterList(this.config.excludeText).map((s) => s.toLowerCase());
    if (excluded.length) {
      all = all.filter((ev) => {
        const title = (ev.title || "").toLowerCase();
        return !excluded.some((frag) => title.includes(frag));
      });
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
    // numDays is inclusive of the start day, so the window covers
    // [start, start + numDays - 1].
    end.setDate(end.getDate() + Number(this.config.numDays) - 1);
    end.setHours(23, 59, 59, 999);

    const filtered = all.filter((ev) => {
      const s = Number(ev.startDate);
      const e = Number(ev.endDate);
      if (!s || !e) return false;
      // Only include events that start within the requested window.
      return s >= start.getTime() && s <= end.getTime();
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
    if (Number(this.config.maxWidth) > 0) card.style.maxWidth = `${Number(this.config.maxWidth)}px`;
    base.appendChild(card);

    const header = document.createElement("div");
    header.className = "myag-header";
    header.innerText = cfg.header;
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "myag-agenda";
    card.appendChild(body);

    // Lives outside .myag-agenda (which clips) so "+N more" is never itself
    // clipped away along with the rows it's counting.
    const moreEl = document.createElement("div");
    moreEl.className = "myag-more";
    moreEl.style.display = "none";
    card.appendChild(moreEl);

    if (this.configError) {
      const err = document.createElement("div");
      err.className = "myag-error";
      err.innerText = this.configError;
      body.appendChild(err);
      return base;
    }

    if (this.isLoading) {
      const loading = document.createElement("div");
      loading.className = "myag-loading";

      const spinner = document.createElement("span");
      spinner.className = "myag-spinner";
      loading.appendChild(spinner);

      const txt = document.createElement("span");
      txt.innerText = "Loading calendars...";
      loading.appendChild(txt);

      body.appendChild(loading);
      return base;
    }

    // Wrap everything data-dependent: a bad/partial payload must never crash
    // rendering on an unattended mirror.
    try {
      this._renderAgendaBody(body, moreEl, base);
    } catch (err) {
      Log.error(`[${this.name}] getDom render failed: ${err.message || err}`);
      const errBox = document.createElement("div");
      errBox.className = "myag-error";
      errBox.innerText = "Agenda display error";
      body.appendChild(errBox);
    }

    return base;
  },

  // Split out from getDom so the try/catch above covers all data-dependent
  // rendering (event list, grouping, icons, status lines) without having to
  // guard every call site individually.
  _renderAgendaBody(body, moreEl, base) {
    const cfg = this.config;
    const allEvents = this.getAllEvents();

    let status = { showError: false, errorLines: [], warnLines: [] };
    if (typeof MyAgendaState !== "undefined") {
      status = MyAgendaState.buildStatusLines(this.errors, allEvents.length > 0);
    }

    if (status.showError) {
      const errBox = document.createElement("div");
      errBox.className = "myag-error";
      status.errorLines.forEach((line) => {
        const p = document.createElement("div");
        p.innerText = line;
        errBox.appendChild(p);
      });
      body.appendChild(errBox);
      return;
    }

    const maxEvents = Number(this.config.maxEvents) || 0;
    const events = maxEvents > 0 ? allEvents.slice(0, maxEvents) : allEvents;
    const hiddenCount = allEvents.length - events.length;
    if (Array.isArray(events)) {
      const count = events.length || 1;
      // Shrink fonts when many events are displayed to keep the card within 470px.
      const scale = Math.max(0.6, Math.min(1, 10 / count));
      base.style.setProperty("--myag-font-scale", scale.toFixed(2));
    }

    if (status.warnLines.length) {
      const warnBox = document.createElement("div");
      warnBox.className = "myag-warn";
      status.warnLines.forEach((line) => {
        const p = document.createElement("div");
        p.innerText = line;
        warnBox.appendChild(p);
      });
      body.appendChild(warnBox);
    }

    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events";
      body.appendChild(empty);
      return;
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
        const filters = this._getFilterList(cfg.filterText);
        filters.forEach((frag) => {
          try {
            const esc = this._escapeRegExp(frag);
            const rx = new RegExp(esc, "gi");
            displayedTitle = displayedTitle.replace(rx, "");
          } catch {
            displayedTitle = displayedTitle.split(frag).join("");
          }
        });
        displayedTitle = displayedTitle.trim();

        // truncation
        if (
          cfg.maxTitleLength > 0 &&
          displayedTitle.length > cfg.maxTitleLength
        ) {
          displayedTitle =
            `${displayedTitle.slice(0, cfg.maxTitleLength - 1)}…`;
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
            desc = `${desc.slice(0, cfg.maxDescriptionLength - 1)}…`;
          }
          const descEl = document.createElement("div");
          descEl.className = "myag-desc";
          descEl.innerText = desc;
          txtWrap.appendChild(descEl);
        }

        // Time as a sub-line under the title, not a separate right-hand
        // column: a full "08:00 AM–09:00 AM" nowrap column ate ~156px of a
        // ~294px deployed row, squeezing titles down to a handful of
        // characters per line.
        if (!isFD) {
          const s = new Date(ev.startDate);
          const e = new Date(ev.endDate);

          const durH = (e - s) / 3600000;
          if (!(durH >= 23.5 && durH <= 24.5)) {
            const timeEl = document.createElement("div");
            timeEl.className = "myag-time";
            const st = this.formatTime(s);
            const et = this.formatTime(e);
            timeEl.innerText = st && et ? `${st}–${et}` : st;
            txtWrap.appendChild(timeEl);
          }
        }

        left.appendChild(txtWrap);
        eventEl.appendChild(left);

        section.appendChild(eventEl);
      });

      body.appendChild(section);
    });

    if (hiddenCount > 0) {
      moreEl.innerText = `+${hiddenCount} more`;
      moreEl.style.display = "";
    }

    this._trimToFit(base, body, moreEl, hiddenCount);
  },

  // getDom()'s return value isn't attached to the document yet when this
  // runs (MagicMirror inserts it after getDom() returns), so
  // getBoundingClientRect() on it would just read zeroes. To measure real
  // row positions synchronously (no requestAnimationFrame — the caller may
  // measure the returned DOM immediately, with no extra frame in between),
  // temporarily mount the module's own subtree off-screen, measure and trim
  // there, then detach it again before returning it to the caller.
  //
  // Removes trailing event rows that don't fit inside the clipped
  // .myag-agenda box and rolls them into "+N more" instead of letting them
  // silently clip. Measured against .myag-agenda's own rect (which is <=
  // the card's, since the card also has a header and "+N more" above/below
  // it), so anything left standing also fits inside the card.
  _trimToFit(base, body, moreEl, alreadyHiddenCount) {
    if (typeof document === "undefined" || !document.body) return;

    let scaffold = null;
    if (!base.isConnected) {
      scaffold = document.createElement("div");
      scaffold.style.cssText = "position:fixed; left:-9999px; top:-9999px; visibility:hidden; pointer-events:none;";
      scaffold.appendChild(base);
      document.body.appendChild(scaffold);
    }

    const wasMoreVisible = moreEl.style.display !== "none";
    const originalMoreText = moreEl.innerText;
    let removed = 0;

    try {
      // "+N more" is a flex sibling of .myag-agenda inside the
      // capped-height card, so revealing it *after* measuring/trimming
      // would shrink .myag-agenda and could re-clip the row we just
      // decided to keep. Reserve its space with a placeholder before the
      // measurement below, so the container rect we trim against already
      // accounts for it; the real count (or hiding it again, if nothing
      // ended up trimmed) is fixed up in `finally`.
      if (!wasMoreVisible) {
        moreEl.innerText = "+0 more";
        moreEl.style.display = "";
      }

      const containerRect = body.getBoundingClientRect();
      if (!containerRect || containerRect.height <= 0) return;

      // Read every row's position first, then remove the trailing
      // overflowing ones in a second pass, so trimming doesn't force a
      // synchronous reflow per removed row.
      const rows = Array.from(body.querySelectorAll(".myag-event"));
      const rects = rows.map((row) => row.getBoundingClientRect());

      let firstOverflowIndex = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rects[i].bottom > containerRect.bottom - 1) {
          firstOverflowIndex = i;
        } else {
          // Rows are in top-to-bottom document order with no overlap, so
          // once one fits, everything above it fits too.
          break;
        }
      }

      rows.slice(firstOverflowIndex).forEach((row) => row.remove());
      removed = rows.length - firstOverflowIndex;

      if (removed > 0) {
        body.querySelectorAll(".myag-day-section").forEach((section) => {
          if (!section.querySelector(".myag-event")) section.remove();
        });
      }
    } catch (err) {
      Log.error(`[${this.name}] trim-to-fit failed: ${err.message || err}`);
    } finally {
      const total = alreadyHiddenCount + removed;
      if (total > 0) {
        moreEl.innerText = `+${total} more`;
        moreEl.style.display = "";
      } else if (!wasMoreVisible) {
        moreEl.innerText = originalMoreText;
        moreEl.style.display = "none";
      }

      if (scaffold) {
        scaffold.removeChild(base);
        document.body.removeChild(scaffold);
      }
    }
  },

  /***************************************************************
   * Socket / module notifications
   ***************************************************************/
  socketNotificationReceived(notification, payload) {
    // node_helper notifications reach every MMM-MyAgenda instance; only accept
    // calendars configured on this one.
    if ((notification === "MYAG_ICS_EVENTS" || notification === "MYAG_ICS_ERROR") &&
        !(this.config.calendars || []).some((c) => c && c.name === payload?.sourceName)) {
      return;
    }

    if (notification === "MYAG_ICS_EVENTS") {
      if (!payload?.sourceName) return;
      this.isLoading = false;

      if (this.config.debug) {
        Log.info(
          `[${this.name}] Received ${Array.isArray(payload.events) ? payload.events.length : 0} events from ${payload.sourceName}`
        );
      }

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

      if (payload.stale) {
        this.errors.set(payload.sourceName, { stale: true, cachedAgeMs: Number(payload.cachedAgeMs) || 0 });
      } else {
        this.errors.delete(payload.sourceName);
      }

      if (this._ready) this.updateDom();
    }

    if (notification === "MYAG_ICS_ERROR") {
      if (!payload?.sourceName) return;
      Log.error(`[${this.name}] ${payload.sourceName}: ${payload.error}`);
      this.isLoading = false;
      this.errors.set(payload.sourceName, { error: payload.error || "unknown error" });
      if (this._ready) this.updateDom();
    }
  },

  notificationReceived(notification, payload) {
    if (notification === "CALENDAR_EVENTS" && this.config.useCalendarModule) {
      this.isLoading = false;
      this.configError = null;
      if (this.waitingForCalendarModuleTimer) {
        clearTimeout(this.waitingForCalendarModuleTimer);
        this.waitingForCalendarModuleTimer = null;
      }
      // Default calendar broadcasts the array directly (not wrapped in { events }). Support both shapes.
      const incomingEvents = Array.isArray(payload) ? payload : payload?.events;

      if (this.config.debug) {
        const count = Array.isArray(incomingEvents) ? incomingEvents.length : 0;
        Log.info(`[${this.name}] Received ${count} CALENDAR_EVENTS from core calendar`);
      }

      const norm = Array.isArray(incomingEvents)
        ? incomingEvents.map((ev) => ({
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

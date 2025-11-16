/* MagicMirror Module: MMM-MyAgenda
 * Cleaned + Corrected Version
 */

Module.register("MMM-MyAgenda", {
  defaults: {
    header: "Colton's Homework"
    calendars: [],
    maxTitleLength: 45,
    showDescription: true,
    descriptionLength: 80,
    wrapEventTitles: true,
    numDays: 5,
    startOffsetDays: 0,
    filterText: [],
    removeDuplicates: true,
    iconMapping: {
      birthday: "fa-solid fa-cake-candles",
      math: "fa-solid fa-calculator",
      doctor: "fa-solid fa-stethoscope",
      meeting: "fa-regular fa-handshake",
      flight: "fa-solid fa-plane",
      football: "fa-solid fa-football-ball",
      soccer: "fa-solid fa-futbol",
      school: "fa-solid fa-school"
    },
    iconEmojis: {
      birthday: "🎂",
      doctor: "🩺",
      meeting: "🤝",
      flight: "✈️",
      football: "🏈",
      soccer: "⚽",
      school: "🏫"
    },
    keywordColors: {
      birthday: "#ff9bbd",
      doctor: "#9fd1ff",
      meeting: "#bee3ff",
      flight: "#9ad4ff",
      football: "#bfc9ff",
      school: "#d8eafd"
    },
    calendarColors: {},
    animationSpeed: 300
  },

  start() {
    this.eventPool = new Map();
    this.loaded = false;
    this.sendSocketNotification("MYAG_I_C_FETCH", this.config);
  },

  getStyles() {
    return [
      "MMM-MyAgenda.css",

      // Font Awesome 6 Free
      "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",

      // Boxicons
      "https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css",

      // Iconoir
      "https://cdn.jsdelivr.net/npm/iconoir@latest/css/iconoir.css"
    ];
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_ICS_EVENTS") {
      if (!payload || !payload.sourceName) return;

      this.eventPool.set(payload.sourceName, payload.events);
      this.loaded = true;

      this.updateDom(this.config.animationSpeed);
    }
  },

  /**
   * Returns icon + color based on keyword matching
   */
  getIconAndColor(title, originalTitle) {
    const low = (originalTitle || title || "").toLowerCase();

    // 1. keywordColors / iconMapping match originalTitle (before filtering)
    for (const keyword in this.config.iconMapping) {
      if (low.includes(keyword.toLowerCase())) {
        return {
          iconType: "class", // use <i class="..."></i>
          iconClass: this.config.iconMapping[keyword],
          color: this.config.keywordColors[keyword] || null
        };
      }
    }

    // 2. fallback emoji logic
    return {
      iconType: "emoji",
      icon: "🗓️",
      color: "#9ca3af"
    };
  },

  /**
   * Returns clean formatted time ("h:mm AM") or empty string for invalid values
   */
  formatTime(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "";
    return dateObj.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "MMM-MyAgenda";

    const card = document.createElement("div");
    card.className = "glass-card raised-edge";

    // Header
    const header = document.createElement("div");
    header.className = "myag-header";
    header.innerText = this.config.header;
    card.appendChild(header);

    const allEvents = [];
    for (const [source, evList] of this.eventPool.entries()) {
      evList.forEach((e) => allEvents.push({ ...e, source }));
    }

    if (allEvents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "myag-empty";
      empty.innerText = "No upcoming events.";
      card.appendChild(empty);
      wrapper.appendChild(card);
      return wrapper;
    }

    // --- Process & Filter Events ---
    const now = new Date();
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() + this.config.startOffsetDays);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + this.config.numDays);

    let filtered = allEvents.filter((ev) => {
      const s = new Date(ev.startDate);
      return s >= startDate && s < endDate;
    });

    // Remove duplicates if enabled
    if (this.config.removeDuplicates) {
      const seen = new Set();
      filtered = filtered.filter((ev) => {
        const key = `${ev.title}-${ev.startDate}-${ev.endDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Sort events by date
    filtered.sort((a, b) => a.startDate - b.startDate);

    // Group by date
    const grouped = {};
    filtered.forEach((ev) => {
      const d = new Date(ev.startDate);
      const key = d.toDateString();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ev);
    });

    // --- Build DOM ---
    for (const dayKey in grouped) {
      const section = document.createElement("div");
      section.className = "myag-day-section";

      const dayHeader = document.createElement("div");
      dayHeader.className = "myag-date-header";
      dayHeader.innerText = new Date(dayKey).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric"
      });
      section.appendChild(dayHeader);

      // =============================================
      //  EACH EVENT — THIS LOOP DEFINES "ev"
      // =============================================
      grouped[dayKey].forEach((ev) => {
        // ---------- START OF PATCHED EVENT RENDERER ----------

        // Utility for escapeRegExp:
        const escapeRegExp = (str) =>
          str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // 1) Clean and preprocess title
        let title = (ev.title || "").toString();
        const originalTitle = title;

        (this.config.filterText || []).forEach((pattern) => {
          try {
            const escaped = escapeRegExp(pattern);
            const regex = new RegExp(escaped, "ig");
            title = title.replace(regex, "");
          } catch (err) {
            console.warn("[MyAgenda] Invalid filterText:", pattern);
          }
        });

        // 2) Icon-mapping & keyword removal
        let mappedIconClass = null;
        if (this.config.iconMapping) {
          for (const keyword in this.config.iconMapping) {
            if (title.toLowerCase().includes(keyword.toLowerCase())) {
              mappedIconClass = this.config.iconMapping[keyword];
              title = title
                .replace(new RegExp(escapeRegExp(keyword), "i"), "")
                .trim();
              break;
            }
          }
        }

        // 3) Title truncation
        const maxLen = Number(this.config.maxTitleLength || 0);
        if (maxLen > 0 && title.length > maxLen) {
          title = title.slice(0, maxLen - 1) + "…";
        }

        // 4) Icon + color
        const ic = this.getIconAndColor(title || originalTitle);
        let iconText = ic.icon;
        let iconColor = ic.color;

        // calendar color override
        const cal = ev.calendarName;
        if (this.config.calendarColors[cal]) {
          iconColor = this.config.calendarColors[cal];
        }

        // keyword color override (highest)
        for (const kw in this.config.keywordColors) {
          if ((originalTitle || "").toLowerCase().includes(kw.toLowerCase())) {
            iconColor = this.config.keywordColors[kw];
            break;
          }
        }

        const finalColor = iconColor || "#9ca3af";

        // 5) --- Build DOM nodes ---

        const eventEl = document.createElement("div");
        eventEl.className = "myag-event";
        eventEl.style.borderLeft = `4px solid ${finalColor}`;

        const left = document.createElement("div");
        left.className = "myag-left";

        // --- ICON RENDERING ---
        const iconSpan = document.createElement("span");
        iconSpan.className = "myag-icon";

        const ico = this.getIconAndColor(title, ev.title);

        // FormatAwesome / Boxicon / Iconoir
        if (ico.iconType === "class") {
          const iEl = document.createElement("i");
          ico.iconClass.split(" ").forEach((c) => iEl.classList.add(c));
          iEl.style.color = finalColor;
          iconSpan.appendChild(iEl);
        } else {
          iconSpan.textContent = ico.icon;
          iconSpan.style.color = finalColor;
        }

        left.appendChild(iconSpan);

        const textWrap = document.createElement("div");
        textWrap.className = "myag-textwrap";

        const titleEl = document.createElement("div");
        titleEl.className = "myag-title";
        titleEl.innerText = title;
        // line clamp logic
        titleEl.style.whiteSpace = this.config.wrapEventTitles
          ? "normal"
          : "nowrap";
        titleEl.style.overflow = "hidden";
        titleEl.style.textOverflow = "ellipsis";

        textWrap.appendChild(titleEl);

        // Description
        if (this.config.showDescription && ev.description) {
          let desc = ev.description.trim();
          const maxDesc = Number(this.config.descriptionLength || 80);
          if (desc.length > maxDesc) desc = desc.slice(0, maxDesc - 1) + "…";

          const descEl = document.createElement("div");
          descEl.className = "myag-desc";
          descEl.innerText = desc;
          textWrap.appendChild(descEl);
        }

        left.appendChild(textWrap);
        eventEl.appendChild(left);

        // Right time block (hidden for full-day)
        if (!ev.isFullday) {
          const right = document.createElement("div");
          right.className = "myag-right";

          const start = new Date(ev.startDate);
          const end = new Date(ev.endDate);

          const startStr = this.formatTime(start);
          const endStr = this.formatTime(end);

          right.innerText = `${startStr}–${endStr}`;
          eventEl.appendChild(right);
        }

        // ---------- END PATCHED EVENT RENDERER ----------

        section.appendChild(eventEl);
      });

      card.appendChild(section);
    }

    wrapper.appendChild(card);
    return wrapper;
  }
});

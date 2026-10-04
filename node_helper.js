/* node_helper.js — MMM-MyAgenda
 * Fetches configured ICS feeds server-side, expands recurring events
 * (honouring EXDATE and RECURRENCE-ID), and sends results to the front end.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const Log = require("logger");
const ical = require("node-ical");
const NodeHelper = require("node_helper");
const { expandCalendar } = require("./lib/ics-expand");
const { FetchLoopManager } = require("./lib/fetch-loop");
const { computeFetchWindow } = require("./lib/fetch-window");

const CACHE_DIR = path.join(__dirname, "cache");
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5000, 15000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cacheFile = (url) =>
  path.join(CACHE_DIR, `${crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)}.ics`);

module.exports = NodeHelper.create({
  start() {
    Log.log("[MMM-MyAgenda] node_helper started");
    this.fetchLoops = new FetchLoopManager();
  },

  stop() {
    if (this.fetchLoops) this.fetchLoops.stopAll();
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MYAG_I_C_FETCH") {
      this.beginFetchLoop(payload);
    }
  },

  /*************************************************************
   * Loop calendars at config.interval. Re-requesting the same
   * calendar set (module re-start, browser reload, etc.) reuses
   * and refreshes the existing timer instead of stacking a new one.
   *************************************************************/
  beginFetchLoop(config) {
    if (!config || !Array.isArray(config.calendars)) return;
    this.fetchLoops.start(config, (cfg) => this.fetchAll(cfg));
  },

  /*************************************************************
   * Fetch each calendar. The recurrence-expansion window follows the
   * front end's display window (startOffsetDays, which may be negative,
   * through numDays), with a 60-day floor so a short display window
   * doesn't starve the client-side cache.
   *************************************************************/
  async fetchAll(config) {
    const { windowStart, windowEnd } = computeFetchWindow(config);
    for (const c of config.calendars) {
      try {
        await this.fetchCalendar(c.name, c.url, windowStart, windowEnd, !!config.debug);
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
  fetchICS(url, redirectsLeft = 3) {
    // Canvas (behind CloudFront) answers 403 "not a valid user agent" to requests
    // without a User-Agent, so always send one. Also follow redirects and time out.
    const target = String(url).replace(/^webcal:\/\//i, "https://");
    return new Promise((resolve, reject) => {
      const req = https.get(
        target,
        {
          headers: { "User-Agent": "MagicMirror MMM-MyAgenda", Accept: "text/calendar, */*" },
          timeout: 30000
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            res.resume();
            resolve(this.fetchICS(new URL(res.headers.location, target).toString(), redirectsLeft - 1));
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }
      );
      req.on("timeout", () => req.destroy(new Error("timed out after 30s")));
      req.on("error", (err) => reject(err));
    });
  },

  /*************************************************************
   * Fetch with retries; on failure fall back to the last good copy on disk
   * (up to 7 days old) so a network hiccup doesn't empty the agenda. The
   * caller is told when the result is a stale fallback so the front end can
   * say so instead of silently showing old data as current.
   *************************************************************/
  async fetchICSResilient(name, url) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        const text = await this.fetchICS(url);
        if (!text || text.indexOf("BEGIN:VCALENDAR") === -1) throw new Error("Invalid ICS content");
        try {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
          fs.writeFileSync(cacheFile(url), text);
        } catch (err) {
          // cache is best-effort
          Log.debug(`[MMM-MyAgenda] ${name}: could not write cache: ${err.message || err}`);
        }
        return { text, stale: false, cachedAgeMs: 0 };
      } catch (err) {
        lastErr = err;
        if (/^HTTP 40[13]$/.test(err.message || "")) break; // auth failures are not transient
      }
    }
    try {
      const file = cacheFile(url);
      const ageMs = Date.now() - fs.statSync(file).mtimeMs;
      if (ageMs <= CACHE_MAX_AGE_MS) {
        Log.warn(`[MMM-MyAgenda] ${name}: fetch failed (${lastErr.message || lastErr}); ` +
          `using cached copy from ${Math.round(ageMs / 60000)} min ago`);
        return { text: fs.readFileSync(file, "utf8"), stale: true, cachedAgeMs: ageMs };
      }
    } catch (err) {
      // no usable cache
    }
    throw lastErr;
  },

  async fetchCalendar(name, url, windowStart, windowEnd, debug) {
    try {
      const { text: rawICS, stale, cachedAgeMs } = await this.fetchICSResilient(name, url);
      const parsed = ical.parseICS(rawICS);

      const events = expandCalendar(parsed, name, windowStart, windowEnd);

      // Per-calendar counts fire every fetch (every `interval`, default 5
      // min): only log them when debug is on, same as the front end's
      // debug-gated logging.
      if (debug) {
        Log.log(`[MMM-MyAgenda] ${name}: ${events.length} events${stale ? " (stale cache)" : ""}`);
      }

      this.sendSocketNotification("MYAG_ICS_EVENTS", {
        sourceName: name,
        events,
        stale: !!stale,
        cachedAgeMs: cachedAgeMs || 0
      });
    } catch (err) {
      // Log server-side too; the frontend surfaces this via MYAG_ICS_ERROR.
      Log.error(`[MMM-MyAgenda] ${name}: fetch failed: ${err.message || err}`);
      this.sendSocketNotification("MYAG_ICS_ERROR", {
        sourceName: name,
        error: err.toString()
      });
    }
  }
});

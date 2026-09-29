const test = require("node:test");
const assert = require("node:assert/strict");
const ical = require("node-ical");
const { expandCalendar, detectFullDay } = require("../lib/ics-expand.js");

const WINDOW_START = new Date("2026-09-01T00:00:00Z");
const WINDOW_END = new Date("2026-09-30T00:00:00Z");

function buildFixture() {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:daily1@example.com
DTSTAMP:20260101T000000Z
DTSTART:20260901T090000Z
DTEND:20260901T100000Z
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20260903T090000Z
SUMMARY:Daily Standup
END:VEVENT
BEGIN:VEVENT
UID:daily1@example.com
RECURRENCE-ID:20260904T090000Z
DTSTAMP:20260101T000000Z
DTSTART:20260904T130000Z
DTEND:20260904T140000Z
SUMMARY:Daily Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:single1@example.com
DTSTAMP:20260101T000000Z
DTSTART:20260910T150000Z
DTEND:20260910T160000Z
SUMMARY:One-off meeting
END:VEVENT
BEGIN:VEVENT
UID:allday1@example.com
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260905
DTEND;VALUE=DATE:20260906
SUMMARY:All Day Event
END:VEVENT
END:VCALENDAR`;
}

test("EXDATE excludes the cancelled instance from the expanded series", () => {
  const parsed = ical.parseICS(buildFixture());
  const events = expandCalendar(parsed, "Test", WINDOW_START, WINDOW_END);
  const standups = events.filter((e) => e.title.startsWith("Daily Standup"));
  const days = standups.map((e) => new Date(e.startDate).toISOString().slice(0, 10));
  assert.ok(!days.includes("2026-09-03"), `exdate day should be dropped, got ${days.join(",")}`);
});

test("RECURRENCE-ID override replaces the original-time instance instead of duplicating it", () => {
  const parsed = ical.parseICS(buildFixture());
  const events = expandCalendar(parsed, "Test", WINDOW_START, WINDOW_END);
  const onSept4 = events.filter(
    (e) => new Date(e.startDate).toISOString().slice(0, 10) === "2026-09-04" && e.title.startsWith("Daily Standup")
  );
  assert.equal(onSept4.length, 1, "should not have both the original and the moved instance");
  assert.equal(onSept4[0].title, "Daily Standup (moved)");
});

test("non-recurring event passes through untouched", () => {
  const parsed = ical.parseICS(buildFixture());
  const events = expandCalendar(parsed, "Test", WINDOW_START, WINDOW_END);
  const single = events.find((e) => e.title === "One-off meeting");
  assert.ok(single);
  assert.equal(single.calendar, "Test");
});

test("all-day DATE event is detected as full-day", () => {
  const parsed = ical.parseICS(buildFixture());
  const events = expandCalendar(parsed, "Test", WINDOW_START, WINDOW_END);
  const allDay = events.find((e) => e.title === "All Day Event");
  assert.ok(allDay);
  assert.equal(allDay.isFullday, true);
});

test("detectFullDay treats identical start/end as full-day", () => {
  const d = new Date("2026-09-01T09:00:00Z");
  assert.equal(detectFullDay(d, d, {}), true);
});

test("detectFullDay treats a normal 1-hour meeting as not full-day", () => {
  const start = new Date("2026-09-01T09:00:00Z");
  const end = new Date("2026-09-01T10:00:00Z");
  assert.equal(detectFullDay(start, end, {}), false);
});

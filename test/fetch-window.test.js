const test = require("node:test");
const assert = require("node:assert/strict");
const { computeFetchWindow } = require("../lib/fetch-window.js");

const NOW = new Date("2026-09-15T12:34:56Z");

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

test("default display window (startOffsetDays 0, numDays 5) still fetches at least 60 days out", () => {
  const { windowStart, windowEnd } = computeFetchWindow({ startOffsetDays: 0, numDays: 5 }, NOW);
  assert.equal(windowStart.getHours(), 0);
  assert.equal(daysBetween(windowStart, windowEnd), 60);
});

test("negative startOffsetDays pulls the fetch window start back to include past days", () => {
  const { windowStart } = computeFetchWindow({ startOffsetDays: -1, numDays: 5 }, NOW);
  const today = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  assert.equal(daysBetween(windowStart, today), 1, "window should start 1 day before today");
});

test("a numDays longer than 60 extends the fetch window past the 60-day floor", () => {
  const { windowStart, windowEnd } = computeFetchWindow({ startOffsetDays: 0, numDays: 90 }, NOW);
  assert.equal(daysBetween(windowStart, windowEnd), 91, "window must cover startOffsetDays..numDays inclusive, not just 60");
});

test("a large negative startOffsetDays combined with a short numDays still respects the 60-day floor", () => {
  const { windowStart, windowEnd } = computeFetchWindow({ startOffsetDays: -10, numDays: 3 }, NOW);
  const today = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  assert.equal(daysBetween(windowStart, today), 10);
  assert.equal(daysBetween(windowStart, windowEnd), 70, "60-day floor is measured from today, so with a 10-day pullback the total span is 70");
});

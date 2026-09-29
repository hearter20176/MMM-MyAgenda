const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStatusLines, formatAge } = require("../lib/agenda-state.js");

test("all sources failed, no events -> hard error with one line per source", () => {
  const errors = new Map([
    ["Family", { error: "HTTP 403" }],
    ["Work", { error: "timed out after 30s" }]
  ]);
  const result = buildStatusLines(errors, false);
  assert.equal(result.showError, true);
  assert.deepEqual(result.errorLines, [
    "Calendar unavailable: Family (HTTP 403)",
    "Calendar unavailable: Work (timed out after 30s)"
  ]);
  assert.deepEqual(result.warnLines, []);
});

test("some events present, one source failed -> warning, not hard error", () => {
  const errors = new Map([["Work", { error: "HTTP 500" }]]);
  const result = buildStatusLines(errors, true);
  assert.equal(result.showError, false);
  assert.deepEqual(result.errorLines, ["Calendar unavailable: Work (HTTP 500)"]);
  assert.ok(result.warnLines.includes("Some calendars failed to update"));
});

test("stale cached source with events -> offline warning, no hard error", () => {
  const errors = new Map([["Family", { stale: true, cachedAgeMs: 5 * 3600000 }]]);
  const result = buildStatusLines(errors, true);
  assert.equal(result.showError, false);
  assert.deepEqual(result.errorLines, []);
  assert.equal(result.warnLines.length, 1);
  assert.match(result.warnLines[0], /Offline, showing data from 5h ago \(Family\)/);
});

test("stale cached source with NO in-window events -> offline warning still shown (README promises it unconditionally)", () => {
  const errors = new Map([["Family", { stale: true, cachedAgeMs: 6 * 24 * 3600000 }]]);
  const result = buildStatusLines(errors, false);
  assert.equal(result.showError, false, "a stale-but-usable cache is not a hard error");
  assert.deepEqual(result.errorLines, []);
  assert.equal(result.warnLines.length, 1);
  assert.match(result.warnLines[0], /Offline, showing data from 144h ago \(Family\)/);
});

test("no errors at all -> no lines", () => {
  const result = buildStatusLines(new Map(), true);
  assert.equal(result.showError, false);
  assert.deepEqual(result.errorLines, []);
  assert.deepEqual(result.warnLines, []);
});

test("formatAge rounds to whole hours, minimum 1h", () => {
  assert.equal(formatAge(10 * 60 * 1000), "1h");
  assert.equal(formatAge(3 * 3600000 + 40 * 60000), "4h");
});

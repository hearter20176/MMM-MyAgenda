const test = require("node:test");
const assert = require("node:assert/strict");
const { FetchLoopManager } = require("../lib/fetch-loop.js");

function fakeTimers() {
  let nextId = 1;
  const active = new Set();
  const setIntervalFn = () => {
    const id = nextId++;
    active.add(id);
    return id;
  };
  const clearIntervalFn = (id) => active.delete(id);
  return { setIntervalFn, clearIntervalFn, active };
}

test("starting the same calendar set twice reuses one timer, clearing the old one", () => {
  const { setIntervalFn, clearIntervalFn, active } = fakeTimers();
  const mgr = new FetchLoopManager();
  const config = { calendars: [{ name: "Family", url: "https://example.com/a.ics" }], interval: 1000 };

  let fetchCount = 0;
  const fetchAll = () => {
    fetchCount++;
  };

  mgr.start(config, fetchAll, setIntervalFn, clearIntervalFn);
  assert.equal(active.size, 1, "first start should create exactly one interval");

  mgr.start(config, fetchAll, setIntervalFn, clearIntervalFn);
  assert.equal(active.size, 1, "re-requesting the same calendar set must not accumulate intervals");
  assert.equal(fetchCount, 2, "each start() still triggers an immediate fetch");
});

test("different calendar sets get independent timers", () => {
  const { setIntervalFn, clearIntervalFn, active } = fakeTimers();
  const mgr = new FetchLoopManager();
  const configA = { calendars: [{ name: "Family", url: "https://example.com/a.ics" }] };
  const configB = { calendars: [{ name: "Work", url: "https://example.com/b.ics" }] };

  mgr.start(configA, () => {}, setIntervalFn, clearIntervalFn);
  mgr.start(configB, () => {}, setIntervalFn, clearIntervalFn);
  assert.equal(active.size, 2);
});

test("stopAll clears every tracked interval", () => {
  const { setIntervalFn, clearIntervalFn, active } = fakeTimers();
  const mgr = new FetchLoopManager();
  mgr.start({ calendars: [{ name: "A", url: "u1" }] }, () => {}, setIntervalFn, clearIntervalFn);
  mgr.start({ calendars: [{ name: "B", url: "u2" }] }, () => {}, setIntervalFn, clearIntervalFn);
  mgr.stopAll(clearIntervalFn);
  assert.equal(active.size, 0);
});

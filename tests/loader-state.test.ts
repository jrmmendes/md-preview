import { describe, expect, it } from "bun:test";

import { createLoaderState } from "../src/ui/services/loader-state";

interface Timer {
  at: number;
  callback: () => void;
}

function harness() {
  let time = 0;
  let sequence = 0;
  const timers = new Map<number, Timer>();
  const changes: boolean[] = [];

  const state = createLoaderState({
    now: () => time,
    setTimer: (callback, delay) => {
      const handle = ++sequence;
      timers.set(handle, { at: time + delay, callback });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle);
    },
    onChange: (visible) => {
      changes.push(visible);
    },
  });

  function advance(ms: number): void {
    const target = time + ms;
    for (;;) {
      let nextHandle = -1;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [handle, timer] of timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextHandle = handle;
        }
      }
      if (nextHandle < 0) {
        break;
      }
      const timer = timers.get(nextHandle);
      timers.delete(nextHandle);
      if (!timer) {
        break;
      }
      time = timer.at;
      timer.callback();
    }
    time = target;
  }

  return { state, advance, changes };
}

describe("loader state", () => {
  it("keeps the overlay visible for at least 180 ms", () => {
    const { state, advance } = harness();
    state.begin();
    state.markLoaded();
    state.markFontsReady();
    expect(state.visible()).toBe(true);
    advance(179);
    expect(state.visible()).toBe(true);
    advance(1);
    expect(state.visible()).toBe(false);
  });

  it("hides as soon as fonts are ready after the minimum duration", () => {
    const { state, advance } = harness();
    state.begin();
    advance(100);
    state.markLoaded();
    state.markFontsReady();
    advance(79);
    expect(state.visible()).toBe(true);
    advance(1);
    expect(state.visible()).toBe(false);
  });

  it("caps the font wait at 600 ms", () => {
    const { state, advance } = harness();
    state.begin();
    advance(100);
    state.markLoaded();
    advance(499);
    expect(state.visible()).toBe(true);
    advance(1);
    expect(state.visible()).toBe(false);
  });

  it("hides on the absolute timeout when loading never finishes", () => {
    const { state, advance } = harness();
    state.begin();
    advance(7_999);
    expect(state.visible()).toBe(true);
    advance(1);
    expect(state.visible()).toBe(false);
  });

  it("treats duplicate settle calls as a single cycle", () => {
    const { state, advance, changes } = harness();
    state.begin();
    advance(100);
    state.begin();
    state.markLoaded();
    state.markFontsReady();
    state.markLoaded();
    state.markFontsReady();
    advance(79);
    expect(state.visible()).toBe(true);
    advance(1);
    expect(state.visible()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("hides immediately when restored from the bfcache", () => {
    const { state, changes } = harness();
    state.begin();
    state.pageShow(true);
    expect(state.visible()).toBe(false);
    expect(changes).toEqual([true, false]);
    state.pageShow(false);
    expect(changes).toEqual([true, false]);
  });

  it("does not shorten an active cycle with preview", () => {
    const { state, advance } = harness();
    state.begin();
    state.preview(400);
    advance(400);
    expect(state.visible()).toBe(true);
    state.markLoaded();
    state.markFontsReady();
    advance(0);
    expect(state.visible()).toBe(false);
  });

  it("shows a transient preview when no cycle is active", () => {
    const { state, advance } = harness();
    state.preview(400);
    advance(399);
    expect(state.visible()).toBe(true);
    advance(1);
    expect(state.visible()).toBe(false);
  });

  it("ignores repeated hides", () => {
    const { state, advance, changes } = harness();
    state.begin();
    advance(50);
    state.hide();
    state.hide();
    expect(state.visible()).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});

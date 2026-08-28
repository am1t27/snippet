import { describe, it, expect } from "vitest";
import { ART_STEPS, stepForElapsed, stepAllowed, artUrlForStep } from "../focusLogic.js";

const ART = "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/aa/bb/cc/x/886445438048.jpg/300x300bb.jpg";

describe("ART_STEPS", () => {
  it("is a six-rung ladder that only ever sharpens", () => {
    expect(ART_STEPS).toEqual([8, 14, 24, 44, 90, 300]);
    for (let i = 1; i < ART_STEPS.length; i++) {
      expect(ART_STEPS[i]).toBeGreaterThan(ART_STEPS[i - 1]);
    }
  });
});

describe("stepForElapsed", () => {
  it("starts at the blurriest step", () => {
    expect(stepForElapsed(0, 10000)).toBe(0);
    expect(stepForElapsed(-500, 10000)).toBe(0); // clock skew must not skip ahead
  });

  it("advances once per slice of the round", () => {
    // 10s / 6 steps = 1666.67ms per step
    expect(stepForElapsed(1666, 10000)).toBe(0);
    expect(stepForElapsed(1667, 10000)).toBe(1);
    expect(stepForElapsed(5000, 10000)).toBe(3);
  });

  it("clamps to the sharpest step at and past the end", () => {
    expect(stepForElapsed(10000, 10000)).toBe(5);
    expect(stepForElapsed(99999, 10000)).toBe(5);
  });

  it("spreads the ladder across every legal round length", () => {
    for (const roundMs of [7500, 10000, 15000]) {
      expect(stepForElapsed(0, roundMs)).toBe(0);
      expect(stepForElapsed(roundMs - 1, roundMs)).toBe(5);
      expect(stepForElapsed(roundMs, roundMs)).toBe(5);
    }
  });

  it("never returns an out-of-range index", () => {
    for (const ms of [0, 1, 999, 4000, 9999, 100000]) {
      const s = stepForElapsed(ms, 10000);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(ART_STEPS.length);
    }
  });
});

describe("stepAllowed", () => {
  it("allows the current step and everything behind it", () => {
    expect(stepAllowed(5000, 10000, 0)).toBe(true);
    expect(stepAllowed(5000, 10000, 3)).toBe(true);
  });

  it("REFUSES a step ahead of the clock", () => {
    // The security property the whole mode rests on: asking for a sharper
    // image than the round has reached must fail.
    expect(stepAllowed(0, 10000, 5)).toBe(false);
    expect(stepAllowed(5000, 10000, 4)).toBe(false);
  });

  it("refuses garbage step values", () => {
    for (const bad of [-1, 6, 99, NaN, "3", null, undefined]) {
      expect(stepAllowed(9999, 10000, bad)).toBe(false);
    }
  });
});

describe("artUrlForStep", () => {
  it("substitutes only the size segment", () => {
    expect(artUrlForStep(ART, 0)).toContain("/8x8bb.jpg");
    expect(artUrlForStep(ART, 5)).toContain("/300x300bb.jpg");
    expect(artUrlForStep(ART, 0)).toContain("886445438048.jpg");
  });

  it("returns null for a missing url or a bad step", () => {
    expect(artUrlForStep(null, 0)).toBe(null);
    expect(artUrlForStep(ART, 9)).toBe(null);
    expect(artUrlForStep(ART, -1)).toBe(null);
  });

  it("only accepts the image host we expect", () => {
    // Never fetch an arbitrary attacker-supplied URL server-side.
    expect(artUrlForStep("https://evil.example.com/a/300x300bb.jpg", 0)).toBe(null);
  });
});

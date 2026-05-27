// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { secondsToMs, truncateAtCharBoundary } from "../src/helpers.js";

describe("secondsToMs", () => {
  it("converts seconds to milliseconds", () => {
    expect(secondsToMs(300)).toBe(300_000);
  });

  it("handles fractional seconds", () => {
    expect(secondsToMs(1.5)).toBe(1500);
  });

  it("returns 0 for 0", () => {
    expect(secondsToMs(0)).toBe(0);
  });
});

describe("truncateAtCharBoundary", () => {
  it("returns string unchanged when under limit", () => {
    expect(truncateAtCharBoundary("hello", 100)).toBe("hello");
  });

  it("truncates at character boundary", () => {
    const result = truncateAtCharBoundary("abcdefghij", 5);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(5);
    expect(result).toBe("abcde");
  });

  it("does not split multi-byte characters", () => {
    const emoji = "a\u{1F600}b";
    const result = truncateAtCharBoundary(emoji, 3);
    expect(result).toBe("a");
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(3);
  });

  it("handles empty string", () => {
    expect(truncateAtCharBoundary("", 10)).toBe("");
  });
});

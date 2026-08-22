import { describe, expect, it } from "vitest";

import { optionalNumber, parseArgs, parseDue } from "./args.mts";

describe("parseArgs", () => {
  it("separates positional words from flags", () => {
    const { positional, options } = parseArgs([
      "finish",
      "the",
      "pset",
      "--minutes",
      "180",
    ]);

    // The title is joined from the leftovers, so an unquoted `lockin add finish
    // the pset` still does the obvious thing.
    expect(positional).toEqual(["finish", "the", "pset"]);
    expect(options.get("minutes")).toBe("180");
  });

  it("accepts --name=value and splits on the first = only", () => {
    const { options } = parseArgs(["--due=2026-08-20", "--label=a=b"]);
    expect(options.get("due")).toBe("2026-08-20");
    expect(options.get("label")).toBe("a=b");
  });

  it("reads a flag followed by another flag as boolean", () => {
    const { options } = parseArgs(["--yes", "--minutes", "90"]);
    expect(options.get("yes")).toBe(true);
    expect(options.get("minutes")).toBe("90");
  });

  it("reads a trailing flag as boolean", () => {
    expect(parseArgs(["--all"]).options.get("all")).toBe(true);
  });
});

describe("optionalNumber", () => {
  it("returns undefined for anything that is not a number", () => {
    expect(optionalNumber("90")).toBe(90);
    expect(optionalNumber("soon")).toBeUndefined();
    expect(optionalNumber(true)).toBeUndefined();
    expect(optionalNumber(undefined)).toBeUndefined();
  });
});

describe("parseDue", () => {
  const TZ = "America/New_York";

  it("reads a bare date as the end of that local day", () => {
    // `new Date("2026-08-20")` would be UTC midnight — 8pm on the 19th here,
    // which turns "due Thursday" into a deadline that has already passed.
    expect(parseDue("2026-08-20", TZ)!.toISOString()).toBe(
      "2026-08-21T03:59:00.000Z",
    );
  });

  it("reads a wall-clock time in the user's zone", () => {
    expect(parseDue("2026-08-20T17:00", TZ)!.toISOString()).toBe(
      "2026-08-20T21:00:00.000Z",
    );
    expect(parseDue("2026-08-20 17:00", TZ)!.toISOString()).toBe(
      "2026-08-20T21:00:00.000Z",
    );
  });

  it("resolves the same wall-clock time to different instants across DST", () => {
    // 2026-03-08 is the US spring-forward: 17:00 is UTC-5 before it and UTC-4
    // after, and only zone-aware arithmetic gets both right.
    expect(parseDue("2026-03-07T17:00", TZ)!.toISOString()).toBe(
      "2026-03-07T22:00:00.000Z",
    );
    expect(parseDue("2026-03-09T17:00", TZ)!.toISOString()).toBe(
      "2026-03-09T21:00:00.000Z",
    );
  });

  it("returns null rather than guessing at unreadable input", () => {
    expect(parseDue("thursday", TZ)).toBeNull();
    expect(parseDue("20/08/2026", TZ)).toBeNull();
    expect(parseDue("2026-08-20T5pm", TZ)).toBeNull();
  });
});

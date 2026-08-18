import { describe, expect, it } from "vitest";

import { CaptureUnavailableError, parseCapture } from "@/lib/ai/capture";

describe("parseCapture", () => {
  it("fails with a setup hint rather than a stack trace when no key is set", async () => {
    // Vitest does not load .env.local, so the key is genuinely absent here.
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

    await expect(
      parseCapture("pset due Thursday", { timezone: "America/New_York" }),
    ).rejects.toThrow(CaptureUnavailableError);
  });

  it("never sends the request when the notes are empty of a key", async () => {
    await expect(
      parseCapture("anything", { timezone: "UTC" }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
  });
});

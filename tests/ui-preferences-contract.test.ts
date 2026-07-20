import { describe, expect, it } from "vitest";

import { UiAppearancePreferencesSchema } from "../src/contracts/ui-preferences.js";

describe("UI appearance preferences", () => {
  it.each(["SYSTEM", "DARK", "LIGHT"] as const)(
    "supports %s color mode as a local preference",
    (colorMode) => {
      expect(
        UiAppearancePreferencesSchema.parse({
          colorMode,
          marketColorConvention: "KR_RED_UP",
          density: "COMPACT",
          highContrast: false,
          reduceMotion: false,
          updatedAt: "2026-07-20T12:00:00+09:00",
          storage: "LOCAL_USER_PREFERENCE",
        }).colorMode,
      ).toBe(colorMode);
    },
  );

  it("rejects a preference that is not explicitly local", () => {
    expect(() =>
      UiAppearancePreferencesSchema.parse({
        colorMode: "DARK",
        marketColorConvention: "KR_RED_UP",
        density: "COMPACT",
        highContrast: false,
        reduceMotion: false,
        updatedAt: "2026-07-20T12:00:00+09:00",
        storage: "CLOUD",
      }),
    ).toThrow();
  });
});

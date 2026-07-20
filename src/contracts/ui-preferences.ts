import { z } from "zod";

export const UiAppearancePreferencesSchema = z.object({
  colorMode: z.enum(["SYSTEM", "DARK", "LIGHT"]),
  marketColorConvention: z.enum(["KR_RED_UP", "US_GREEN_UP"]),
  density: z.enum(["COMPACT", "COMFORTABLE"]),
  highContrast: z.boolean(),
  reduceMotion: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
  storage: z.literal("LOCAL_USER_PREFERENCE"),
});

export type UiAppearancePreferences = z.infer<
  typeof UiAppearancePreferencesSchema
>;

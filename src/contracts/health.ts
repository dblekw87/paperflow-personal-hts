import { z } from "zod";

export const HealthCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["PASS", "WARN", "FAIL", "NOT_APPLICABLE"]),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  asOf: z.string().datetime({ offset: true }),
  evidenceIds: z.array(z.string()),
});

export const HealthReportSchema = z.object({
  schemaVersion: z.literal(1),
  overall: z.enum(["PASS", "WARN", "FAIL"]),
  generatedAt: z.string().datetime({ offset: true }),
  mode: z.enum(["FIXTURE", "LIVE"]),
  referenceCommit: z.literal("885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc"),
  publicConfig: z.object({
    dataEnvironment: z.enum(["paper", "prod"]),
    hasCredentials: z.boolean(),
    hasPaperCredentials: z.boolean(),
    hasProdDataCredentials: z.boolean(),
    hasHtsId: z.boolean(),
    domesticSymbol: z.string(),
    usExchange: z.string(),
    usSymbol: z.string(),
    cmeDataMode: z.enum(["proxy", "disabled"]),
    nasdaqProxy: z.string(),
    russellProxy: z.string(),
    oilProxy: z.string(),
    probeSeconds: z.number(),
    hasOpenDartKey: z.boolean(),
    hasSecUserAgent: z.boolean(),
  }),
  checks: z.array(HealthCheckSchema),
});

export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type HealthReport = z.infer<typeof HealthReportSchema>;

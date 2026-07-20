import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
} from "../config/runtime-config.js";
import { runHealth } from "../health/health.js";

const config = loadRuntimeConfig();
const live = process.argv.includes("--live") || config.KIS_HEALTH_LIVE;

if (live) {
  try {
    assertLiveReadOnlyAcknowledgement(config);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Live acknowledgement is missing",
    );
    process.exitCode = 2;
  }
}

if (process.exitCode !== 2) {
  const report = await runHealth(config, live ? "LIVE" : "FIXTURE");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.overall === "FAIL" ? 1 : 0;
}

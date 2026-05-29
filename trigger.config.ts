import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_qfxglvucjwexisvbapds",
  dirs: ["src/trigger"],
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
});

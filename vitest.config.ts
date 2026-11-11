import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workerLimit = process.env.TASKER_TEST_WORKERS;
const maxWorkers = workerLimit === undefined || workerLimit === "" ? "25%" : workerLimit;

if (
  !/^\d+%?$/.test(maxWorkers) ||
  !Number.isSafeInteger(Number.parseInt(maxWorkers, 10)) ||
  Number.parseInt(maxWorkers, 10) <= 0
) {
  throw new Error(`Invalid TASKER_TEST_WORKERS=${JSON.stringify(maxWorkers)}`);
}

export default defineConfig({
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent": fileURLToPath(new URL("./test/helpers/pi-bash-module.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    maxWorkers,
    env: existsSync("/dev/shm") ? { TMPDIR: "/dev/shm" } : {},
  },
});

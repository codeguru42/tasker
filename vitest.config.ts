import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: existsSync("/dev/shm") ? { TMPDIR: "/dev/shm" } : {},
  },
});

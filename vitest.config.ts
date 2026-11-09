import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent": fileURLToPath(new URL("./test/helpers/pi-bash-module.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    env: existsSync("/dev/shm") ? { TMPDIR: "/dev/shm" } : {},
  },
});

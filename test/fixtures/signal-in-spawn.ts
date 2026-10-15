import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

// Makes the next spawn() send signal to this process right before the child starts. As a result, the signal
// comes while spawn() runs. Later calls of spawn() do not change.
export function signalInNextSpawn(signal: NodeJS.Signals): void {
  const real = cp.spawn;
  cp.spawn = ((...args: Parameters<typeof real>) => {
    cp.spawn = real;
    syncBuiltinESMExports();
    process.kill(process.pid, signal);
    return real(...args);
  }) as typeof real;
  syncBuiltinESMExports();
}

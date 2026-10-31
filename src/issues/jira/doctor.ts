import type { Check } from "../../doctor/check.js";
import type { IssueDoctorRepo } from "../provider.js";

// Stub: the green commit replaces it.
export function jiraAuthCheck(repos: readonly IssueDoctorRepo[], timeoutMs = 15000): Check {
  throw new Error(`not implemented: ${repos.length} ${timeoutMs}`);
}

// Stub: the green commit replaces it.
export function jiraDoctorChecks(repos: readonly IssueDoctorRepo[]): Check[] {
  throw new Error(`not implemented: ${repos.length}`);
}

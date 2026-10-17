// The quota facts of the claude stream. Each rule of the rate-limit events has one function here.
import { isObject } from "../../object.js";
import type { AssistantEvent, OverageStop, QuotaApprovalWarning, RunOutcome } from "../provider.js";
import { numberOf } from "./stream.js";

// Whether the event is a rate_limit_event. It does not look at rate_limit_info, because tasker keeps each event as it came.
export function isQuotaEvent(event: AssistantEvent): boolean {
  return event.type === "rate_limit_event";
}

// The rate_limit_info of a rate_limit_event, or undefined for any other event or a bad info.
function rateLimitInfoOf(event: AssistantEvent): Record<string, unknown> | undefined {
  if (!isQuotaEvent(event)) return undefined;
  const info = event.rate_limit_info;
  return isObject(info) ? info : undefined;
}

// The unifiedWindows entry of a window name, when unifiedWindows and the entry are objects.
function unifiedEntry(info: Record<string, unknown>, name: unknown): Record<string, unknown> | undefined {
  if (typeof name !== "string") return undefined;
  const windows = info.unifiedWindows;
  if (!isObject(windows)) return undefined;
  const entry = windows[name];
  return isObject(entry) ? entry : undefined;
}

// The relevant window: the use and the reset time for the approval threshold.
function relevantWindow(info: Record<string, unknown>): QuotaApprovalWarning | undefined {
  const type = info.rateLimitType;
  let source: Record<string, unknown> | undefined;
  if (type === "overage") {
    source = info.isUsingOverage === true ? info : undefined;
  } else {
    source = unifiedEntry(info, type) ?? info;
  }
  if (source === undefined) return undefined;
  const utilization = numberOf(source.utilization);
  if (utilization === undefined) return undefined;
  const resetsAt = numberOf(source.resetsAt);
  return resetsAt === undefined ? { utilization } : { utilization, resetsAt };
}

// The reset time of the spent window, for an overage stop. Never the cap of paid usage.
function spentResetsAt(info: Record<string, unknown>): number | undefined {
  const type = info.rateLimitType;
  if (typeof type === "string" && type !== "overage") {
    return numberOf(unifiedEntry(info, type)?.resetsAt) ?? numberOf(info.resetsAt);
  }
  const windows = info.unifiedWindows;
  if (!isObject(windows)) return undefined;
  let best: { utilization: number; resetsAt: number } | undefined;
  for (const entry of Object.values(windows)) {
    if (!isObject(entry)) continue;
    const utilization = numberOf(entry.utilization);
    const resetsAt = numberOf(entry.resetsAt);
    if (utilization === undefined || resetsAt === undefined) continue;
    if (best === undefined || utilization > best.utilization) best = { utilization, resetsAt };
  }
  return best?.resetsAt;
}

// The facts of an overage stop when the event shows the start of paid usage in a window that the operator did not approve.
export function overageStopOf(event: AssistantEvent, overageStop: OverageStop): { resetsAt?: number } | undefined {
  const info = rateLimitInfoOf(event);
  if (info === undefined) return undefined;
  const overageStatus = info.overageStatus;
  const paid =
    info.isUsingOverage === true ||
    (info.status === "rejected" && (overageStatus === "allowed" || overageStatus === "allowed_warning"));
  if (!paid) return undefined;
  const resetsAt = spentResetsAt(info);
  if (resetsAt !== undefined && overageStop.approvedResetsAt === resetsAt) return undefined;
  return resetsAt === undefined ? {} : { resetsAt };
}

// The facts of a quota stop when the rate limit stopped the run, else undefined.
export function quotaStopOf(
  events: readonly AssistantEvent[],
  exitCode: number | null,
): { resetsAt?: number } | undefined {
  if (exitCode === 0) return undefined;
  const last = events.at(-1);
  if (last?.type !== "result" || last.terminal_reason !== "api_error" || last.api_error_status !== 429) {
    return undefined;
  }
  let resetsAt: number | undefined;
  for (const event of events) {
    const info = rateLimitInfoOf(event);
    if (info?.status === "rejected") resetsAt = numberOf(info.resetsAt);
  }
  return resetsAt === undefined ? {} : { resetsAt };
}

export function detectQuotaApprovalWarning(outcome: RunOutcome, threshold: number): QuotaApprovalWarning | undefined {
  let kept: QuotaApprovalWarning | undefined;
  for (const event of outcome.events) {
    const info = rateLimitInfoOf(event);
    if (info?.status !== "allowed_warning") continue;
    kept = relevantWindow(info) ?? kept;
  }
  return kept !== undefined && kept.utilization >= threshold ? kept : undefined;
}

export function shouldSuppressQuotaApprovalPause(
  warning: QuotaApprovalWarning,
  approvedResetsAt: number | undefined,
): boolean {
  return approvedResetsAt !== undefined && warning.resetsAt === approvedResetsAt;
}

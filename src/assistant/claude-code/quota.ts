// The quota facts of the claude stream. Each rule of the rate-limit events has one function here.
import { isObject } from "../../object.js";
import type { AssistantEvent, QuotaApprovalWarning, RunOutcome } from "../provider.js";

// A number field. A value that is not a finite number counts as missing.
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// The rate_limit_info of a rate_limit_event, or undefined for any other event or a bad info.
function rateLimitInfoOf(event: AssistantEvent): Record<string, unknown> | undefined {
  if (event["type"] !== "rate_limit_event") return undefined;
  const info = event["rate_limit_info"];
  return isObject(info) ? info : undefined;
}

// The unifiedWindows entry of a window name, when unifiedWindows and the entry are objects.
function unifiedEntry(info: Record<string, unknown>, name: unknown): Record<string, unknown> | undefined {
  if (typeof name !== "string") return undefined;
  const windows = info["unifiedWindows"];
  if (!isObject(windows)) return undefined;
  const entry = windows[name];
  return isObject(entry) ? entry : undefined;
}

// The relevant window: the use and the reset time for the approval threshold.
function relevantWindow(info: Record<string, unknown>): QuotaApprovalWarning | undefined {
  const type = info["rateLimitType"];
  let source: Record<string, unknown> | undefined;
  if (type === "overage") {
    source = info["isUsingOverage"] === true ? info : undefined;
  } else {
    source = unifiedEntry(info, type) ?? info;
  }
  if (source === undefined) return undefined;
  const utilization = numberOf(source["utilization"]);
  if (utilization === undefined) return undefined;
  const resetsAt = numberOf(source["resetsAt"]);
  return resetsAt === undefined ? { utilization } : { utilization, resetsAt };
}

export function detectQuotaApprovalWarning(outcome: RunOutcome, threshold: number): QuotaApprovalWarning | undefined {
  let kept: QuotaApprovalWarning | undefined;
  for (const event of outcome.events) {
    const info = rateLimitInfoOf(event);
    if (info === undefined || info["status"] !== "allowed_warning") continue;
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

export type CheckStatus = "ok" | "warn" | "error";

export interface CheckResult {
  status: CheckStatus;
  detail: string;
  remediation?: string;
}

// One doctor check. run() never rejects and does not wait longer than timeoutMs.
export interface Check {
  name: string;
  required: boolean;
  timeoutMs: number;
  run(env: NodeJS.ProcessEnv): Promise<CheckResult>;
}

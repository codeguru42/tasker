import { isObject } from "../../object.js";

function retryAfterValues(headers: Record<string, unknown>): string[] | undefined {
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === "retry-after")
    .map(([, value]) => value);
  if (values.length === 0 || values.some((value) => typeof value !== "string")) return undefined;
  return (values as string[]).map((value) => value.replace(/^[ \t]+|[ \t]+$/g, ""));
}

function parsedRetryAfter(body: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isObject(parsed)) return undefined;
    const metadata = Object.hasOwn(parsed, "metadata")
      ? parsed.metadata
      : isObject(parsed.error)
        ? parsed.error.metadata
        : undefined;
    if (!isObject(metadata) || !isObject(metadata.headers)) return undefined;
    return retryAfterValues(metadata.headers);
  } catch {
    const marker = /\.\.\. \[truncated [0-9]+ chars\]/.exec(body);
    if (!marker) return undefined;
    const text = body.slice(0, marker.index);
    const values: string[] = [];
    const key = /"retry-after"\s*:\s*/gi;
    const value = /"(?:\\.|[^"\\])*"/y;
    for (const match of text.matchAll(key)) {
      value.lastIndex = (match.index ?? 0) + match[0].length;
      const valueMatch = value.exec(text);
      if (!valueMatch) return undefined;
      try {
        const parsedValue: unknown = JSON.parse(valueMatch[0]);
        if (typeof parsedValue !== "string") return undefined;
        values.push(parsedValue.replace(/^[ \t]+|[ \t]+$/g, ""));
      } catch {
        return undefined;
      }
    }
    return values.length > 0 ? values : undefined;
  }
}

function resetTimeOf(value: string): number | undefined {
  if (/^[0-9]+$/.test(value)) {
    const resetsAt = Math.floor(Date.now() / 1000) + Number(value);
    return Number.isSafeInteger(resetsAt) ? resetsAt : undefined;
  }

  const match =
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, , dayText, monthText, yearText, hourText, minuteText, secondText] = match;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = Number(dayText);
  const month = months.indexOf(monthText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;

  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  const resetsAt = Math.floor(date.getTime() / 1000);
  return Number.isSafeInteger(resetsAt) ? resetsAt : undefined;
}

export function quotaStopOf(message: unknown): { resetsAt?: number } | undefined {
  if (!isObject(message) || message.role !== "assistant" || message.stopReason !== "error") return undefined;
  if (typeof message.errorMessage !== "string") return undefined;
  const match = /^(?:402: |402 )([\s\S]*)$/.exec(message.errorMessage);
  if (!match) return undefined;
  const body = match[1].split("\n", 1)[0];
  const values = parsedRetryAfter(body);
  if (!values || values.some((value) => value !== values[0])) return {};
  const resetsAt = resetTimeOf(values[0]);
  return resetsAt === undefined ? {} : { resetsAt };
}

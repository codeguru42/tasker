import { isObject } from "../../object.js";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The model that pi reported for a run, as <provider>/<id>, or undefined when pi reported none.
// Only the first assistant message that did not end in an error counts.
export function piReportedModel(messages: readonly unknown[]): string | undefined {
  const first = messages.find(
    (message) =>
      isObject(message) &&
      message.role === "assistant" &&
      message.stopReason !== "error" &&
      message.stopReason !== "aborted",
  );
  if (!isObject(first)) return undefined;
  const provider = nonEmpty(first.provider);
  const id = nonEmpty(first.responseModel) ?? nonEmpty(first.model);
  return provider === undefined || id === undefined ? undefined : `${provider}/${id}`;
}

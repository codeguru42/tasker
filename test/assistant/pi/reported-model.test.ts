import { describe, expect, it } from "vitest";
import { piReportedModel } from "../../../src/assistant/pi/reported-model.js";
import { piAssistantMessage, REPORTED_PI_MODEL, ROUTER_PI_MODEL } from "../../helpers/pi-provider.js";

describe("piReportedModel", () => {
  it("gives the provider and the response model", () => {
    expect(piReportedModel([piAssistantMessage()])).toBe(REPORTED_PI_MODEL);
  });

  it("falls back to the model when the message has no response model", () => {
    expect(piReportedModel([piAssistantMessage({ responseModel: undefined })])).toBe(ROUTER_PI_MODEL);
  });

  it.each(["error", "aborted"])("skips a message with the stop reason %s", (stopReason) => {
    expect(piReportedModel([piAssistantMessage({ stopReason }), piAssistantMessage()])).toBe(REPORTED_PI_MODEL);
  });

  it("gives undefined for a user message only", () => {
    expect(piReportedModel([{ role: "user", content: [] }])).toBeUndefined();
  });

  it("gives undefined when the first good message has no provider", () => {
    expect(piReportedModel([piAssistantMessage({ provider: undefined }), piAssistantMessage()])).toBeUndefined();
  });

  it("gives undefined for an empty list", () => {
    expect(piReportedModel([])).toBeUndefined();
  });
});

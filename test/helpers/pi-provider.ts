import { createPiProvider as fromCreatePiProvider } from "../../src/assistant/pi/provider.js";
import type { AssistantProvider } from "../../src/assistant/provider.js";

export function createPiProvider(): AssistantProvider {
  return fromCreatePiProvider();
}

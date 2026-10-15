import { createSessionProvider } from "../assistant/provider.js";
import type { StoredSession } from "../store/store.js";

// Throws when the provider of a recorded session refuses its model. name opens the message, for example
// "the plan session of codeguru42/tasker#5".
export async function assertSessionModel(
  session: StoredSession,
  env: NodeJS.ProcessEnv,
  name: string,
): Promise<void> {
  const selected = createSessionProvider(session);
  for (const check of selected.provider.modelChecks(session.model)) {
    const result = await check.run(env);
    if (result.status === "error") {
      throw new Error(`${name} runs on ${session.model}, and ${session.provider} refuses it: ${result.detail}`);
    }
  }
}

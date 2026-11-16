import { createSessionProvider } from "../assistant/provider.js";
import type { StoredSession } from "../store/store.js";

// Throws when the provider of a continued session refuses the model that the session runs on. That is the model checks of the
// provider, and for a model other than the recorded model, also its checks for a reported model. name opens the
// message, for example "the plan session of codeguru42/tasker#5".
export async function assertSessionModel(session: StoredSession, env: NodeJS.ProcessEnv, name: string): Promise<void> {
  const selected = createSessionProvider(session);
  const checks = [
    ...selected.provider.modelChecks(selected.model),
    ...(selected.model === session.model ? [] : selected.provider.reportedModelChecks(session.model, selected.model)),
  ];
  for (const check of checks) {
    const result = await check.run(env);
    if (result.status === "error") {
      throw new Error(`${name} runs on ${selected.model}, and ${session.provider} refuses it: ${result.detail}`);
    }
  }
}

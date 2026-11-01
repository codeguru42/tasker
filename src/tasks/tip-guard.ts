import { errorMessage } from "../error-message.js";
import type { RemoteTip, VcsContext, VcsProvider } from "../vcs/provider.js";
import { tipMoved } from "../vcs/remote-tip.js";

export interface TipGuard {
  // The failure message when the tip moved or the read failed. Otherwise undefined.
  tipFailure(): Promise<string | undefined>;
}

// Reads the tip of the task branch on the remote before a run. A failed read throws.
export async function startTipGuard(vcs: VcsProvider, ctx: VcsContext, branch: string): Promise<TipGuard> {
  let before: RemoteTip;
  try {
    before = await vcs.remoteTaskRefTip(ctx, { taskRef: branch });
  } catch (error) {
    throw new Error(`cannot read the remote before the run: ${errorMessage(error)}`, { cause: error });
  }
  return {
    // Layer 3 of the push guard: the tip of the task branch on the remote must not move. A push wins over
    // every outcome, a quota stop included.
    async tipFailure() {
      try {
        const moved = tipMoved(before, await vcs.remoteTaskRefTip(ctx, { taskRef: branch }));
        return moved === undefined ? undefined : `push detected on ${branch}: ${moved}`;
      } catch (error) {
        return `cannot read the remote after the run: ${errorMessage(error)}`;
      }
    },
  };
}

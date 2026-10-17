import type { RegisterCommand } from "../cli.js";
import { abort } from "./abort.js";
import { accept } from "./accept.js";
import { approve } from "./approve.js";
import { doctor } from "./doctor.js";
import { execute } from "./execute.js";
import { finish } from "./finish.js";
import { markLanded } from "./mark-landed.js";
import { merge } from "./merge.js";
import { model } from "./model.js";
import { show } from "./show.js";
import { plan } from "./plan.js";
import { refine } from "./refine.js";
import { retry } from "./retry.js";
import { dismissReview } from "./dismiss-review.js";
import { review } from "./review.js";
import { showBootstrap } from "./show-bootstrap.js";
import { showPlan } from "./show-plan.js";
import { showQuestions } from "./show-questions.js";
import { showReview } from "./show-review.js";
import { showVerify } from "./show-verify.js";
import { showConfig } from "./show-config.js";
import { showQuota } from "./show-quota.js";
import { start } from "./start.js";
import { status } from "./status.js";
import { unapprove } from "./unapprove.js";
import { verify } from "./verify.js";

export const commands: RegisterCommand[] = [
  showConfig,
  showQuota,
  show,
  showBootstrap,
  showPlan,
  showQuestions,
  showVerify,
  showReview,
  start,
  plan,
  refine,
  approve,
  unapprove,
  execute,
  verify,
  review,
  dismissReview,
  retry,
  accept,
  merge,
  markLanded,
  finish,
  abort,
  status,
  doctor,
  model,
];

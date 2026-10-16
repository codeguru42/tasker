import type { RegisterCommand } from "../cli.js";
import { abort } from "./abort.js";
import { accept } from "./accept.js";
import { approve } from "./approve.js";
import { doctor } from "./doctor.js";
import { execute } from "./execute.js";
import { model } from "./model.js";
import { show } from "./show.js";
import { plan } from "./plan.js";
import { refine } from "./refine.js";
import { retry } from "./retry.js";
import { review } from "./review.js";
import { showBootstrap } from "./show-bootstrap.js";
import { showPlan } from "./show-plan.js";
import { showQuestions } from "./show-questions.js";
import { showReview } from "./show-review.js";
import { showVerify } from "./show-verify.js";
import { showConfig } from "./show-config.js";
import { start } from "./start.js";
import { status } from "./status.js";
import { unapprove } from "./unapprove.js";
import { verify } from "./verify.js";

export const commands: RegisterCommand[] = [
  showConfig,
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
  retry,
  accept,
  abort,
  status,
  doctor,
  model,
];

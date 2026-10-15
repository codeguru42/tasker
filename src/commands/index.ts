import type { RegisterCommand } from "../cli.js";
import { abort } from "./abort.js";
import { approve } from "./approve.js";
import { doctor } from "./doctor.js";
import { execute } from "./execute.js";
import { model } from "./model.js";
import { show } from "./show.js";
import { plan } from "./plan.js";
import { refine } from "./refine.js";
import { showBootstrap } from "./show-bootstrap.js";
import { showPlan } from "./show-plan.js";
import { showQuestions } from "./show-questions.js";
import { showConfig } from "./show-config.js";
import { start } from "./start.js";
import { status } from "./status.js";
import { unapprove } from "./unapprove.js";

export const commands: RegisterCommand[] = [showConfig, show, showBootstrap, showPlan, showQuestions, start, plan, refine, approve, unapprove, execute, abort, status, doctor, model];

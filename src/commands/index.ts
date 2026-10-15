import type { RegisterCommand } from "../cli.js";
import { abort } from "./abort.js";
import { doctor } from "./doctor.js";
import { model } from "./model.js";
import { show } from "./show.js";
import { plan } from "./plan.js";
import { showBootstrap } from "./show-bootstrap.js";
import { showPlan } from "./show-plan.js";
import { showQuestions } from "./show-questions.js";
import { showConfig } from "./show-config.js";
import { start } from "./start.js";
import { status } from "./status.js";

export const commands: RegisterCommand[] = [showConfig, show, showBootstrap, showPlan, showQuestions, start, plan, abort, status, doctor, model];

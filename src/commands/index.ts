import type { RegisterCommand } from "../cli.js";
import { abort } from "./abort.js";
import { doctor } from "./doctor.js";
import { show } from "./show.js";
import { showBootstrap } from "./show-bootstrap.js";
import { showConfig } from "./show-config.js";
import { start } from "./start.js";
import { status } from "./status.js";

export const commands: RegisterCommand[] = [showConfig, show, showBootstrap, start, abort, status, doctor];

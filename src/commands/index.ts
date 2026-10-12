import type { RegisterCommand } from "../cli.js";
import { showConfig } from "./show-config.js";
import { status } from "./status.js";

export const commands: RegisterCommand[] = [showConfig, status];

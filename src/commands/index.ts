import type { RegisterCommand } from "../cli.js";
import { showConfig } from "./show-config.js";

export const commands: RegisterCommand[] = [showConfig];

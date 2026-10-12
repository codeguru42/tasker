// The commit rules of the execute prompt. The caller replaces {{BASE_REF}} with the base revision.
export const EXECUTE_COMMIT_TEXT = [
  "Commit each red/green pair, or each completed todo, as its own commit. Never collect the whole plan into one commit at the end. If a run stops partway (a quota limit, a timeout), the work that it finished must stay committed.",
  "The branch can already hold commits from an earlier execute run of an earlier revision of this plan. Before you start, run `git log --reverse {{BASE_REF}}..HEAD` and read what is there. Build on that work. Do not do it again.",
].join("\n\n");

// The deny rules for the shell of the assistant, in the rule syntax of Claude Code.
export const DENY_RULES: readonly string[] = [];

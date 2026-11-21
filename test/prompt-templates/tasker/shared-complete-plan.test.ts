import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-complete-plan.md');

describe('shared-complete-plan', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "The plan must be complete on its own. A new session carries out the approved plan. It gets only the plan, its todos and the answered questions, not this conversation. Write in the plan each file and code path that you read and what you found, each limit that you found, and how each question was answered.")).toEqual([]);
  });
});

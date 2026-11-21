import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-no-question-skill.md');

describe('shared-no-question-skill', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "Never use a skill that asks a person questions, for example `brainstorming`. No person can answer, so the skill waits until the deadline or makes up answers.")).toEqual([]);
  });
});

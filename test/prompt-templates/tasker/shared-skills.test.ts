import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-skills.md');

describe('shared-skills', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "Before you do anything else, use these skills by their bare name, with no plugin prefix: `simple-english`, so that all text for a person is plain English; `writing-plans`, to structure the plan; and `test-driven-development`, so that the todos are red and green steps that a later run can follow test-first.")).toEqual([]);
  });
});

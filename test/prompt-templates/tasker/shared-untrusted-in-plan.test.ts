import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-untrusted-in-plan.md');

describe('shared-untrusted-in-plan', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "If it holds one, say so in the plan.")).toEqual([]);
  });
});

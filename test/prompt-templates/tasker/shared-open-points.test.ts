import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-open-points.md');

describe('shared-open-points', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "Put each real open point that the code cannot answer in `questions`. If the requirements are clear, leave `questions` empty.")).toEqual([]);
  });
});

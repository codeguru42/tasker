import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-answer-lead.md');

describe('shared-answer-lead', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "Return only the structured answer, with exactly these five keys:")).toEqual([]);
  });
});

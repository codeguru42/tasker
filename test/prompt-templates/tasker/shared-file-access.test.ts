import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-file-access.md');

describe('shared-file-access', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "Do not change any file. Do not write a file outside your working folder with any tool, also not with the shell.")).toEqual([]);
  });
});

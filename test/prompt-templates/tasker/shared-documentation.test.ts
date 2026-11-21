import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-documentation.md');

describe('shared-documentation', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "Find each document of the repository that the change makes wrong. That is a document that describes behavior that a user sees (a command, its output, a state, a configuration key, a folder layout), or a procedure that the change affects. Give each one a todo. `plan_markdown` must have a `## Documentation` section. It lists each such document with its todo, or it says that no document needs a change and names what you looked at.")).toEqual([]);
  });
});

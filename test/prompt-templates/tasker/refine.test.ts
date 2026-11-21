import { describe, expect, it } from 'vitest';
import { promptFileProblems } from '../../helpers/prompt-templates.js';

describe('refine', () => {
  it('is a valid prompt file that fills with no problem', () => {
    expect(
      promptFileProblems('refine', {
  CURRENT_PLAN: "sample",
  BRANCH_COMMITS: "sample",
  CONTEXT: "sample",
  FEEDBACK: "sample",
  OPEN_QUESTIONS: "sample",
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { promptFileProblems } from '../../helpers/prompt-templates.js';

describe('plan', () => {
  it('is a valid prompt file that fills with no problem', () => {
    expect(
      promptFileProblems('plan', {
  ISSUE_TEXT: "sample",
  ISSUE_COMMENTS: "sample",
      }),
    ).toEqual([]);
  });
});

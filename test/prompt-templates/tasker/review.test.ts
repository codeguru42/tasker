import { describe, expect, it } from 'vitest';
import { promptFileProblems } from '../../helpers/prompt-templates.js';

describe('review', () => {
  it('is a valid prompt file that fills with no problem', () => {
    expect(
      promptFileProblems('review', {
  EARLIER_REVIEWS: "sample",
  BRANCH_COMMITS: "sample",
      }),
    ).toEqual([]);
  });
});

const TOKEN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

// docs/dev/assistants.md gives the reason for the tags.
const UNTRUSTED_TOKENS: Readonly<Record<string, string>> = {
  ISSUE_TEXT: "issue-text",
  CURRENT_PLAN: "current-plan",
  BRANCH_COMMITS: "branch-commits",
  EARLIER_REVIEWS: "earlier-reviews",
  CONTEXT: "context",
  FEEDBACK: "feedback",
  OPEN_QUESTIONS: "open-questions",
  PLAN_MARKDOWN: "approved-plan",
  TODOS: "todos",
  RESOLVED_QUESTIONS: "resolved-questions",
  CURRENT_TODO: "current-todo",
  VERIFY_FAILURE: "verify-failure",
  VERIFY_LOG: "verify-log",
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

export function fillTemplate(name: string, template: string, values: Readonly<Record<string, string>>): string {
  const tokens = new Set([...template.matchAll(TOKEN)].map((match) => match[1]));
  for (const token of tokens) {
    if (!Object.hasOwn(values, token)) throw new Error(`prompt ${name} needs a value for {{${token}}}`);
  }
  for (const key of Object.keys(values)) {
    if (!tokens.has(key)) throw new Error(`prompt ${name} has no {{${key}}} to fill`);
  }
  for (const [token, tag] of Object.entries(UNTRUSTED_TOKENS)) {
    if (!tokens.has(token)) continue;
    const placeholder = `{{${token}}}`;
    if (countOf(template, placeholder) !== countOf(template, `<${tag}>${placeholder}</${tag}>`)) {
      throw new Error(`prompt ${name} must put ${placeholder} in <${tag}>...</${tag}>`);
    }
  }

  return template.replace(TOKEN, (_match, token: string) => {
    const value = values[token];
    const tag = UNTRUSTED_TOKENS[token];
    if (tag === undefined) return value;
    return value.replace(new RegExp(`<(\\s*\\/\\s*${escapeRegExp(tag)}\\b)`, "gi"), "&lt;$1");
  });
}

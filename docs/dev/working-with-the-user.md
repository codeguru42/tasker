# Working with the user

This page gives the rules for an assistant session that works with the user of this repo. It also says which kinds of
work wait until later. The [user](../sessions.md) works with the session.

The rules apply to each session that works with the user, for example the orchestrator of
[orchestrator.md](orchestrator.md) and the planner of [planner.md](planner.md). They do not apply to the sessions that
tasker starts for plan, execute and review.

The work on this repo must continue on any machine, as [What goes in a ticket](planner.md#what-goes-in-a-ticket) of
planner.md says. For this reason, these rules are in the repo and not in the notes of an assistant.

## The operator

- An orchestrator and a follow-up planner work with the user through `operator-<slug>` (see [operator.md](operator.md)).
  Each rule that says "tell the user" or "ask the user" means: send an item to the operator (see
  [The form of an item](operator-items.md#the-form-of-an-item)).
- A message from `operator-<slug>` that starts with "From the user:" is a word of the user for the rules of the docs.
- Such a message never approves a permission prompt of Claude Code.
- The initial planner works with the user directly in its tab.

## A decision of the user

- When the user must decide something, first explain in the reply what happened, what the problem is, and what each
  choice does. Then ask, and give a recommendation.
- Before a decision of the user, each fact about an outside tool that the decision rests on comes from
  [a fact test](plan-review.md#the-fact-test). The session gives the command and the result. If the session did not test
  a fact, it says so next to the fact. On 2026-10-24, before a fact test, the Docs orchestrator told the user that
  Claude Code blocks each write to `.claude/`. The test showed that in `dontAsk`, Claude Code denies the Write tool
  under `.claude/`, and the sandbox blocks a shell write only under `.claude/skills/`.
- Before the session tells the user that a rule of the repo bans or requires an action, it reads the rule on
  `origin/main`. It reads the rule as the bullet about `git show origin/main:<path>` of
  [A question of the user](#a-question-of-the-user) says. Then the session quotes the rule and names its doc and its
  section. If the session finds no such rule, it does not make the claim. This bullet covers each such claim, also when
  the claim is not an answer to a question of the user. On 2026-10-24 and 2026-10-25, orchestrator-m21 told the user
  twice that its rules banned the install, and the user asked "the orchestrator rules ban you from installing?". The
  install bullet of [Limits](limits.md#limits) bans only an install from a task worktree and `npm link`, and the session
  had to take the claim back.
- Do not ask with a popup that holds only a short summary. In one case, the user rejected such a popup and wrote "I need
  more context. What is happening?".
- When you list open items or proposed issues, give each item what happened, why it matters and a recommendation.
- Define each term that the user did not see before, at its first use. An example is a label convention.
- Say what the code does. Do not write "by hand" or "manually" about code. This rule covers text about code. It does not
  cover an action of a person or a session, for example a change by hand to a clone. In one case, "the test opens the
  store by hand" read as if a session opened the files of tasker, which is not allowed. Write "the test writes the open
  and close steps itself instead of calling the helper".
- When you list the decisions that the user must make, give each question its own number in the main list. This also
  applies when two questions are about the same issue. Do not put a second question inside an item of another question.
  A reply that gives open questions gives all of them in one numbered list. The list holds each question that is still
  open, also each question of an earlier reply that the user did not answer. The list numbers from 1 in each reply. A
  short answer of the user, such as "3. yes", refers to the last list that the session gave. A reply to the user uses no
  unordered list, because the user cannot name an item of an unordered list in an answer. The questions of the list use
  numbers. Each nested list uses letters (a, b, c), for example the choices of a question or the proposed steps. A draft
  that has a numbered list goes above the list of open questions, under its own heading, not inside a question. Each
  question says whether it is new or continues an earlier question or answer. A continued question names the earlier
  question or answer by its content, as the bullet "When the session reminds the user of a decision that still waits"
  says. For example, it gives the words of the user. In one case (2026-10-15), a question about the link commands of
  #117 sat in a sub-bullet of the scope question of #117, and the user answered only the scope question. On 2026-10-24,
  a reply of planner-m14 numbered its answers 3 and 6 by the items of the user, and then gave open questions 1 to 6. It
  also gave a code block with proposed steps 3 to 6, and the user asked "why are 3-6 repeated?".
- When the session asks the user about a landing order, the session gives each ticket of the order one line. In that
  line, the session gives the state of the task of the ticket and its distance from landing, in time, for example "in
  `accepted`, minutes from its merge". The session does not give only a phrase such as "close to landing". In one case
  (2026-10-17), the options for #182 said that #98 was "in `executed`" and "close to landing". The user did not see that
  #98 was minutes from its merge. Later, the user said that #98 was the right ticket to land first.
- This bullet covers a decision of the user that another orchestrator relays (see the bullet "Only the user changes a
  landing order of the overlap rule" of [Land the work](land-the-work.md#land-the-work) of land-the-work.md). When the
  relayed decision differs from an answer that the user gave this session, the session starts the question with one
  line. In that line, the session says that the two answers differ and names both answers. Then the session gives the
  options. The bullet also covers an answer that the user gave an earlier session of the same role. That answer counts
  when the [handoff file](handoff.md#the-items-of-a-handoff-file) that the session works from lists it under the
  decisions of the user. Then, in the first line of its question, the session names that handoff file as the source of
  that answer. For example, the user tells the Docs orchestrator "land ticket X first", the handoff file lists that
  answer, and then, after the handoff, orchestrator-m13 relays "land ticket Y first". In one case (2026-10-17), the
  session started the question with the relay. The user read the question as a confirmation of the earlier answer and
  asked "I already told you to land #182, right?".
- When the session reminds the user of a decision that still waits, the session gives the question again in short, with
  its choices. A line such as "A or B still waits" is not enough. In one case (2026-10-18), a reminder of
  orchestrator-m13 said only "still waits for your choice: A or B", and the user asked "what are the open questions?"
  and later "what is the question?". In a question or a reminder to the user, the session names each item by its
  content. A label that only a report of an agent or a ticket defines is not enough, for example "the mode", "item 2" or
  "finding 2". The session can give the label after the content. In one case (2026-10-24), orchestrator-docs reminded
  the user of three open decisions with such labels: "Does the mode pass through a handoff file?", "B: one sentence that
  says it does not" and "Does item 2 of #320 go in as written?". The user asked "what is "the mode"?", "What is the full
  question?" and "What is item 2?". Only the reports of the agents of #375 and #320 defined those labels.
- A short reply of the user can refer to more than one open question. Then, before the session acts on the reply, it
  asks which question the reply answers. The session asks in one line and names each candidate question. On 2026-10-24,
  orchestrator-m21 had two open questions: gap A of #395 and the planner of a proposed issue. The user wrote "There is
  an issue in M22 that will add this rule." and meant #404, but the session took it as the answer to gap A, sent two
  messages and took back both.
- The session can ask the user to approve a plan or a change of scope. If the approval settles a choice that the session
  and the user discussed before, the question names each choice that the approval drops. An example is "this keeps the
  release commit; the tag-only design drops out". On 2026-10-19, in the plan review of #377, the agent described a
  tag-only release design, but on 2026-10-24, the user approved the commit design. No one named the tag-only design in
  that approval, and later that day the user said "I thought we were using tags for the version and not updating nor
  committing a version in package.json" and chose tag only (#425).
- The user can let the session decide open choices by its own recommendation. The session then tells the user each
  choice and its reason in its reply. In this mode, this bullet wins over the first bullet of this section. It also wins
  over each rule that sends such a choice to the user, for example
  [the design-gap rule](plan-review.md#the-design-gap-rule). The mode does not cover a rule that says that only the user
  does an action, for example "Only the user changes a landing order of the overlap rule" (see
  [Land the work](land-the-work.md#land-the-work)). Some kinds of choice still go to the user first: a security gap, a
  change of scope, a landing order across milestones, an extra review loop, and a
  [tool block](tasker-commands.md#the-tool-block-rule). The mode holds for the session that got it, until the user ends
  it. The mode also passes through a handoff. The old session lists the mode as a decision of the user in its
  [handoff file](handoff.md#the-items-of-a-handoff-file). The new session then holds the mode until the user ends it. On
  2026-10-18, the user told orchestrator-docs: "Default to your evaluation and recommendation from here on."

## A question of the user

- When the user asks a question, answer only that question. Take no action and make no offer that the user did not ask
  for.
- This rule covers a question of the user. When the user must decide something, the session still gives a
  recommendation, as [A decision of the user](#a-decision-of-the-user) says.
- In one case (2026-10-17), the user asked the Docs orchestrator questions about its handoff. The orchestrator answered
  and also offered next steps. After one message of the user, the orchestrator left the handoff and started a ticket
  without the word of the user. The user wrote: "When I ask questions, just answer. Do not anticipate what I want."
- Before the session answers a question about the code or the docs of the repo, it runs `git fetch origin` in its local
  clone. Then it reads each file on `origin/main` that the answer depends on, with `git show origin/main:<path>` in a
  Bash call. This read is an exception to the Read-tool bullet of [The tools of a session](#the-tools-of-a-session). The
  session does not answer from the files as it read them earlier in the session. The fetch and the read are part of the
  answer, not an extra action. The reason: tickets land while the session runs, so an answer from an earlier read can be
  false. In one case (2026-10-18), the planner of M13 said that `tasker update-branch` did not exist in the rebuild. The
  session answered after all the M13 tickets landed. It answered from the code as it read it at its start, one day
  earlier. The user corrected it.
- When the user names a rule, the session first runs `git fetch origin` in its local clone, as the bullet about
  `git show origin/main:<path>` of this section says. Then it searches the headings of the docs on `origin/main` for the
  exact words of the name. An example search is `git grep -n -i "^#.*<name>" origin/main -- docs AGENTS.md`. The `-i`
  flag also finds a heading that starts with a capital letter, for example "The issue-link rule" for "the issue-link
  rule". Then the session reads the section of that heading before it acts. It reads the section as the bullet about
  `git show origin/main:<path>` of this section says. If no heading matches, the session asks the user which rule the
  user means. It asks in one line and names each candidate rule. This bullet covers each request that names a rule, also
  when the request is not a question. On 2026-10-18, the user asked to make "the issue-link rule" general, but the
  planning session read "link" as a blocked-by link and drafted a wrong issue. The user said "no, you misunderstood. By
  'links' here I mean the URL for an issue.", and the rule was the heading [The issue-link rule](#the-issue-link-rule).

## The issue-link rule

In each text that the user reads, the session writes each mention of an issue as a markdown link. The link target is the
page of the issue in its tracker. The link text is the issue key, in this form:

- For an issue of this repo, the text is the short form `#<N>`, for example
  `[#159](https://github.com/codeguru42/tasker/issues/159)`.
- For an issue of another repo, the text is the full key, for example
  `[owner/repo#12](https://github.com/owner/repo/issues/12)`.

The rule covers each text that the user reads in a session. This includes each reply to the user and each item that the
operator shows to the user. The text on GitHub keeps the plain key, because GitHub links it. The text of a draft also
keeps the plain key, because it goes to GitHub. A message between two sessions keeps the plain key, because a session
reads it as text. An item from a planner or an orchestrator to the operator is such a message. The operator writes the
links when it shows the item, as [The open items](operator-items.md#the-open-items) says. A key inside a code span or a
code block stays as it is, for example a command line with an issue key.

The reason: the user opens the issue by hand. On GitHub, `#159` is a link, but in the terminal it is plain text. In one
case (2026-10-18), the planner of the Docs milestone wrote plain keys such as `#303` in each reply, and the user had no
link to open an issue from a reply.

## Core features first

- The goal is the core features of each command. An edge case waits until later. Do not ask the user about each edge
  case. Decide it as "later", and keep the ticket in its scope. The goal of the numbered milestones is parity with
  [the installed tasker](orchestrator.md): each command of the installed tasker, with its core features. A feature that
  the installed tasker does not have also waits until later, as an edge case does.
- Two kinds of finding do not wait: a security gap and a bug in the core path. Tell the user about a security gap at
  once. [Review findings](review-findings.md#review-findings) of review-findings.md defines both terms and gives the
  steps for a finding of a review.
- Each piece of work that waits becomes an issue in its later milestone, as
  [The milestone of an issue](planner.md#the-milestone-of-an-issue) of planner.md says. [issues.md](issues.md) gives the
  steps to file the issue.
- Containers are out of scope for now. Do not raise or file an edge case that occurs only in a container. An example is
  a process that has the same pid at each start, so that the lock row of a crashed run looks like the lock row of the
  process itself.
- tasker writes and reads UTF-8 text only. The output code does not write raw bytes.
- A compare of names folds ASCII letters only, with `asciiFold()` in [`src/ascii-fold.ts`](../../src/ascii-fold.ts). A
  fold of letters outside ASCII waits, as the first bullet of [Core features first](#core-features-first) says for an
  edge case. On #61 (2026-10-18), the user said: "I am currently the only tasker user and I will use the English
  alphabet. We can introduce i10n concerns later."
- A collision of derived names is not an issue. Examples are two repo keys or two [issue keys](issue-keys.md) that give
  the same slug, the same folder or the same task branch. Do not raise such a collision, and do not file an issue for
  it. When an agent reports one, dismiss it with this reason.

## Simplify over special rules

- When a review keeps finding edge cases in a rule, and each fix opens the next case, stop the patches. After two loops
  in a row where the fix of a rule draws a new edge case, give the user a simpler rule as the first choice and the patch
  as the second choice.
- In one case, an exception for one more loop drew a new edge case in each of 4 loops. The user replaced all the special
  loop rules with one rule: "up to 5 loops, then report". [Review findings](review-findings.md#review-findings) of
  review-findings.md holds that rule.
- When the orchestrator gives the user the simpler rule as a choice, the orchestrator also tells the agent of the ticket
  to wait. The agent does not run its next `tasker approve` or `tasker accept` until the user decides. The agent waits
  as [the answer-wait rule](limits.md#the-answer-wait-rule) says. Then the orchestrator sends the agent the decision of
  the user. The reason: if the user then picks the simpler rule, a landing with the patch costs a second ticket. On
  2026-10-17, the agent of #250 went on, #250 landed with the patch before the user chose the simpler rule, and #306
  undoes the patch.

## The tools of a session

- Read a file with the Read tool of the session. Do not use `cat`, `head` or `sed -n` in a Bash call to read a file.
- The output of a command stays in Bash, for example the output of `gh` or `tasker`.
- A watch, a monitor or a scheduled job that the user asks for covers only the items that the user named. It also serves
  only the purpose that the user named. The session does not widen it to other items. The session stops it when its
  purpose ends, and it tells the user. This rule covers only a watch, a monitor or a scheduled job that the user asks
  for. It does not cover a job that a doc tells the session to schedule, for example a job of [Quota](quota.md#quota).
  In one case (2026-10-17), the user asked orchestrator-m13 to watch the tasks of M9 and to tell the user when #274 was
  ready to land. The orchestrator widened the watch to each later ticket of M13 and started it again each 30 minutes. On
  2026-10-18, the user stopped it and said: "the current use isn't even close to the original intent."

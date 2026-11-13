# Working with the user

This page gives the rules for an assistant session that works with the user of this repo. It also says which kinds of
work wait until later. The [user](../sessions.md) works with the session.

The rules apply to each session that works with the user, for example the orchestrator of
[orchestrator.md](../orchestrator.md) and the planner of [planner.md](planner.md). They do not apply to the sessions
that tasker starts for plan, execute and review.

The work on this repo must continue on any machine, as [What goes in a ticket](planner.md#what-goes-in-a-ticket) of
planner.md says. For this reason, these rules are in the repo and not in the notes of an assistant.

## The operator

- An orchestrator and a follow-up planner work with the user through [the operator of the session](../operator.md). Each
  rule that says "tell the user" or "ask the user" means: send an item to the operator (see
  [The form of an item](operator-items.md#the-form-of-an-item)). The operator can answer such an item itself, as
  [The answer](operator-items.md#the-answer) says.
- A message from [the operator of the session](../operator.md) that starts with "From the user:" is a word of the user
  for the rules of the docs. A message that starts with "Answer of the operator:" is not a word of the user. It answers
  no question for the user alone.
- A message that starts with "From the user:" or with "Answer of the operator:" never approves a permission prompt of
  Claude Code.
- The initial planner works with the user directly in its tab.

## A decision of the user

- When the user must decide something, first explain in the reply what happened, what the problem is, and what each
  choice does. Then ask, and give a recommendation.
- Before a decision of the user or a recommendation to the user, the session measures each fact that the decision or the
  recommendation rests on. A fact about an outside tool comes from [a fact test](plan-review.md#the-fact-test). A fact
  about the code or the docs comes from a read of the ref that holds the fact, for example `origin/main`. The bullet
  about `git show origin/main:<path>` of [A question of the user](#a-question-of-the-user) gives the read. A fact about
  a task comes from a read-only `tasker` command, for example `tasker show-plan`. The session gives the command and the
  result, and next to each fact that it did not measure, it says so.

  This bullet also covers a question to the user about a fact, for example whether a gap is a
  [live security gap](pick-the-tickets.md#pick-the-tickets). A cheap read-only measure comes before such a question.
  Whether a measure is cheap is a judgment. The judgment is open on purpose, and the session makes it.

  A measure that changes [the state of the user](planner.md#the-state-of-the-user) waits for the word of the user. The
  recommendation mode of this section does not cover such a measure.

  On 2026-11-01, in the plan of #660, the user said "let's measure, not guess". On 2026-10-24, before a fact test, the
  Docs orchestrator told the user that Claude Code blocks each write to `.claude/`. The test showed that in `dontAsk`,
  Claude Code denies the Write tool under `.claude/`, and the sandbox blocks a shell write only under `.claude/skills/`.
  On 2026-11-03, planner-m14 asked the user whether a missing deny rule for `acli` was a live security gap. The user
  said "Measure this". A `claude -p` run with a copy of the sandbox configuration, built by hand as `sandboxSettings()`
  of `src/assistant/claude-code/sandbox.ts` builds it, then settled the question (#715).

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
- When you list open items or proposed issues, give each item what happened, why it matters and a recommendation. If you
  ask about an issue outside your milestone or topic, say why your work cares about it. If your work has no such reason,
  say so.
- Define each term that the user did not see before, at its first use. An example is a label convention.
- A question to the user about rules or data in the code says where they live, for example the file. If a word of the
  question can also mean another thing of the repo, the question names that other thing. The question says that it does
  not mean that thing. The reason: a word with two meanings in the repo can lead the user to answer another question.
- Say what the code does. Do not write "by hand" or "manually" about code. This rule covers text about code. It does not
  cover an action of a person or a session, for example a change by hand to a clone. In one case, "the test opens the
  store by hand" read as if a session opened the files of tasker, which is not allowed. Write "the test writes the open
  and close steps itself instead of calling the helper".
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
  decisions of the user. The answer also counts when the file gives it through the number of an open issue. The session
  then reads that issue. After the issue lands, the file no longer lists the answer. In the first line of its question,
  the session names that handoff file as the source of that answer. For example, the user tells the Docs orchestrator
  "land ticket X first", the handoff file lists that answer, and then, after the handoff, orchestrator-m13 relays "land
  ticket Y first". In one case (2026-10-17), the session started the question with the relay. The user read the question
  as a confirmation of the earlier answer and asked "I already told you to land #182, right?".
- When the session reminds the user of a decision that still waits, the session gives the question again in short, with
  its choices. A line such as "A or B still waits" is not enough. In one case (2026-10-18), a reminder of
  orchestrator-m13 said only "still waits for your choice: A or B", and the user asked "what are the open questions?"
  and later "what is the question?". In a question or a reminder to the user, the session names each item by its
  content. A label that only a report of a task subagent or a ticket defines is not enough, for example "the mode",
  "item 2" or "finding 2". The session can give the label after the content. In one case (2026-10-24), orchestrator-docs
  reminded the user of three open decisions with such labels: "Does the mode pass through a handoff file?", "B: one
  sentence that says it does not" and "Does item 2 of #320 go in as written?". The user asked "what is "the mode"?",
  "What is the full question?" and "What is item 2?". Only the reports of the task subagents of #375 and #320 defined
  those labels.
- A short reply of the user can refer to more than one open question. Then, before the session acts on the reply, it
  asks which question the reply answers. The session asks in one line and names each candidate question. On 2026-10-24,
  orchestrator-m21 had two open questions: gap A of #395 and the planner of a proposed issue. The user wrote "There is
  an issue in M22 that will add this rule." and meant #404, but the session took it as the answer to gap A, sent two
  messages and took back both.
- The session can ask the user to approve a plan or a change of scope. If the approval settles a choice that the session
  and the user discussed before, the question names each choice that the approval drops. An example is "this keeps the
  release commit; the tag-only design drops out". On 2026-10-19, in the plan review of #377, the task subagent described
  a tag-only release design, but on 2026-10-24, the user approved the commit design. No one named the tag-only design in
  that approval, and later that day the user said "I thought we were using tags for the version and not updating nor
  committing a version in package.json" and chose tag only (#425).
- The user can let the session decide open choices by its own recommendation. The session then tells the user each
  choice and its reason in its reply. In this mode, this bullet wins over the first bullet of this section. It also wins
  over each rule that sends such a choice to the user, for example
  [the design-gap rule](plan-review.md#the-design-gap-rule). The mode does not cover a rule that says that only the user
  does an action, for example "Only the user changes a landing order of the overlap rule" (see
  [Land the work](land-the-work.md#land-the-work)). Some kinds of choice still go to the user first: a security gap, a
  change of scope, a landing order across milestones, an extra review loop, a request of
  [the request rule](../orchestrator.md#the-request-rule), a [tool block](tasker-commands.md#the-tool-block-rule), a
  read of a file of the data folder and a run of `tasker abort`. The mode holds for the session that got it, until the
  user ends it. The mode also passes through a handoff. The old session lists the mode as a decision of the user in its
  [handoff file](handoff.md#the-items-of-a-handoff-file). The new session then holds the mode until the user ends it. On
  2026-10-18, the user told orchestrator-docs: "Default to your evaluation and recommendation from here on."
- Pending work is moot after a fact that the session read removes the purpose of the work. For example, a closed issue
  makes an edit of its body moot. Whether the purpose of the work is gone is a judgment. The judgment is open on
  purpose, and the session makes it.
- The session drops moot work with no question to the user. This also covers work that waits for an approval of the
  user. In its next reply to the user, the session names the dropped work and gives the reason. The reason names the
  fact that the session read.
- The two bullets before this one do not cover an action that a doc keeps for the user alone. An example is "Only the
  user changes a landing order of the overlap rule" (see [Land the work](land-the-work.md#land-the-work)).
- A question of the user about a decision of the session asks for the reasoning. The session answers the question, and
  it does not treat the decision as wrong unless the user says so. On 2026-10-30, a session dropped seven planned edits
  of issue bodies after #536 landed. Then the user asked why, and the session said that the drop needed a question. The
  user said: "no, deciding without me is fine. I am just making sure I understand the reasoning."

## The form of a reply

These rules hold for each reply to the user:

- A reply uses no unordered list, because the user cannot name an item of an unordered list in an answer.
- A nested list uses letters (a, b, c), for example the choices of a question. A nested list of proposed steps uses
  roman numerals (i, ii, iii) instead. The reason: a step with a letter looks like a choice, and a step with a number
  looks like a question.

- Before the session sends a reply, it makes sure that the reply holds no unordered list. It changes each unordered list
  into a numbered list or into sentences. If the reply gives open questions, the session also makes sure that question 1
  gives the full details of the bullet that starts "Question 1 of the list". Inside a question, it gives the choices as
  a nested list with letters and the proposed steps as a nested list with roman numerals. It changes each other list
  inside a question into sentences. For a list inside a question, these two sentences win over the second sentence of
  this bullet.

These rules hold for each list of the decisions that the user must make, and for each reply that gives open questions:

- A reply gives all open questions in one numbered list.
- Question 1 of the list gives the full details. These are what happened, what the problem is, what each choice does and
  a recommendation, as the first bullet of [A decision of the user](#a-decision-of-the-user) says. Question 1 also gives
  the command and the result of each fact, as the bullet that starts "Before a decision of the user" says. For question
  1, this bullet wins over the words "in short" of the bullet that starts "When the session reminds the user".

  Each later question can be short: the question in one or two sentences, its choices and the recommendation. The other
  bullets of this list and the bullet that starts "Define each term" still hold for a later question. For a later
  question, this bullet wins over the words "first explain in the reply what happened, what the problem is, and what
  each choice does" of [A decision of the user](#a-decision-of-the-user). It also wins over the words "give each item
  what happened, why it matters and a recommendation" of the bullet that starts "When you list open items or proposed
  issues". It also wins over the words "The session gives the command and the result" of the bullet that starts "Before
  a decision of the user". The session still measures each fact of a later question, because the recommendation rests on
  it.

  The short form of a later question holds only in a reply to the user. It does not hold for an item to the operator or
  for a handoff file. The reason: the operator gives the questions of all items in one list with its own numbers, and it
  can answer a question itself. [The items of a handoff file](handoff.md#the-items-of-a-handoff-file) gives the rule and
  the reason for a handoff file.

- Inside a question, only the proposed steps and the choices of the question are lists. Each of them is a nested list,
  as the bullet that starts "A nested list uses letters" says. The other details of a question are plain sentences or
  short paragraphs, not a list. Examples are what happened, what the problem is, and the command and the result of each
  fact. A code block can give a command and its result. The reason: the user reads each item with a letter under a
  question as a choice.

  Each question of the list of open questions gives its parts in this order: the question, its other details, its
  proposed steps and its choices. No part of a question goes above the list of open questions, also not under a heading.
  The bullet that starts "A draft that has a numbered list" still puts a draft above the list, and the proposed steps of
  a question are not a draft. What each choice does and the recommendation can stand in the item of the choice. A choice
  can name the steps, for example "a. Do steps i to iii". For each such question, this order wins over the words "first
  explain in the reply what happened, what the problem is, and what each choice does. Then ask" of the first bullet of
  [A decision of the user](#a-decision-of-the-user).

- The list holds each question that is still open, also each question of an earlier reply that the user did not answer.
- Each question has its own number, also when two questions are about the same issue.
- Do not put a second question inside an item of another question.
- The list numbers from 1 in each reply. A short answer of the user, such as "3. yes", refers to the last list that the
  session gave.
- A draft that has a numbered list goes above the list of open questions, under its own heading, not inside a question.
- Each question says whether it is new or continues an earlier question or answer. A continued question names the
  earlier question or answer by its content. The bullet "When the session reminds the user of a decision that still
  waits" gives this rule. For example, it gives the words of the user.

An example:

```text
1. New question: do you accept the draft?

   The draft adds one bullet to "The form of a reply". The search
   `gh issue list --state all --search "<words> in:title,body" --limit 1000` found no other issue for this
   change. The draft waits for your word before the post. For the post, the session takes these steps:

   i. Search the issues again for the same change.
   ii. Post the issue.
   iii. Compare the posted body with the draft file.

   a. Do steps i to iii (recommended). The issue goes to its milestone.
   b. Drop the draft. Nothing goes to GitHub.
```

In one case (2026-10-15), a question about the link commands of #117 sat in a sub-bullet of the scope question of #117.
The user answered only the scope question. On 2026-10-24, a reply of planner-m14 numbered its answers 3 and 6 by the
items of the user. Then it gave open questions 1 to 6. It also gave a code block with proposed steps 3 to 6, and the
user asked "why are 3-6 repeated?".

On 2026-11-07, operator-m16 used unordered lists in many replies. The user said: "remember to list questions in a
numbered list. And give details for the first one".

On 2026-11-07, operator-m16 gave the full details of question 1 as a nested list with letters: "a. What happened", "b.
The problem" and "c. The choices". The choices stood as 1 and 2 under "c. The choices". The user said: "details in the
first item should not be lettered, it makes them look like they are the answers".

On the same day, planner-m16 asked the user, through operator-m16, where the proposed steps of a question go. The user
said: "proposed steps can be numbered with roman numerals i, ii, iii, etc." The user also said: "and keep the details
with the question, don't move it above".

## A question of the user

- When the user asks a question, answer only that question. Take no action and make no offer that the user did not ask
  for.
- This rule covers a question of the user. When the user must decide something, the session still gives a
  recommendation, as [A decision of the user](#a-decision-of-the-user) says.
- In one case (2026-10-17), the user asked the Docs orchestrator questions about its handoff. The orchestrator answered
  and also offered next steps. After one message of the user, the orchestrator left the handoff and started a ticket
  without the word of the user. The user wrote: "When I ask questions, just answer. Do not anticipate what I want."
- A process question is a question of the user about how the sessions must do their work from now on. An example is the
  question "Do we need another session review iteration in planner?". The answer to a process question gives the
  recommendation and its reason first, and then the facts. The answer marks each guess as a guess, as
  [A side conversation](operator-conversations.md#a-side-conversation) says for a reading of the operator. If the user
  must choose, the answer ends with a numbered list of questions, as [The form of a reply](#the-form-of-a-reply) says.
  Otherwise it asks no question.

  The recommendation is a part of the answer, so the first bullet of this section does not ban it. A question about what
  the code or the docs say today is not a process question. Whether a question is a process question is a judgment. The
  judgment is open on purpose, and the session makes it. A guess is fine for a process question, but not for a fact that
  a read or a command can settle. The bullet of [A decision of the user](#a-decision-of-the-user) that starts "Before a
  decision of the user or a recommendation" gives the rule for such a fact.

  On 2026-10-31, operator-m26 answered the question of the example with the rules of the docs, and it said that the
  answer was a guess. The user said: "guesses are good here...better yet, recommendations. We are developing what this
  process should be as we do it now."

- Before the session answers a question about the code or the docs of the repo, it runs `git fetch origin` in its local
  clone. Then it reads each file on `origin/main` that the answer depends on, with `git show origin/main:<path>` in a
  Bash call. This read is an exception to the Read-tool bullet of [The tools of a session](#the-tools-of-a-session). The
  session does not answer from the files as it read them earlier in the session. The fetch and the read are part of the
  answer, not an extra action. The reason: tickets land while the session runs, so an answer from an earlier read can be
  false. In one case (2026-10-18), the planner of M13 said that `tasker update-branch` did not exist in the rebuild. The
  session answered after all the M13 tickets landed. It answered from the code as it read it at its start, one day
  earlier. The user corrected it.
- When the session looks for a change of Claude Code or of the subscription of the user, it does not search the program
  file of Claude Code. The program file is the executable file that runs Claude Code. An example of such a search is a
  `grep` over the program file. The session searches the web for recent public news of the change instead, for example
  the release notes of Claude Code. If the user names a tool for this search, the session runs that tool.

  If a value is missing from the data that Claude Code reports, the session first saves a copy of that data in a scratch
  folder. After the save, it searches for a change of the subscription or of Claude Code. For the cause of a change of
  Claude Code, this bullet wins over the bullet of [A decision of the user](#a-decision-of-the-user) that starts "Before
  a decision of the user or a recommendation". A fact test of the behavior of Claude Code still applies. This bullet
  covers each such search, also a search that is not for an answer to a question of the user.

  On 2026-10-30, a session ran a slow `grep` over the program file of Claude Code to explain a missing value of the
  status line. The user said "wait...what are you searching?" and "no, don't do that".

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
- When the user asks for the status of an orchestrator, the session gives only the tasks that the orchestrator owns. An
  issue with no task in `tasker status` has no owner. If no fact says that the orchestrator owns a task, the session
  does not name the task. The facts are the milestone of the issue and a decision of the user. A decision of the user
  wins over the milestone. The session does not guess the owner of a task.

  The reply gives the owned tasks in one table, and it holds no other table. If the orchestrator owns no task, the reply
  says so. This rule covers only a reply about the status of an orchestrator.

  On 2026-10-30, the operator showed all eight tasks of `tasker status` and guessed the owner of each task. The user
  said: "when I ask about a status check from an orchestrator, you must only return the tasks that orchestrator owns",
  "don't care 'who likely runs it'. Don't speculate", "'no task yet' means the orchestrator doesn't own it yet" and "the
  only table I want is the ones currently owned by the orchestrator".

## A note for later

A note for later is a text for another session that asks for an action at a later time. A session can read a message as
a request to act now. The trigger of a note is an event that the reader can test, for example the start of a ticket.
Words such as "when you reach #635" give no trigger. This section does not cover an item, a message of
[the request rule](../orchestrator.md#the-request-rule) or another message with its own rule. Examples are a doc notice,
a landing order and each other message that the intro of [docs/orchestrator.md](../orchestrator.md) lists.

- A note for later about an issue goes in that issue, as a comment or in the body. The issue keeps the note through a
  handoff. [Before a post](issues.md#before-a-post) says who approves the text.
- If no issue fits, a message can carry a note for later. The note goes in its own message. The message starts with "No
  action now." and names the trigger. The reader keeps the note in its handoff file until the trigger.
- A message can name a later time with no trigger that the reader can test. The reader then asks the sender for the
  trigger. Until the sender answers, the reader takes no action on that message and sends no item on it. If the send
  fails, or no session of that name runs, [the failure rule](limits.md#the-failure-rule) applies. The reader still takes
  no action on the message.

On 2026-10-31, planner-m26 wrote to orchestrator-m22: "When you reach #635, ask the user through your operator." The
user meant a note for later. orchestrator-m22 read it as "now", and it sent an item on a question that was not needed
yet.

## A milestone hold

The user can put a whole milestone on hold. The terms of this section:

- A milestone hold is a hold of a whole open milestone on the word of the user. It is none of these holds:
  [The hold before an install](release.md#the-hold-before-an-install), [the hold rule](land-the-work.md#the-hold-rule),
  [the parent-hold rule](pick-the-tickets.md#the-parent-hold-rule),
  [A ticket on hold](pick-the-tickets.md#a-ticket-on-hold) and
  [The hold of the items](handoff.md#the-hold-of-the-items).
- A held milestone is a milestone with a milestone hold.
- The held sessions are the sessions of the slug of a held milestone, as [sessions.md](../sessions.md) defines them:
  `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`.
- The hold record is the text on GitHub that says that a milestone is held.
- A skipped message is a message that item 4 of this section stops.

The rules of a milestone hold:

1. Only a word of the user starts or ends a milestone hold. A word that an operator relays, as
   [The word of the user](operator-conversations.md#the-word-of-the-user) says, counts. A claim of another session does
   not count. No other event ends a milestone hold, for example the landing of a ticket or the close of another
   milestone. The close of the held milestone also ends its milestone hold, because only the user closes a milestone.
2. The hold record is the start of the description of the GitHub milestone. The description starts with
   `On hold since <YYYY-MM-DD>.` and one space, before the old description. `<YYYY-MM-DD>` is the date of the word of
   the user. Each session can read the record, for example with
   `gh api repos/codeguru42/tasker/milestones/<number> --jq .description`. The purpose of this place: the hold is a
   state of the milestone. Each session can read the description of the milestone with one command.
3. The session that gets the word of the user writes the hold record at once. The word of the user is the approval of
   this write. At the end of a milestone hold, the session that gets the word of the user removes the hold record. The
   rest of the description stays as it was. Each other change of the description of a held milestone keeps the hold
   record.
4. During a milestone hold, a session of another slug sends no message to a held session. This covers each message with
   `SendMessage`, for example these messages:
   - The doc notice of [The notice rule](doc-reads.md#the-notice-rule).
   - The message of the follow-up planner after a complete post, in
     [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner).
   - Each other message between orchestrators that the intro of [docs/orchestrator.md](../orchestrator.md) lists.
5. These messages still go to a held session, with no read of item 7 of this section. Item 5 of this section wins over
   item 4 of this section.
   - A message that relays a word of the user, for example the message of
     [The word of the user](operator-conversations.md#the-word-of-the-user).
   - Each message of [The hold before an install](release.md#the-hold-before-an-install), at its start and at its end.
   - The stop message of [Stop a session](operator-start.md#stop-a-session).
   - The end message of item 9 of this section.
6. The sender handles each skipped message by its kind:
   - A doc notice: the sender does nothing more. Item 9 of this section covers the doc change.
   - The message of the follow-up planner after a post: the sender does nothing more. Item 9 of this section covers the
     change of the board.
   - Each other skipped message: the sender sends it to the user in an item, through its own operator, in place of the
     held session. The item names the held session. The user decides what happens with it.
7. The sender reads the hold records of the open milestones right before each message to a session of another slug. A
   read of an earlier turn does not count, because a milestone hold can start at any time.
8. The rule covers these states of a milestone hold:
   - Not started: the message goes as the rule of the message says. A message that went out before the start stays sent.
     No session sends it again.
   - Held: items 4 to 6 of this section apply.
   - Ended: the messages go as before. Item 9 of this section covers the doc changes and the board changes that the held
     sessions missed.
9. The session that gets the word of the user to end a milestone hold sends one end message to each held session.
   `ListAgents` gives the held sessions that run. The end message names the held milestone. It says that the milestone
   hold ended. Each held session then does these steps:
   - A held orchestrator does the steps of [The re-read rule](doc-reads.md#the-re-read-rule). Its last read covers each
     doc change that it missed. It then sends a task subagent notice to its task subagents in flight.
     [The task subagent notice](doc-reads.md#the-task-subagent-notice) gives its form for the end of a milestone hold.
     Then the orchestrator reads the board, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says.
   - A held operator does [The doc-read rule](doc-reads.md#the-doc-read-rule). Then it reads each of its start docs
     again.
   - A held planner does nothing more.

   So no session keeps a list of the skipped doc notices. The doc changes stay in the history of `main`, which each
   machine can read. A list in the context of a session is lost at a compaction, a handoff or a move to another machine.

10. If the read of item 7 of this section fails, [the failure rule](limits.md#the-failure-rule) applies. The sender then
    handles each message of that send as the third bullet of item 6 of this section says, in one item.
11. If the write of item 3 of this section or a send of item 9 of this section fails, the failure rule applies. The
    session tells the user. A denied write follows [the tool-block rule](tasker-commands.md#the-tool-block-rule). For
    the operator, it follows [A denied command of the operator](operator-start.md#a-denied-command-of-the-operator).

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
  [the installed tasker](../orchestrator.md): each command of the installed tasker, with its core features. A feature
  that the installed tasker does not have also waits until later, as an edge case does.
- Two kinds of finding do not wait: a security gap and a bug in the core path. Tell the user about a security gap at
  once. Say when the gap starts, from the code on `origin/main` and from the machine.
  [Review findings](review-findings.md#review-findings) of review-findings.md defines both terms and gives the steps for
  a finding of a review. On 2026-11-07, with no measure, planner-m16 told the user that a security gap for three secret
  files of `pi` starts after #726 lands. A read of `origin/main` for the draft of #814 showed that the gap was already
  live for the runs of `claude-code` and `codex`.
- Each piece of work that waits becomes an issue in its later milestone, as
  [The milestone of an issue](planner.md#the-milestone-of-an-issue) of planner.md says. [issues.md](issues.md) gives the
  steps to file the issue. An edge case that a ticket subagent of a planner decided as "later" with no proposed later
  issue gets no issue, as [The ticket subagent](planner.md#the-ticket-subagent) says.
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
  it. When a task subagent reports one, dismiss it with this reason.

## Simplify over special rules

- When a review keeps finding edge cases in a rule, and each fix opens the next case, stop the patches. After two loops
  in a row where the fix of a rule draws a new edge case, give the user a simpler rule as the first choice and the patch
  as the second choice.
- In one case, an exception for one more loop drew a new edge case in each of 4 loops. The user replaced all the special
  loop rules with one rule: "up to 5 loops, then report". [Review findings](review-findings.md#review-findings) of
  review-findings.md holds that rule.
- When the orchestrator gives the user the simpler rule as a choice, the orchestrator also tells the task subagent of
  the ticket to wait. The task subagent does not run its next `tasker approve` or `tasker accept` until the user
  decides. The task subagent waits as [the answer-wait rule](limits.md#the-answer-wait-rule) says. Then the orchestrator
  sends the task subagent the decision of the user. The reason: if the user then picks the simpler rule, a landing with
  the patch costs a second ticket. On 2026-10-17, the task subagent of #250 went on. Ticket #250 landed with the patch
  before the user chose the simpler rule, and #306 undoes the patch. The task subagent also stops by itself under the
  case "Two reviews in a row" of [the stop rule](plan-review.md#the-stop-rule).

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

- A session with no role that works with the user directly and runs tickets through subagents gives all its work to
  subagents. This bullet does not cover an orchestrator, a planner or an operator. The main session is the top-level
  session where the user types. The main session does no work of its own.

  A read of code or docs goes to a subagent. A `gh` command, a `tasker` command, a move on the project board and a draft
  also go to a subagent. This includes a read of the quota with `tasker show-quota`.

  The main session calls only AskUserQuestion, SendMessage and Agent, with two exceptions. First, the main session does
  its start reads itself. For example, it reads [The issue-link rule](#the-issue-link-rule) that `AGENTS.md` names.

  Second, the main session does a step that needs a tool that a subagent does not have. If a subagent lacks a tool that
  a step needs, it tells the main session. The main session then does only that step. For example, it creates a
  scheduled resume job because [Do not use these](quota.md#do-not-use-these) says that a subagent cannot make a job. A
  subagent does each other part of a watch, a monitor or a scheduled job that the user asks for.

  For each request of the user, the main session starts a subagent. Its prompt gives the goal, the facts and the sources
  of the work. The main session then tells the user the result in a few sentences.

  The main session keeps only the direction and decisions of the user and short reports of the work in its conversation.
  A question for a decision keeps the form in [A decision of the user](#a-decision-of-the-user) and
  [The form of a reply](#the-form-of-a-reply). The subagent reports the facts, commands and results for that question.

  A subagent does each step that another rule gives the session. For example, it reads
  [A question of the user](#a-question-of-the-user) and measures facts for
  [A decision of the user](#a-decision-of-the-user). It follows [Before a post](issues.md#before-a-post) for an issue.
  For an ad hoc draft, it follows [The ticket subagent](planner.md#the-ticket-subagent).

  A subagent of the main session posts a reviewed ad hoc draft under
  [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner), because the main session runs no
  `gh` command. After the post, the main session gives the user the report of the post. The report gives the issue link,
  the full path of the draft file and a short summary of each section.

  If the draft waits for a decision under [The escape hatch](planner.md#the-escape-hatch), the main session gives the
  user the full path of the draft file. The main session shows a draft of a comment for approval with the full path of
  the draft file. It gives a short summary of each section and each change of the draft.

  The user keeps the conversation of the main session for the direction of the user. On 2026-11-10, the user said: "all
  things should be subagents. Keep this conversation clear for my interaction and direction."

- A fresh subagent starts with only its prompt and does not see the conversation of the main session. The main session
  runs the parts of `/session-review` that read its transcript. These are step 1, the candidates, and step 7, the open
  work. They also include the part of the staleness check in step 2 that asks whether a later decision replaced a note.

  A fresh subagent does the other parts of steps 2, 4 and 5. These parts compare memory notes with the docs, the code
  and the states of issues. Its prompt gives each fact of the session that these parts need.

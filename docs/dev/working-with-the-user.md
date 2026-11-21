# Working with the user

This page gives the rules for an assistant session that works with the user of this repo. It also says which kinds of
work wait until later. The [user](GLOSSARY.md) works with the session.

The rules apply to each session that works with the user, for example the orchestrator of
[orchestrator.md](../orchestrator.md) and the planner of [planner.md](planner.md). They do not apply to the sessions
that tasker starts for plan, execute and review.

The work on this repo must continue on any machine, as [What goes in a ticket](planner.md#what-goes-in-a-ticket) of
planner.md says. For this reason, these rules are in the repo and not in the notes of an assistant.

## The operator

- For an orchestrator, a rule that says "ask the user" means a question in its own
  [question pane](question-pane.md#a-question-pane). A rule that says "tell the user" means a report as text in its own
  tab. For a follow-up planner, "ask the user" means a question to `orchestrator-<slug>`, which asks it in its pane.
  "Tell the user" means a report to `orchestrator-<slug>`, which shows it in its tab. Each rule that sends a question, a
  report or a draft of a follow-up planner to the operator as an item sends it to `orchestrator-<slug>` instead.
- The report of an orchestrator in its own tab is a progress report. A progress report gives the user a fact, needs no
  decision of the user and starts no step of another session. The first line starts with `Report:` and names the topic.
  Then the id follows, in the form `<own name>-<n>`, for example `orchestrator-m31-7`. The id takes the next number of
  the same counter that gives the question ids of [Terms](question-pane.md#terms). A progress report follows
  [The form of a reply](#the-form-of-a-reply) and [the issue-link rule](#the-issue-link-rule). The orchestrator writes
  each link itself. It shows the progress report at the step that the rule of the report gives. A progress report starts
  no wait. It gets no question pane and no `herdr notification show`. It sends no message to the operator. A text that
  waits for a word of the user is not a progress report. It is an open question, and it goes to the question pane. This
  rule holds for each kind of orchestrator, `claude` and `pi`. The reports of the close in
  [The start and the authority](operator-start.md#the-start-and-the-authority) and
  [The orchestrator ends](operator-start.md#the-orchestrator-ends), and the reports of
  [the hold before an install](release.md#the-hold-before-an-install), keep their own rules.
- After the terminal delegation of [The close of a milestone](operator-start.md#the-close-of-a-milestone), the follow-up
  planner talks to the user directly, in its own conversation. This covers each report, each question, each draft that
  waits for a decision and each request for a permission. It also covers each other rule that sends a report, a question
  or a draft of the follow-up planner to the operator as an item. Examples are
  [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner) and
  [The escape hatch](planner.md#the-escape-hatch) of planner.md, and the paragraph of
  [tasker-commands.md](tasker-commands.md) that starts "If the classifier denies `scan` or `store`". These places stay
  as they are. After the end of the roles of the operator and the orchestrator, the planner sends no item and no report
  to them.
- A message of the orchestrator that starts with "From the user:" is a word of the user for the rules of the docs. The
  quoted words of an accepted message of a question session are a word of the user for the orchestrator. A word that the
  user types in the tab of the orchestrator is also a word of the user. A message that starts with "Answer of the
  operator:" is not a word of the user. It answers no question for the user alone.
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
  a task comes from a read-only `tasker` command. The session gives the command and the result, and next to each fact
  that it did not measure, it says so.

  This bullet also covers a question to the user about a fact, for example whether a gap is a
  [live security gap](pick-the-tickets.md#pick-the-tickets). A cheap read-only measure comes before such a question.
  Whether a measure is cheap is a judgment of the session, open on purpose.

  A measure that changes [the state of the user](planner.md#the-state-of-the-user) waits for the word of the user. The
  recommendation mode of this section does not cover such a measure.

  On 2026-11-01, in the plan of #660, the user said "let's measure, not guess". On 2026-10-24, before a fact test, the
  Docs orchestrator told the user that Claude Code blocks each write to `.claude/`. The test showed that in `dontAsk`,
  Claude Code denies the Write tool under `.claude/`, and the sandbox blocks a shell write only under `.claude/skills/`.
  On 2026-11-03, planner-m14 asked the user whether a missing deny rule for `acli` was a live security gap. The user
  said "Measure this". A `claude -p` run with a copy of the sandbox configuration, built as `sandboxSettings()` of
  `src/assistant/claude-code/sandbox.ts` builds it, then settled it (#715).

- Before the session tells the user that a rule of the repo bans or requires an action, it reads the rule on
  `origin/main`. It reads the rule as the bullet about `git show origin/main:<path>` of
  [A question of the user](#a-question-of-the-user) says. Then the session quotes the rule and names its doc and its
  section. If the session finds no such rule, it does not make the claim. This bullet covers each such claim, also when
  the claim is not an answer to a question of the user. On 2026-10-24 and 2026-10-25, orchestrator-m21 told the user
  twice that its rules banned the install, and the user asked "the orchestrator rules ban you from installing?". The
  install bullet of [Limits](limits.md#limits) bans only an install from a task worktree and `npm link`, so the session
  took the claim back.
- Before a claim to the user about what an issue needs or whether an issue changes, the session reads the current state
  of the issue. Such a claim says whether the issue needs a change of its body or its scope, a comment or a follow-up
  issue. The state is open or closed. The state also gives the task of the issue in `tasker status`, or no task.

  The read is current: the session reads the state for this reply. A read for an earlier reply does not count, because
  an issue can land and close at any time. The bullet that starts "A session with no role" of
  [The tools of a session](#the-tools-of-a-session) defines the main session. For a main session, a read by a subagent
  that it starts for this reply counts as current.

  The reply names the state that the read gave, so that the user sees that the claim rests on a current read. This
  follows the bullet that starts "Before a decision of the user or a recommendation", which gives the command and the
  result of each fact. If a read fails, the reply says so. It then makes no claim about what the issue needs or whether
  the issue changes.

  This bullet covers only a claim that no other rule covers, for example a reply after a decision of the user, with no
  question. The bullet that starts "Before a decision of the user or a recommendation" still covers each fact of a
  decision or a recommendation. The paragraph of [The reads before the write](issues.md#the-reads-before-the-write) that
  starts "Before a session asks the user to approve a write that the reads can skip" still covers a question about a
  write.

  On 2026-11-13, an ad hoc session posted #879, and #879 landed and closed the same day. On 2026-11-14, the user decided
  an open question about #879. The session answered that #879 needs no change, with no read of its state. The user
  asked: "Wait...did you edit 879? It is implemented and closed already". The session did not edit #879, but its reply
  treated a closed issue as an open issue. After a read of the state, its answer about a memory note also changed.

- A rule of the docs on `origin/main` can answer a question before the session asks the user. Then the question is not a
  question for the user. The session follows the rule and does not ask the user. It reads the rule as the bullet about
  `git show origin/main:<path>` of [A question of the user](#a-question-of-the-user) says. It can name the rule in its
  next reply or report. Then it quotes the rule and names its doc and its section, as the bullet that starts "Before the
  session tells the user" says.

  The words of a rule can leave the case of the question open. Then the question stays a question for the user. Whether
  the words of a rule answer a question is a judgment of the session, open on purpose.

  A rule can keep a choice or an approval for the user. Examples are a
  [question for the user alone](operator-items.md#the-open-items) and "Only the user changes a landing order of the
  overlap rule" (see [Land the work](land-the-work.md#land-the-work)). Then the session still asks the user, because
  that rule gives the answer. This bullet does not cover an open question of an issue, which
  [the open-question rule](pick-the-tickets.md#the-open-question-rule) covers. It does not cover a change of a rule of
  the docs. A session that wants such a change still asks the user or drafts an issue.

  The hold record of the GitHub milestone M24 stood at the end of its description. Rule 2 of
  [A milestone hold](#a-milestone-hold) puts the hold record at the start. Rule 3 makes the word of the user for the
  hold the approval of the write of the hold record. The operator asked the user whether to move the record. On
  2026-11-13, in the [question pane](question-pane.md#a-question-pane) question-m24-record, the user said: "yes...this
  shouldn't even be a question for me to decide."

- A question can have a clear recommendation, and the only effect of its answer can be a harmless cleanup. Then the
  question is not a question for the user. The session does the cleanup and does not ask the user. In its next reply or
  report, it names the cleanup and gives its reason. This bullet permits the write of the cleanup, unless a rule keeps
  the approval of that write for the user. The session still uses only the commands that its role permits.

  A harmless cleanup removes or fixes a duplicate text or a stale text. It changes no decision of the user, no rule of
  the docs and no scope of an issue. It changes nothing beyond that text, and one edit undoes it. Whether a
  recommendation is clear and whether a cleanup is harmless are judgments of the session, open on purpose.

  A decision of a kind of [the escape hatch](planner.md#the-escape-hatch) still goes to the user. So does a choice or an
  approval that a rule keeps for the user. Examples are a
  [question for the user alone](operator-items.md#the-open-items) and the approval of a comment on an issue in
  [Before a post](issues.md#before-a-post). If the session is in doubt whether a cleanup is harmless, it asks the user.

  The ban of [The state of the user](plan-review.md#the-state-of-the-user) still applies to each session that it covers.
  For a question of this bullet in an item of another session, the operator sends an answer of the operator, as
  [The answer](operator-items.md#the-answer) says.

  On 2026-11-13, the description of the GitHub milestone M24 held two hold texts. The hold record of rule 2 of
  [A milestone hold](#a-milestone-hold) stood at its start, and an older hold text stood after it. planner-docs named
  the older text as a side fact in item planner-docs-247, and operator-docs then asked the user in the
  [question pane](question-pane.md#a-question-pane) question-m24-old-record. The user said: "clean up the description."
  The decision message of the question session also reported an earlier comment of the user. In the words of the
  question session, a question with a clear recommendation and only a harmless cleanup effect does not go to the user.

- Do not ask with a popup that holds only a short summary. In one case, the user rejected such a popup and wrote "I need
  more context. What is happening?".
- When you list open items or proposed issues, give each item what happened, why it matters and a recommendation. If you
  ask about an issue outside your milestone or topic, say why your work cares about it. If your work has no such reason,
  say so.
- Define each term that the user did not see before, at its first use. An example is a label convention. This bullet
  covers each text that the user reads, not only a decision of the user.

  A name that a session gives to a thing with no number or no fixed name is also a term. An example is the name of a
  proposed issue with no number, such as "the narrow Docs issue". Another example is a short name of a problem, such as
  "the cut start reads" (start reads of long docs that Claude Code showed only in part).

  A term from an item, a report or another message between two sessions counts as a term that the user did not see
  before. This holds until a text in the same chat or pane defines the term for the user. The session that writes the
  text judges whether the user saw another term before. For the first reply of a question pane, the pane owner judges.
  This judgment is open on purpose.

  The definition of a term stands in the sentence of the term, for example in parentheses, or in the sentence right
  before it. For a term in the sentence of a question, the definition stands in that sentence. The reason: the order of
  the parts of a question in [The form of a reply](#the-form-of-a-reply) puts the question first, and that order wins.

  The reason: on 2026-11-14, the question sentence of the first reply of the question pane question-915-milestone used
  "the cut start reads" and "a narrow Docs issue". The reply defined both only in later sentences. These words came from
  item planner-docs-325. The user asked "What is "the cut start reads"" and "1. What narrow docs issue?".

- A question to the user about rules or data in the code says where they live. If a word of the question can also mean
  another thing of the repo, the question names that other thing. The question says that it does not mean that thing.
  The reason: a word with two meanings in the repo can lead the user to answer another question.
- Say what the code does. Do not write "by hand" or "manually" about code. This rule covers text about code. It does not
  cover an action of a person or a session. In one case, "the test opens the store by hand" read as if a session opened
  the files of tasker, which is not allowed. Write "the test writes the open and close steps itself instead of calling
  the helper".
- When the session asks the user about a landing order, it gives each ticket of the order one line. The line gives the
  state of the task of the ticket and its distance from landing, in time, for example "in `accepted`, minutes from its
  merge". A phrase such as "close to landing" alone is not enough. In one case (2026-10-17), the options for #182 said
  that #98 was "in `executed`" and "close to landing". The user did not see that #98 was minutes from its merge, and
  later said that #98 was the right ticket to land first.
- This bullet covers a decision of the user that another orchestrator relays (see the bullet "Only the user changes a
  landing order of the overlap rule" of [Land the work](land-the-work.md#land-the-work) of land-the-work.md). When the
  relayed decision differs from an answer that the user gave this session, the session starts the question with one
  line. The line says that the two answers differ and names both. Then the session gives the options. The bullet also
  covers an answer that the user gave an earlier session of the same role. That answer counts when the
  [handoff file](handoff.md#the-items-of-a-handoff-file) that the session works from lists it under the decisions of the
  user. The answer also counts when the file gives it through the number of an open issue. The session then reads that
  issue. After the issue lands, the file no longer lists the answer. In the first line of its question, the session
  names that handoff file as the source. In one case (2026-10-17), the session started the question with the relay. The
  user read the question as a confirmation of the earlier answer and asked "I already told you to land #182, right?".
- When the session reminds the user of a decision that still waits, the session gives the question again in short, with
  its choices. A line such as "A or B still waits" is not enough. In one case (2026-10-18), a reminder of
  orchestrator-m13 said only "still waits for your choice: A or B", and the user asked "what are the open questions?"
  and later "what is the question?". In a question or a reminder to the user, the session names each item by its
  content. A label that only a report of a task subagent or a ticket defines is not enough, for example "the mode",
  "item 2" or "finding 2". The session can give the label after the content. In one case (2026-10-24), orchestrator-docs
  reminded the user of three open decisions with such labels: "Does the mode pass through a handoff file?", "B: one
  sentence that says it does not" and "Does item 2 of #320 go in as written?". Only the reports of the task subagents of
  #375 and #320 defined those labels. The user asked "what is "the mode"?", "What is the full question?" and "What is
  item 2?".
- In this bullet, a draft is the text of a new issue before its post. A draft of a comment on an issue is not such a
  draft, and a change of an open issue is not one either. A draft has no issue number, so
  [the issue-link rule](#the-issue-link-rule) gives it no content. This bullet gives a case of a sentence of the bullet
  that starts "When the session reminds the user". That sentence is "In a question or a reminder to the user, the
  session names each item by its content." For a draft, the content is its title and a few words about its change.

  A reply or an item can show a draft or ask the user a question about a draft. A list of candidate drafts is such a
  question. Then the first mention of the draft in that reply or item gives its title and a few words about its change.
  At that first mention, the name of a draft file alone is not enough. Another short name that a session gives to a
  draft is also not enough. This holds also after an earlier reply in the same chat or pane described the draft.

  A later mention of the same draft in the same reply or item can use a short name. For the name of a draft, this bullet
  wins over the bullet that starts "Define each term". That bullet asks for a definition only at the first use of a term
  in the chat or pane. The session that writes the reply or the item chooses the words about the change, and this choice
  is open on purpose.

  The title and the words about the change stand inside the sentence of the mention. They add no sentence to a short
  form of a question or to a limit of sentences. Examples are later questions of
  [The form of a reply](#the-form-of-a-reply), open questions in the operator chat and the first reply of a
  [question pane](question-pane.md#a-question-pane). [The open items](operator-items.md#the-open-items) gives the step
  of the operator for an item that it shows.

  The reason: on 2026-11-15, a session with no role worked as an ad hoc planner. At the report of each ticket subagent,
  the session described its draft once, in prose. Later replies gave the open decisions in numbered lists, and they
  named the drafts only by the names of their draft files. Examples are "The rule of the `one-line-fix` draft: A, B or
  C" and "Which drafts do you want me to post? The candidates are `adhoc-own-name`, `dismissal-claims`, and
  `one-line-fix` after decision 1." Before each decision, the user had to ask what the draft was: "What is the one line
  fix?", "What is the adhoc own name draft?" and "what is 'adhoc own name' that needs posted?".

- An unclear answer of the user is an answer whose meaning the session cannot be sure of. The main example is an answer
  with two or more meanings. Before the session acts on an unclear answer, it asks the user what the answer means. An
  action includes each write, for example a post on GitHub. If the session sees two or more meanings, the question names
  each of them. Whether an answer is unclear is a judgment of the session, open on purpose.

  The meaning of an unclear answer is a kind of choice that still goes to the user first in the recommendation mode. It
  is also a [question for the user alone](operator-items.md#the-open-items), and the operator does not answer it with an
  [answer of the operator](operator-items.md#the-open-items). The reason: only the user knows what the user meant.

  This bullet covers the session that acts on an answer of the user, also after the operator relays the answer. It does
  not cover an answer of the operator. For an answer of the user to an item, the rules of the operator still win for the
  operator. These rules are in [The answer](operator-items.md#the-answer) and in
  [The pane owner handles a decision](question-pane.md#the-pane-owner-handles-a-decision).

  A rule of a narrower case also keeps its own steps. Examples are
  [The word of the user](operator-conversations.md#the-word-of-the-user) and the bullet that starts "When the user names
  a rule". The bullet that starts "The list numbers from 1 in each reply" says only which list a short answer refers to.
  The rule of this bullet still covers the meaning of the other words of such an answer, for example "post it" in "1
  post it".

  A short reply of the user can refer to more than one open question. Then it is an unclear answer, and the session asks
  in one line which question the reply answers. On 2026-10-24, orchestrator-m21 had two open questions: gap A of #395
  and the planner of a proposed issue. The user wrote "There is an issue in M22 that will add this rule." and meant
  #404. The session took it as the answer to gap A, sent two messages and took back both.

  An answer to one question can also mean two different choices or steps of that question. On 2026-11-14, a session with
  no role gave the user a numbered list. The first item recommended an order: first a change of a draft of an issue,
  then its review loops again, then its post. The user answered "1 post it", and the session posted the draft as it
  stood (#927).

  Then the user said "I mean follow your recommendation". The session had to change the posted body of #927 with a new
  ticket subagent and a body edit. The answer can mean the draft as it stood or the recommended order. Under this
  bullet, the session asks first.

- The session can ask the user to approve a plan or a change of scope. If the approval settles a choice that the session
  and the user discussed before, the question names each choice that the approval drops. On 2026-10-19, in the plan
  review of #377, the task subagent described a tag-only release design. On 2026-10-24, the user approved the commit
  design. No one named the tag-only design in that approval. Later that day the user said "I thought we were using tags
  for the version and not updating nor committing a version in package.json" and chose tag only (#425).
- The user can let the session decide open choices by its own recommendation. The session then tells the user each
  choice and its reason in its reply. In this mode, this bullet wins over the first bullet of this section. It also wins
  over each rule that sends such a choice to the user, for example
  [the design-gap rule](plan-review.md#the-design-gap-rule). The mode does not cover a rule that says that only the user
  does an action, for example "Only the user changes a landing order of the overlap rule" (see
  [Land the work](land-the-work.md#land-the-work)).

  Some kinds of choice still go to the user first. These kinds are a security gap, a change of scope, a landing order
  across milestones and an extra review loop. They also include a request of the seventh kind of
  [peer message](../orchestrator.md#the-kinds-of-peer-message), as
  [the request rule](../orchestrator.md#the-request-rule) gives it, a
  [tool block](tasker-commands.md#the-tool-block-rule) and a read of a file of the data folder. A run of `tasker abort`
  and the meaning of an unclear answer of the user are also such kinds.

  The mode holds for the session that got it, until the user ends it. The mode also passes through a handoff. The old
  session lists the mode as a decision of the user in its [handoff file](handoff.md#the-items-of-a-handoff-file). The
  new session then holds the mode until the user ends it. On 2026-10-18, the user told orchestrator-docs: "Default to
  your evaluation and recommendation from here on."

- Pending work is moot after a fact that the session read removes the purpose of the work. For example, a closed issue
  makes an edit of its body moot. Whether the purpose of the work is gone is a judgment of the session, open on purpose.
- The session drops moot work with no question to the user. This also covers work that waits for an approval of the
  user. In its next reply to the user, it names the dropped work and gives the reason. The reason names the fact that
  the session read.
- The two bullets before this one do not cover an action that a doc keeps for the user alone. An example is "Only the
  user changes a landing order of the overlap rule" (see [Land the work](land-the-work.md#land-the-work)).
- A question of the user about a decision of the session asks for the reasoning. The session answers the question, and
  it does not treat the decision as wrong unless the user says so. On 2026-10-30, a session dropped seven planned edits
  of issue bodies after #536 landed. The user asked why, and the session said that the drop needed a question. The user
  said: "no, deciding without me is fine. I am just making sure I understand the reasoning."

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

  In the operator chat, each [open question](operator-items.md#the-open-items) is short, also question 1. Each rule of
  the paragraph that starts "Each later question can be short" then also holds for question 1. The first reply of each
  [question pane](question-pane.md#a-question-pane) gives the details of its question within the limit that
  [The question session](question-pane.md#the-question-session) gives. In the operator chat, this paragraph wins over
  each rule of this section that asks for the full details of question 1. So a reminder of the operator also gives
  question 1 in short, as the bullet that starts "When the session reminds the user" says.

  If the user asks to discuss a question in the operator chat, the reply gives the full details of that question. A
  question of the operator itself, with no item, also keeps the full details. This paragraph wins over the paragraph
  before it. A rule that asks for the full text of each open question at one step also wins over that paragraph.

  The reason: on 2026-11-13, the user said to operator-docs: "Since questions are no longer being answered here, you no
  longer need to show the full details of question 1. Instead, follow the same rules for those details in the question
  pane."

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
1. New question: do you accept the draft "Working with the user: end each reply with the next step", which adds
   one bullet to "The form of a reply"?

   The search `gh issue list --state all --search "<words> in:title,body" --limit 1000` found no other issue for
   this change. The draft waits for your word before the post. For the post, the session takes these steps:

   i. Search the issues again for the same change.
   ii. Post the issue.
   iii. Compare the posted body with the draft file.

   a. Do steps i to iii (recommended). The issue goes to its milestone.
   b. Drop the draft. Nothing goes to GitHub.
```

In one case (2026-10-15), a question about the link commands of #117 sat in a sub-bullet of the scope question of #117.
The user answered only the scope question. On 2026-10-24, planner-m14 numbered its answers 3 and 6 by the items of the
user, then gave open questions 1 to 6. It also gave a code block with proposed steps 3 to 6, and the user asked "why are
3-6 repeated?".

On 2026-11-07, operator-m16 used unordered lists in many replies. The user said: "remember to list questions in a
numbered list. And give details for the first one".

On 2026-11-07, operator-m16 gave the details of question 1 as a nested list with letters: "a. What happened", "b. The
problem" and "c. The choices", with the choices as 1 and 2 under "c. The choices". The user said: "details in the first
item should not be lettered, it makes them look like they are the answers".

On the same day, planner-m16 asked the user, through operator-m16, where the proposed steps of a question go. The user
said: "proposed steps can be numbered with roman numerals i, ii, iii, etc." The user also said: "and keep the details
with the question, don't move it above".

## A question of the user

- When the user asks a question, answer only that question. Take no action and make no offer that the user did not ask
  for.
- This rule covers a question of the user. When the user must decide something, the session still gives a
  recommendation, as [A decision of the user](#a-decision-of-the-user) says.
- In one case (2026-10-17), the user asked the Docs orchestrator questions about its handoff. The orchestrator answered,
  offered next steps, and after one message of the user started a ticket without the word of the user. The user wrote:
  "When I ask questions, just answer. Do not anticipate what I want."
- A process question is a question of the user about how the sessions must do their work from now on, for example "Do we
  need another session review iteration in planner?". The answer gives the recommendation and its reason first, and then
  the facts. The answer marks each guess as a guess, as
  [A side conversation](operator-conversations.md#a-side-conversation) says for a reading of the operator. If the user
  must choose, the answer ends with a numbered list of questions, as [The form of a reply](#the-form-of-a-reply) says.
  Otherwise it asks no question.

  The recommendation is a part of the answer, so the first bullet of this section does not ban it. A question about what
  the code or the docs say today is not a process question. Whether a question is a process question is a judgment of
  the session, open on purpose. A guess is fine for a process question, but not for a fact that a read or a command can
  settle. The bullet of [A decision of the user](#a-decision-of-the-user) that starts "Before a decision of the user or
  a recommendation" gives the rule for such a fact.

  On 2026-10-31, operator-m26 answered the question of the example with the rules of the docs, and it said that the
  answer was a guess. The user said: "guesses are good here...better yet, recommendations. We are developing what this
  process should be as we do it now."

- Before the session answers a question about the code or the docs of the repo, it runs `git fetch origin` in its local
  clone. Then it reads each file on `origin/main` that the answer depends on, with `git show origin/main:<path>` in a
  Bash call. This read is an exception to the Read-tool bullet of [The tools of a session](#the-tools-of-a-session). The
  session does not answer from files that it read earlier. The fetch and the read are part of the answer, not an extra
  action. The reason: tickets land while the session runs, so an answer from an earlier read can be false. In one case
  (2026-10-18), the planner of M13 said that `tasker update-branch` did not exist in the rebuild. It answered after all
  the M13 tickets landed, from its read of the code at its start, one day earlier. The user corrected it.
- When the session looks for a change of Claude Code or of the subscription of the user, it does not search the program
  file of Claude Code. The program file is the executable file that runs Claude Code. The session searches the web for
  recent public news of the change instead, for example the release notes of Claude Code. If the user names a tool for
  this search, the session runs that tool.

  If a value is missing from the data that Claude Code reports, the session first saves a copy of that data in a scratch
  folder. Then it searches for a change of the subscription or of Claude Code. For the cause of a change of Claude Code,
  this bullet wins over the bullet of [A decision of the user](#a-decision-of-the-user) that starts "Before a decision
  of the user or a recommendation". A fact test of the behavior of Claude Code still applies. This bullet covers each
  such search, also one that is not for an answer to a question of the user.

  On 2026-10-30, a session ran a slow `grep` over the program file of Claude Code to explain a missing value of the
  status line. The user said "wait...what are you searching?" and "no, don't do that".

- When the user names a rule, the session first runs `git fetch origin` in its local clone, as the bullet about
  `git show origin/main:<path>` of this section says. Then it searches the headings of the docs on `origin/main` for the
  exact words of the name, for example with `git grep -n -i "^#.*<name>" origin/main -- docs AGENTS.md`. The `-i` flag
  also finds a heading that starts with a capital letter. Then it reads the section of that heading before it acts, as
  the bullet about `git show origin/main:<path>` of this section says. If no heading matches, it asks the user which
  rule the user means. It asks in one line and names each candidate rule. This bullet covers each request that names a
  rule, also a request that is not a question. On 2026-10-18, the user asked to make "the issue-link rule" general, but
  the planning session read "link" as a blocked-by link and drafted a wrong issue. The user said "no, you misunderstood.
  By 'links' here I mean the URL for an issue.", and meant the heading [The issue-link rule](#the-issue-link-rule).
- When the user asks for the status of an orchestrator, the session gives only the tasks that the orchestrator owns. An
  issue with no task in `tasker status` has no owner. If no fact says that the orchestrator owns a task, the session
  does not name the task. The facts are the milestone of the issue and a decision of the user. A decision of the user
  wins over the milestone. The session does not guess the owner of a task.

  The reply gives the owned tasks in one table, and it holds no other table. If the orchestrator owns no task, the reply
  says so. This rule covers only a reply about the status of an orchestrator.

  On 2026-10-30, the operator showed all eight tasks of `tasker status` and guessed each owner. The user said: "when I
  ask about a status check from an orchestrator, you must only return the tasks that orchestrator owns", "don't care
  'who likely runs it'. Don't speculate", "'no task yet' means the orchestrator doesn't own it yet" and "the only table
  I want is the ones currently owned by the orchestrator".

## A note for later

A note for later is a text for another session that asks for an action at a later time. A session can read a message as
a request to act now. The trigger of a note is an event that the reader can test, for example the start of a ticket.
Words such as "when you reach #635" give no trigger. This section does not cover an item, a peer message of
[the seven kinds](../orchestrator.md#the-kinds-of-peer-message) or another message with its own rule. Examples are a doc
notice and a landing order. An orchestrator acts on no note for later from a peer, as
[A message outside the kinds](../orchestrator.md#a-message-outside-the-kinds) says.

- A note for later about an issue goes in that issue, as a comment or in the body. The issue keeps the note through a
  handoff. [Before a post](issues.md#before-a-post) says who approves the text.
- If no issue fits, a message can carry a note for later. The note goes in its own message. The message starts with "No
  action now." and names the trigger. The reader keeps the note in its handoff file until the trigger.
- A message can name a later time with no trigger that the reader can test. The reader then asks the sender for the
  trigger. Until the sender answers, the reader takes no action on that message and sends no item on it. If the send
  fails, or no session of that name runs, [the failure rule](limits.md#the-failure-rule) applies, and the reader still
  takes no action on the message.

On 2026-10-31, planner-m26 wrote to orchestrator-m22: "When you reach #635, ask the user through your operator." The
user meant a note for later. orchestrator-m22 read it as "now" and sent an item on a question that was not needed yet.

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
   milestone. The close of the held milestone also ends its milestone hold. The planner reads the hold record before it
   closes a milestone, and it does not close a held milestone, as [Milestones](issues.md#milestones) says.
2. The hold record is the start of the description of the GitHub milestone. The description starts with
   `On hold since <YYYY-MM-DD>.` and one space, before the old description. `<YYYY-MM-DD>` is the date of the word of
   the user. Each session can read the record, for example with
   `gh api repos/codeguru42/tasker/milestones/<number> --jq .description`. The purpose of this place: the hold is a
   state of the milestone, and each session reads the description with one command.
3. The session that gets the word of the user writes the hold record at once. The word of the user is the approval of
   this write. At the end of a milestone hold, the session that gets the word of the user removes the hold record. The
   rest of the description stays as it was. Each other change of the description of a held milestone keeps the hold
   record.
4. During a milestone hold, a session of another slug sends no message to a held session. This covers each message with
   `SendMessage`, for example these messages:
   - The doc notice of [The notice rule](doc-reads.md#the-notice-rule).
   - The message of the follow-up planner after a complete post, in
     [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner).
   - Each other peer message of [The kinds of peer message](../orchestrator.md#the-kinds-of-peer-message).
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
   - Each other skipped message: the sender tells the user the message, as [The operator](#the-operator) gives "tell the
     user" for its role, in place of the held session. The report names the held session. The user decides what happens
     with it.
7. The sender reads the hold records of the open milestones right before each message to a session of another slug. A
   read of an earlier turn does not count, because a milestone hold can start at any time.
8. The rule covers these states of a milestone hold:
   - Not started: the message goes as the rule of the message says. A message that went out before the start stays sent.
     No session sends it again.
   - Held: items 4 to 6 of this section apply.
   - Ended: the messages go as before. Item 9 of this section covers the doc changes and the board changes that the held
     sessions missed.
9. The session that gets the word of the user to end a milestone hold sends one end message to each held session, except
   a held orchestrator of another slug. For that held orchestrator, the end goes as a request of
   [the request rule](../orchestrator.md#the-request-rule). The orchestrator that got the word is the sending
   orchestrator, and the held orchestrator is the receiving orchestrator. The held orchestrator asks its own user in its
   own question pane. It ends its hold only on an accept. Then it tells the sending orchestrator the decision, and it
   does the steps of the bullet "A held orchestrator" below. This request is the end message of item 5 of this section
   for that held orchestrator, so item 4 lets it through. `ListAgents` gives the held sessions that run. The end message
   names the held milestone. It says that the milestone hold ended. Each held session then does these steps:
   - A held orchestrator does the steps of [The re-read rule](doc-reads.md#the-re-read-rule). Its last read covers each
     doc change that it missed. It then sends a task subagent notice to its task subagents in flight.
     [The task subagent notice](doc-reads.md#the-task-subagent-notice) gives its form for the end of a milestone hold.
     Then the orchestrator reads the board, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says.
   - A held operator does [The doc-read rule](doc-reads.md#the-doc-read-rule). Then it reads its start docs again.
   - A held planner does nothing more.

   So no session keeps a list of the skipped doc notices. The doc changes stay in the history of `main`, which each
   machine can read. A list in a session is lost at a compaction, a handoff or a move to another machine.

10. If the read of item 7 of this section fails, [the failure rule](limits.md#the-failure-rule) applies. The sender then
    handles each message of that send as the third bullet of item 6 of this section says, in one report.
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
operator shows to the user. The text on GitHub, and the text of a draft that goes there, keeps the plain key, because
GitHub links it. A message between two sessions keeps the plain key, because a session reads it as text. An item from a
planner or an orchestrator to the operator is such a message. The operator writes the links when it shows the item, as
[The open items](operator-items.md#the-open-items) says. A key inside a code span or a code block stays as it is.

The reason: the user opens the issue by hand, and in the terminal `#159` is plain text. In one case (2026-10-18), the
planner of the Docs milestone wrote plain keys such as `#303` in each reply. The user had no link to open an issue.

The first mention of an issue in a text that the user reads also gives the content of the issue next to its link. The
content is a few words that say what the issue is about. The link text stays the issue key. A later mention of the same
issue in the same text gives only the link. The session that writes the text chooses the words of the content, and this
choice is open on purpose. A key inside a code span or a code block needs no content, as it needs no link.

An item also gives the content of each issue next to its plain key, at the first mention of the issue in the item.
[The open items](operator-items.md#the-open-items) says how the operator shows that content.

The reason for the content: on 2026-11-14, the first reply of the question pane question-915-milestone named #770 and
#916 with no content. The user asked "what does 770 have to do with it? Isn't it specific to codex?".

## Core features first

- The goal is the core features of each command. An edge case waits until later. Do not ask the user about each edge
  case. Decide it as "later", and keep the ticket in its scope. The goal of the numbered milestones is parity with
  [the installed tasker](../orchestrator.md): each command of it, with its core features. A feature that the installed
  tasker does not have also waits until later, as an edge case does.
- Two kinds of finding do not wait: a security gap and a bug in the core path. Tell the user about a security gap at
  once. Say when the gap starts, from the code on `origin/main` and from the machine.
  [Review findings](review-findings.md#review-findings) of review-findings.md defines both terms and gives the steps for
  a finding of a review. On 2026-11-07, with no measure, planner-m16 told the user that a security gap for three secret
  files of `pi` starts after #726 lands. A read of `origin/main` for the draft of #814 showed the gap already live for
  the runs of `claude-code` and `codex`.
- Each piece of work that waits becomes an issue in its later milestone, as
  [The milestone of an issue](issue-subagents.md#the-milestone-of-an-issue) of issue-subagents.md says.
  [issues.md](issues.md) gives the steps to file the issue. An edge case that a ticket subagent of a planner decided as
  "later" with no proposed later issue gets no issue, as
  [The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) of issue-draft.md says.
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

## Fix the root cause

- A fault is a bug or a wrong result that a session finds, for example from a failed test. The root cause is the cause
  whose fix stops the fault from coming back. The judgment of the root cause is open on purpose. The session that finds
  the fault makes it.
- If a session finds a fault, it finds the root cause of the fault and fixes that cause.
- A workaround is a change or an action that makes the fault no longer show but leaves the root cause. Examples are a
  retry, a longer timeout and a skip of a failed test. The session adds no workaround that hides the fault. A workaround
  hides the fault: the fault stays, but no session sees it any more.
- A root cause can be in an outside tool, for example Claude Code, `gh` or GitHub. Then the repo cannot fix that cause.
  The session records the measured fact of the fault in a doc or an issue. A workaround for that fault names the fact.
- The rule covers each session that the intro of this page covers. It also covers each task subagent, because
  [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) names this page. It does not cover
  the sessions that tasker starts for plan, execute and review.
- The rule says how a session fixes a fault, not when. [Core features first](#core-features-first) still decides when. A
  fault of an edge case still waits until later. Its issue asks for a fix of the root cause, not for a workaround.
- Some sessions do not fix a fault themselves, for example an orchestrator or a planner. Such a session files an issue
  or a finding. The issue or the finding asks for a fix of the root cause.
- The single `tasker retry` of [the verify-failure rule](verify-failures.md#the-verify-failure-rule) stays as it is. It
  covers a failure that does not come from the code, and the verify-failure rule wins over this rule. The reason: such a
  failure has no cause in the repo to fix.
- The `gh run rerun` of step 9 of [the CI wait](ci-wait.md#the-ci-wait) stays as it is. The reason: step 1 of
  [A failed CI run](ci-wait.md#a-failed-ci-run) then files an issue for each failed run, also for a flaky one. So the
  rerun hides no fault.
- The reason for this rule: the user said "We need to find the root cause and solve it rather than slap a bandaid on it
  that covers it up."

## Simplify over special rules

- When a review keeps finding edge cases in a rule, and each fix opens the next case, stop the patches. After two loops
  in a row where the fix of a rule draws a new edge case, give the user a simpler rule as the first choice and the patch
  as the second choice.
- In one case, an exception for one more loop drew a new edge case in each of 4 loops. The user replaced all the special
  loop rules with one rule: "up to 5 loops, then report". [Review findings](review-findings.md#review-findings) of
  review-findings.md holds it.
- When the orchestrator gives the user the simpler rule as a choice, the orchestrator also tells the task subagent of
  the ticket to wait. The task subagent does not run its next `tasker approve` or `tasker accept` until the user
  decides. The task subagent waits as [the answer-wait rule](limits.md#the-answer-wait-rule) says. Then the orchestrator
  sends the task subagent the decision of the user. The reason: if the user then picks the simpler rule, a landing with
  the patch costs a second ticket. On 2026-10-17, the task subagent of #250 went on, and #250 landed with the patch
  before the user chose the simpler rule. #306 undoes the patch. The task subagent also stops by itself under the case
  "Two reviews in a row" of [the stop rule](plan-review.md#the-stop-rule).

## The tools of a session

- Read a file with the Read tool of the session. Do not use `cat`, `head` or `sed -n` in a Bash call to read a file.
- The output of a command stays in Bash, for example the output of `gh` or `tasker`.
- A watch, a monitor or a scheduled job that the user asks for covers only the items that the user named. It also serves
  only the purpose that the user named. The session does not widen it to other items. The session stops it when its
  purpose ends, and it tells the user. This rule covers only a watch, a monitor or a scheduled job that the user asks
  for. It does not cover a job that a doc tells the session to schedule, for example a job of [Quota](quota.md#quota).
  In one case (2026-10-17), the user asked orchestrator-m13 to watch the tasks of M9 and to tell the user when #274 was
  ready to land. The orchestrator widened the watch to each later ticket of M13 and ran it each 30 minutes. On
  2026-10-18, the user stopped it and said: "the current use isn't even close to the original intent."

- A session with no role that works with the user directly and runs tickets through subagents gives all its work to
  subagents. This bullet does not cover an orchestrator, a planner or an operator. The main session is the top-level
  session where the user types. It does no work of its own.

  A read of code or docs goes to a subagent. A `gh` command, a `tasker` command, a move on the project board and a draft
  also go to a subagent. This includes a read of the quota with `tasker show-quota`.

  The main session calls only AskUserQuestion, SendMessage and Agent, with three exceptions. First, the main session
  does its start reads itself. For example, it reads [The issue-link rule](#the-issue-link-rule) that `AGENTS.md` names.

  Second, the main session does a step that needs a tool that a subagent does not have. If a subagent lacks a tool that
  a step needs, it tells the main session. The main session then does only that step. For example, it creates a
  scheduled resume job because [Do not use these](quota.md#do-not-use-these) says that a subagent cannot make a job. A
  subagent does each other part of a watch, a monitor or a scheduled job that the user asks for.

  Third, the main session runs a call that the classifier of auto mode denied to its subagent. It runs the call only on
  a direct word of the user. The subagent stops and reports the exact call, the exact text of the denial and the purpose
  of the call. The main session gives the user these facts, as
  [the tool-block rule](tasker-commands.md#the-tool-block-rule) says for the orchestrator. The main session runs that
  exact call, word for word, and in no other form.

  A rule of the docs can put a read right before the call, in the same session. Then the main session also runs that
  read itself, right before the call. A subagent still does each other step of the work. The reason: on 2026-11-11 and
  2026-11-12, the classifier denied a delete with a lease and two posts of issues to subagents. The same calls passed in
  the main session, right after a direct word of the user, for example "go ahead and post the issues here".

  For each request of the user, the main session starts a subagent. Its prompt gives the goal, the facts and the sources
  of the work. The main session tells the user the result in a few sentences.

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
  user the full path of the draft file. It shows a draft of a comment for approval with the full path of the draft file.
  It gives a short summary of each section and each change of the draft.

  The user keeps the conversation of the main session for the direction of the user. On 2026-11-10, the user said: "all
  things should be subagents. Keep this conversation clear for my interaction and direction."

- A fresh subagent starts with only its prompt and does not see the conversation of the main session. The main session
  runs the parts of `/session-review` that read its transcript. These are step 1, the candidates, and step 7, the open
  work. They also include the part of the staleness check in step 2 that asks whether a later decision replaced a note.

  A fresh subagent does the other parts of steps 2, 4 and 5. These parts compare memory notes with the docs, the code
  and the states of issues. Its prompt gives each fact of the session that these parts need.

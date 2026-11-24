# The items

This page gives the form of an item, the terms of the questions of an item and the answer.
[The items of the operator](operator-items.md) gives the other steps of the operator.

## The form of an item

- The first line is one sentence that names the sender and the topic.
- Then the id follows, in the form `<sender name>-<n>`. The number `<n>` counts from 1 in the session of the sender.
  After a handoff, the number starts at the first free item id of the handoff file, as
  [The last item id](handoff.md#the-last-item-id) says. Each item, also a report, gets the next number of its count. The
  sender never gives one number to two items.
- Then the text follows the rules of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) and
  [The form of a reply](working-with-the-user.md#the-form-of-a-reply).
- The text of an item also gives the content of each issue that it names. The content stands next to the plain key, at
  the first mention of the issue in the item. [The issue-link rule](working-with-the-user.md#the-issue-link-rule) says
  what the content is.
- An item about a draft gives a summary of the draft and the path of the draft file, not the draft. The path is
  `/tmp/tasker/<slug>/drafts/<file>.md`.
- A report is an item that gives the user a fact and needs no answer.
- Each sender of an item, a planner or an orchestrator, marks each report with the word "Report:" at the start of the
  first line. The sentence that names the sender and the topic follows the word.
- An item with no mark is an item that needs an answer.

## The open items

This page uses these terms for the questions of an item that needs an answer:

- An answer of the operator is an answer that the operator sends with its own recommendation, with no wait for the user.
  The message starts with "Answer of the operator:". The message of
  [the tool-block rule](tasker-commands.md#the-tool-block-rule) that gives the output of a command is not such an
  answer. A tool block is a question for the user alone.
- A question for the user alone is a question of one of these kinds:
  - A kind of choice of the list in the bullet that starts "The user can let the session decide open choices by its own
    recommendation" of [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
  - A choice of [The rules for the user alone](planner.md#the-rules-for-the-user-alone).
  - A choice of [The state of the user](plan-review.md#the-state-of-the-user): the approval of a measure that changes
    the state of the user.
  - A choice of the fifth case of [the stop rule](plan-review.md#the-stop-rule).
  - A choice of the security report of [Review findings](review-findings.md#review-findings).
  - A choice of the earlier-blocker offer in [Pick the tickets](pick-the-tickets.md#pick-the-tickets): the orchestrator
    runs a blocker of an earlier milestone only on the word of the user.
  - A choice of the state `awaiting_quota_approval` in [Quota](quota.md#quota).
  - A choice of the item of a stop of [the pi wait](quota.md#the-pi-wait): the resume of a task or another step.
  - A choice of a hold of [the hold rule](land-the-work.md#the-hold-rule) that stays until the user decides.
  - A choice of the bullet "Only the user changes a landing order of the overlap rule" of
    [Land the work](land-the-work.md#land-the-work), with its relay confirm.
  - A choice of [the stuck-task rule](land-the-work.md#the-stuck-task-rule).
  - A choice of each other rule that says that only the user does an action.
- A partial answer is an answer to some questions of an item, but not to each question. It is an answer of the user or
  an answer of the operator.
- An open question is a question of an open item with no answer of the user and no answer of the operator. A question is
  also an open question when the operator judges that the words of the user do not fully settle it. It stays open until
  the user says that the sender decides, picks a choice or fully settles the question. [The answer](#the-answer) gives
  these steps.
- An answered question is a question with an answer of the user or an answer of the operator that the operator did not
  send yet.
- A sent question is a question with an answer that the operator sent.
- A moved question is a question that the report of a done milestone names as moved to a hold comment. A hold comment is
  a comment on a ticket on hold, as [A ticket on hold](pick-the-tickets.md#a-ticket-on-hold) says. A moved question
  needs no send.

## The answer

- The operator sends each answer of the user to the sender at once with `SendMessage`, also a partial answer. The
  operator does not wait for the answers to the other questions of the item. The message names the id of the item and
  gives the words of the user. It gives the number that the sender gave to each answered question, next to the words of
  the user. The message of a partial answer also names each open question of the item by the number of the sender.
- The sender continues its other work and does not wait in a loop. The answer starts the sender again, as
  [the answer-wait rule](limits.md#the-answer-wait-rule) says for a task subagent. A partial answer also starts the
  sender again. The sender acts only on the answered questions. For the open questions, the sender continues its other
  work and does not wait in a loop.
- After a send works, each answered question of the message is a sent question. An item closes only after each of its
  questions is a sent question or a moved question.
- If a send fails, [the failure rule](limits.md#the-failure-rule) applies, and the item stays open. The questions of the
  failed send stay answered questions.
- A question can give choices, for example a, b and c. The words of the user to such a question can pick no choice and
  not fully settle the question. They can settle a part of it or none of it. The operator judges whether the words fully
  settle the question. This judgment is open on purpose. The three bullets after this one cover only a question that
  gives choices.

  On 2026-10-25, orchestrator-docs asked in item orchestrator-docs-25 (#413) which words the skill gives as a reason.
  The user gave a use case, operator-docs sent it as the answer, and the user later said "let the orchestrator figure
  out the exact wording".

- If the operator judges that the words do not fully settle the question, it does not send them as the answer of that
  question. In its reply, the operator tells the user in one line what stays open. The operator also asks whether the
  sender decides. It sends the answers to the other questions of the item as the first bullet of this section says. For
  a question pane, [A question pane](question-pane.md#a-question-pane) wins over this bullet and the bullet that starts
  "If the reply of the user does neither".
- If the user says that the sender decides, the words of the user with that decision are the answer of the question. If
  the reply of the user picks a choice or fully settles the question, the reply is the answer of the question. In each
  case, the question becomes an answered question, and the operator sends it as the first bullet of this section says.
- If the reply of the user does neither, the question stays an open question. The operator sends the words of the user
  as information. The message names the question as open, by the number of the sender, and gives the words. This form
  also holds when no question of the item has an answer. The sender continues its other work and does not act on the
  open question. If the send fails, [the failure rule](limits.md#the-failure-rule) applies, as for a partial answer.
- An answer of the user or an answer of the operator covers only each question that its message answers. The sender
  applies the answer to no other question that waits for an answer. This rule also holds for a planner or an
  orchestrator that gets the answer from another session. A question of another item waits for the answer of its own
  item. A planner that wants to apply the answer to a question outside an item asks that question first in a new item.
  An orchestrator asks it in its question pane at the time that the rules of that question give, for example
  [the open-question rule](pick-the-tickets.md#the-open-question-rule).

  On 2026-11-07, the user answered "a" to a question of item orchestrator-m16-5. planner-m16 also applied that "a" to a
  separate question in a comment on #723. That question had its own choices a and b, and it had no answer of the user.
  planner-m16 named this step in its report, and the user later chose a for that question too.

- An item that needs an answer can arrive from `planner-<slug>` or `orchestrator-<slug>`. Then the operator sends an
  answer of the operator for each question that is not a question for the user alone. The operator judges whether a
  question is a question for the user alone. The operator sends the answer at once with `SendMessage`. An item with no
  question gets no answer of the operator, for example the item with the path of a handoff file, and it keeps its own
  steps.
- The message names the id of the item. It starts with "Answer of the operator:", not with "From the user:". For each
  question, it gives the number that the sender gave, the choice of the operator and one line with the reason. The
  message also names each open question of the item by the number of the sender.
- The recommendation is the own recommendation of the operator. It can be the recommendation of the sender. If the
  question gives choices, the operator picks one choice or writes its own recommendation.
- For each rule of the sender that waits for the answer of an item, an answer of the operator counts as that answer.
  This covers each such rule that is not a rule of a question for the user alone. It also covers such a rule that this
  page does not name.
- An answer of the operator is not a word of the user, as [The operator](working-with-the-user.md#the-operator) says.
  Each question for the user alone waits for the user. The bullets of this section for an answered question and a sent
  question also apply to an answer of the operator.
- The user can change an answer of the operator. Then the operator sends the new word of the user to the sender, as
  [The word of the user](operator-conversations.md#the-word-of-the-user) says. If the sender already acted on the answer
  of the operator, the sender tells the user the cost of the change in a report. An orchestrator shows this report as a
  progress report in its own tab, as [The operator](working-with-the-user.md#the-operator) says, and sends no report to
  the operator. After the report, the sender does what the new word of the user says, with no other wait. Each rule for
  the user alone still applies to that act, for example the approval of a comment on an issue.
- The bullets on an answer of the operator do not cover a report, because a report needs no answer. They also do not
  cover the recommendation mode of one session in
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
- The reason: on 2026-10-25, the user answered planner-docs-58 with "send your recommendations". Earlier, the user
  answered planner-docs-35 and planner-docs-38 with "Answer the rest with your recommendations". Then the user said:
  "file an issue to update the operator rules to automatically send its own recommendations for planner and orchestrator
  feedback".

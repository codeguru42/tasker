# The items of the operator

The sender sends each [item](../sessions.md) to the operator with `SendMessage`.

## The form of an item

- The first line is one sentence that names the sender and the topic.
- Then the id follows, in the form `<sender name>-<n>`. The number `<n>` counts from 1 in the session of the sender.
  After a handoff, the number starts at the first free item id of the handoff file, as
  [The last item id](handoff.md#the-last-item-id) says. Each item, also a report, gets the next number of its count. The
  sender never gives one number to two items.
- Then the text follows the rules of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) and
  [The form of a reply](working-with-the-user.md#the-form-of-a-reply).
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
  - The request of [the request rule](../orchestrator.md#the-request-rule).
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

The operator does these things for the open items:

- The operator keeps a list of the open items. An item that needs an answer is open from its arrival until each of its
  questions is a sent question or a moved question. A report is open from its arrival until the operator shows it to the
  user. The operator shows a report when it gives the arrival line of the report in a reply to the user. The operator
  sends no answer to the sender of a report.
- When an item arrives, the operator does not break into a conversation with the user. At the end of its reply, the
  operator adds one line: "New item `<id>` from `<sender>`:", then the first line of the item. This page calls that line
  and the first line of the item the arrival line. In that reply, the operator gives the full text of a new item only on
  request of the user. The arrival line is not a list of open items, and it asks the user no question. The reason: on
  2026-10-25, the user said: "the operator continues to print out the full request when a new question arives rather
  than adding it to its list and waiting for me to request the details."
- For each new item, the operator runs `herdr notification show "<operator name>: new item <id>" --sound request` in its
  shell. If the command fails, [the failure rule](limits.md#the-failure-rule) applies, and the item stays open. A report
  still closes when the operator shows it.
- This bullet covers an item that needs an answer, not a report. The operator can answer such an item in full with
  answers of the operator. Then the show of the next bullet takes the place of the line "New item `<id>` from
  `<sender>`:", and the operator runs no `herdr notification show`. An item with a question for the user alone keeps
  that line and the notification.
- In its next reply to the user, the operator shows each item that it answered in short, with the answer that it sent.
  It gives them as plain text after the list of open questions, with the id of each item, as for an answered question.
  The operator keeps a list of these items until it shows them. An item with questions of both kinds gets this show and
  the line "New item `<id>` from `<sender>`:".
- When the user asks for the open items, the operator gives each open item with its full text, not only its id or a
  label. An open report gets only its arrival line, not its full text. This sentence wins over the bullet "When you list
  open items or proposed issues" of [A decision of the user](working-with-the-user.md#a-decision-of-the-user). The
  operator gives the open items in the form that [The form of a reply](working-with-the-user.md#the-form-of-a-reply)
  gives. The list shows each open question and each answered question of an item. The operator leaves out each sent
  question and each moved question.

  Each open question gets its own number in the one list of the operator, from 1. The id of its item stands next to that
  number. The operator numbers the questions again for its list, and it keeps the number of the sender for the later
  send. An answered question gets no number, because the user has nothing to answer. The operator gives it after the
  list, with the id of its item and the words of the user or the answer of the operator. The operator numbers only the
  questions again, not the choices or the proposed steps of a question.

  For a later question, the bullet of [The form of a reply](working-with-the-user.md#the-form-of-a-reply) that starts
  "Question 1 of the list" wins over the words "with its full text" of the first sentence of this bullet. For a request
  of one item, that bullet does not hold, and each question gives its full details.

- When the operator shows an item to the user, it writes each issue key of the item as a link, as
  [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says. A key inside a code span or a code block
  stays as it is.
- When the user asks for a draft, the operator reads the draft file and shows its text. If the file does not exist, the
  operator tells the user that the file does not exist.
- When the user asks for an item, the operator gives its full text. The user names the item, for example by its id. The
  id of an item names its sender, as [The form of an item](#the-form-of-an-item) says. For an item that needs an answer,
  the full text uses the form of the bullet "When the user asks for the open items". For this request, the reply also
  gives each sent question and each moved question. For a sent question, it also gives the words of the answer that the
  operator still has. The bullet "When the operator shows an item to the user, it writes each issue key of the item as a
  link" also covers the full text of an item on request. If the operator no longer has the text of the item, the
  operator says so in its reply. The reply names the sender and the id of the item, so that the user can ask the sender.
  An example is an item that closed before a handoff of the operator, because the handoff file of the operator keeps no
  full text of a closed item. The reason: the user reads the full text of an item only on request, so a reply of the
  operator holds no text that the user did not ask for.
- The operator sends no answer to a moved question. If the user answers one, the operator gives the user the link of the
  hold comment. It also says that the orchestrator asks the question again at the end of the hold. The report can name
  an answered question as moved. Then the question is a moved question, and the operator tells the user that it did not
  send its answer. A sent question stays a sent question, also in a report that names it as moved.

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
  a question pane, [A question pane](operator-conversations.md#a-question-pane) wins over this bullet and the bullet
  that starts "If the reply of the user does neither".
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
  An orchestrator asks it in a new item at the time that the rules of that question give, for example
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
  of the operator, the sender tells the user the cost of the change in a report. After the report, the sender does what
  the new word of the user says, with no other wait. Each rule for the user alone still applies to that act, for example
  the approval of a comment on an issue.
- The bullets on an answer of the operator do not cover a report, because a report needs no answer. They also do not
  cover the recommendation mode of one session in
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
- The reason: on 2026-10-25, the user answered planner-docs-58 with "send your recommendations". Earlier, the user
  answered planner-docs-35 and planner-docs-38 with "Answer the rest with your recommendations". Then the user said:
  "file an issue to update the operator rules to automatically send its own recommendations for planner and orchestrator
  feedback".

## The states of an item

The table gives each change of an item. An empty cell means that the page gives no state for that actor.

| Change                                                                                                              | Sender                                                                                                 | Operator                                                                                                                                                                                             | User              | Who tells whom                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The item arrives                                                                                                    | Continues its other work                                                                               | The item is open. For an item that needs an answer, the next rows give the decision of the operator                                                                                                  |                   | The sender tells the operator, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The operator shows an item with a question for the user alone                                                       |                                                                                                        | The item is open                                                                                                                                                                                     |                   | The operator tells the user, with the arrival line and the herdr notification                                                                                                                                                                                                                                                                                                                             |
| An item with no question for the user alone arrives                                                                 | Continues its other work                                                                               | Sends an answer of the operator. The item closes                                                                                                                                                     |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| An item with questions of both kinds arrives                                                                        | Continues its other work                                                                               | Sends an answer of the operator for the other questions. The item stays open                                                                                                                         |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| An item with only questions for the user alone arrives                                                              | Continues its other work                                                                               | Sends nothing. The item stays open                                                                                                                                                                   |                   | The operator tells the user, with the arrival line and the notification                                                                                                                                                                                                                                                                                                                                   |
| The operator answers a question that gives choices                                                                  |                                                                                                        | Picks one choice or writes its own recommendation. The message gives the choice and one line with the reason                                                                                         |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| The operator gives its next reply                                                                                   |                                                                                                        | Shows each answered item with its answer                                                                                                                                                             | Reads the answers | The operator tells the user                                                                                                                                                                                                                                                                                                                                                                               |
| A handoff of the operator comes before that reply                                                                   |                                                                                                        | The new operator shows the items of the file in its first reply                                                                                                                                      | Reads the answers | The new operator tells the user                                                                                                                                                                                                                                                                                                                                                                           |
| The user changes an answer of the operator, before the sender acted                                                 | Acts on the new answer                                                                                 | Sends the new word of the user                                                                                                                                                                       |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| The user changes an answer of the operator, after the sender acted                                                  | Reports the cost, then does what the new word says                                                     | Sends the new word of the user                                                                                                                                                                       |                   | The operator tells the sender. The sender tells the user                                                                                                                                                                                                                                                                                                                                                  |
| The operator shows a report                                                                                         |                                                                                                        | The report is closed                                                                                                                                                                                 |                   | The operator tells the user, with the arrival line of the report in the reply. The operator sends no answer to the sender                                                                                                                                                                                                                                                                                 |
| The user asks for an item                                                                                           |                                                                                                        | The item keeps its state                                                                                                                                                                             |                   | The user tells the operator. Then the operator tells the user, with the full text of the item in the reply. For an item that needs an answer, the reply uses the form of the bullet "When the user asks for the open items". For this request, the reply also gives each sent question and each moved question. If the operator no longer has the text, the reply names the sender and the id of the item |
| The user answers, also with a partial answer                                                                        |                                                                                                        | The item is open. Each question that the words of the user fully settle is an answered question. Each other open question stays open. Each sent question stays sent. Each moved question stays moved |                   | The user tells the operator                                                                                                                                                                                                                                                                                                                                                                               |
| The operator judges that the words of the user do not fully settle a question                                       |                                                                                                        | The item is open. The question stays open. The other questions of the item keep their states: open, answered, sent or moved                                                                          |                   | The operator tells the user what stays open and asks whether the sender decides                                                                                                                                                                                                                                                                                                                           |
| The user says that the sender decides, picks a choice or fully settles the question                                 |                                                                                                        | The item is open. The question becomes an answered question. The other questions of the item keep their states: open, answered, sent or moved                                                        |                   | The user tells the operator                                                                                                                                                                                                                                                                                                                                                                               |
| The reply of the user does neither                                                                                  | The sender continues its other work                                                                    | The item is open. The question stays open. The operator sends the words as information. The other questions of the item keep their states: open, answered, sent or moved                             |                   | The operator tells the sender, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The send of a partial answer works                                                                                  | The answer starts the sender again for the answered questions                                          | The item stays open with its open questions. Each answered question of the send is a sent question                                                                                                   |                   | The operator tells the sender, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The send of an answer works, and after it each question of the item is a sent question or a moved question          | The answer starts the sender again                                                                     | The item is closed. No question is open or answered                                                                                                                                                  |                   | The operator tells the sender, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The report of a done milestone names a moved question                                                               | Waits for step 4 of "The close of a milestone", then stops, or moves on as a long-running orchestrator | The question is a moved question. An item with no other open or answered question closes                                                                                                             |                   | The orchestrator tells the operator, in the report                                                                                                                                                                                                                                                                                                                                                        |
| The send of the answer fails, also of a partial answer, of an answer of the operator or of the words as information |                                                                                                        | The item stays open. Each answered question of the send stays an answered question. Each open question stays open. Each sent question stays sent. Each moved question stays moved                    |                   | The operator tells the user, as the failure rule says                                                                                                                                                                                                                                                                                                                                                     |

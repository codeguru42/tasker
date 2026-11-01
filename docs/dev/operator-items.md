# The items of the operator

The sender sends each [item](../sessions.md) to the operator with `SendMessage`.

## The form of an item

- The first line is one sentence that names the sender and the topic.
- Then the id follows, in the form `<sender name>-<n>`. The number `<n>` counts from 1 in the session of the sender.
  After a handoff, the number starts at the first free item id of the handoff file, as
  [The last item id](handoff.md#the-last-item-id) says.
- Then the text follows the rules of [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
- An item about a draft gives a summary of the draft and the path of the draft file, not the draft. The path is
  `/tmp/tasker/<slug>/drafts/<file>.md`.
- A report is an item that gives the user a fact and needs no answer.
- Each sender of an item, a planner or an orchestrator, marks each report with the word "Report:" at the start of the
  first line. The sentence that names the sender and the topic follows the word.
- An item with no mark is an item that needs an answer.

## The open items

This page uses these terms for the questions of an item that needs an answer:

- A partial answer is an answer of the user to some questions of an item, but not to each question.
- An open question is a question of an open item with no answer of the user. A question is also an open question when
  the operator judges that the words of the user do not fully settle it. It stays open until the user says that the
  sender decides, picks a choice or fully settles the question. [The answer](#the-answer) gives these steps.
- An answered question is a question with an answer of the user that the operator did not send yet.
- A sent question is a question with an answer that the operator sent.

The operator does these things for the open items:

- The operator keeps a list of the open items. An item that needs an answer is open from its arrival until each of its
  questions is a sent question. A report is open from its arrival until the operator shows it to the user. The operator
  shows a report when it gives the arrival line of the report in a reply to the user. The operator sends no answer to
  the sender of a report.
- When an item arrives during a conversation with the user, the operator does not break into it. At the end of its
  reply, the operator adds one line: "New item `<id>` from `<sender>`:", then the first line of the item.
- For each new item, the operator runs `herdr notification show "<operator name>: new item <id>" --sound request` in its
  shell. If the command fails, [the failure rule](limits.md#the-failure-rule) applies, and the item stays open. A report
  still closes when the operator shows it.
- When the user asks for the open items, the operator gives each open item with its full text, not only its id or a
  label. An open report gets only its arrival line, not its full text. This sentence wins over the bullet "When you list
  open items or proposed issues" of [A decision of the user](working-with-the-user.md#a-decision-of-the-user). The
  operator gives the open items in the form that the bullet "When you list the decisions that the user must make" of
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user) gives. The list shows each open question and
  each answered question of an item. The operator leaves out each sent question.

  Each open question gets its own number in the one list of the operator, from 1. The id of its item stands next to that
  number. The operator numbers the questions again for its list, and it keeps the number of the sender for the later
  send. An answered question gets no number, because the user has nothing to answer. The operator gives it after the
  list, with the id of its item and the words of the user. The choices of a question stay a nested list with letters.

- When the operator shows an item to the user, it writes each issue key of the item as a link, as
  [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says. A key inside a code span or a code block
  stays as it is.
- When the user asks for a draft, the operator reads the draft file and shows its text. If the file does not exist, the
  operator tells the user that the file does not exist.
- When the user asks for a report, the operator gives its full text. The user names the report, for example by its id.
  The id of an item names its sender, as [The form of an item](#the-form-of-an-item) says. The bullet "When the operator
  shows an item to the user, it writes each issue key of the item as a link" also covers the full text of a report on
  request. If the operator no longer has the text of the report, the operator says so in its reply. The reply names the
  sender and the id of the report, so that the user can ask the sender. An example is a report that closed before a
  handoff of the operator, because the handoff file of the operator keeps only the open items. The reason: the user
  reads the full text of a report only on request, so a reply of the operator holds no text that the user did not ask
  for.

## The answer

- The operator sends each answer of the user to the sender at once with `SendMessage`, also a partial answer. The
  operator does not wait for the answers to the other questions of the item. The message names the id of the item and
  gives the words of the user. It gives the number that the sender gave to each answered question, next to the words of
  the user. The message of a partial answer also names each open question of the item by the number of the sender.
- The sender continues its other work and does not wait in a loop. The answer starts the sender again, as
  [the answer-wait rule](limits.md#the-answer-wait-rule) says for an agent. A partial answer also starts the sender
  again. The sender acts only on the answered questions. For the open questions, the sender continues its other work and
  does not wait in a loop.
- After a send works, each answered question of the message is a sent question. An item closes only after each of its
  questions is a sent question.
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
  sender decides. It sends the answers to the other questions of the item as the first bullet of this section says.
- If the user says that the sender decides, the words of the user with that decision are the answer of the question. If
  the reply of the user picks a choice or fully settles the question, the reply is the answer of the question. In each
  case, the question becomes an answered question, and the operator sends it as the first bullet of this section says.
- If the reply of the user does neither, the question stays an open question. The operator sends the words of the user
  as information. The message names the question as open, by the number of the sender, and gives the words. This form
  also holds when no question of the item has an answer. The sender continues its other work and does not act on the
  open question. If the send fails, [the failure rule](limits.md#the-failure-rule) applies, as for a partial answer.

## The states of an item

The table gives each change of an item. An empty cell means that the page gives no state for that actor.

| Change                                                                                 | Sender                                                        | Operator                                                                                                                                                            | User | Who tells whom                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The item arrives                                                                       | Continues its other work                                      | The item is open                                                                                                                                                    |      | The sender tells the operator, with `SendMessage`                                                                                                                                                         |
| The operator shows an item that needs an answer                                        |                                                               | The item is open                                                                                                                                                    |      | The operator tells the user, with the reply line and the herdr notification                                                                                                                               |
| The operator shows a report                                                            |                                                               | The report is closed                                                                                                                                                |      | The operator tells the user, with the arrival line of the report in the reply. The operator sends no answer to the sender                                                                                 |
| The user asks for a report                                                             |                                                               | The report stays closed                                                                                                                                             |      | The user tells the operator. Then the operator tells the user, with the full text of the report in the reply. If the operator no longer has the text, the reply names the sender and the id of the report |
| The user answers, also with a partial answer                                           |                                                               | The item is open. Each question that the words of the user fully settle is an answered question. Each other open question stays open. Each sent question stays sent |      | The user tells the operator                                                                                                                                                                               |
| The operator judges that the words of the user do not fully settle a question          |                                                               | The item is open. The question stays open. The other questions of the item keep their states: open, answered or sent                                                |      | The operator tells the user what stays open and asks whether the sender decides                                                                                                                           |
| The user says that the sender decides, picks a choice or fully settles the question    |                                                               | The item is open. The question becomes an answered question. The other questions of the item keep their states: open, answered or sent                              |      | The user tells the operator                                                                                                                                                                               |
| The reply of the user does neither                                                     | The sender continues its other work                           | The item is open. The question stays open. The operator sends the words as information. The other questions of the item keep their states: open, answered or sent   |      | The operator tells the sender, with `SendMessage`                                                                                                                                                         |
| The send of a partial answer works                                                     | The answer starts the sender again for the answered questions | The item stays open with its open questions. Each answered question of the send is a sent question                                                                  |      | The operator tells the sender, with `SendMessage`                                                                                                                                                         |
| The send of an answer works, and after it each question of the item is a sent question | The answer starts the sender again                            | The item is closed. No question is open or answered                                                                                                                 |      | The operator tells the sender, with `SendMessage`                                                                                                                                                         |
| The send of the answer fails, also of a partial answer or of the words as information  |                                                               | The item stays open. Each answered question of the send stays an answered question. Each open question stays open. Each sent question stays sent                    |      | The operator tells the user, as the failure rule says                                                                                                                                                     |

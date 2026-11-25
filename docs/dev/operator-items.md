# The items of the operator

The sender sends each [item](../sessions.md) to the operator with `SendMessage`.

## The form of an item

The rules of this section are in [The form of an item](items.md#the-form-of-an-item).

## The open items

[The open items](items.md#the-open-items) gives the terms of the questions of an item.

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

  The arrival line keeps the first line of the item word for word, with the content that the item gives. The operator
  adds no content to the arrival line, also when the item gives none. The operator still writes each key of the line as
  a link, as [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says.

  With an automatic start, the first reply of the question pane shows an open question, with no request of the user.
  [Start](question-pane.md#start) of "A question pane" gives this rule and its reason. For an open question, this rule
  of 2026-11-13 wins over the first sentence of this bullet and over its reason of 2026-10-25. The operator chat still
  shows only the arrival line. [The question session](question-pane.md#the-question-session) gives the form of the first
  reply of a question pane.

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

  The bullet of [The form of a reply](working-with-the-user.md#the-form-of-a-reply) that starts "Question 1 of the list"
  says which questions of the list are short. For each such question, that bullet wins over the words "with its full
  text" of the first sentence of this bullet. For a request of one item, that bullet does not hold, and each question
  gives its full details.

- The list order of the operator is the order of the open questions in its one list. The operator sorts its open
  questions by these keys, in this order:

  1. The priority of the issue of the question: `P0` first, then `P1`, then no priority, then `P2`. Keys 1 and 2
     together give the order of [the priority rule](pick-the-tickets.md#pick-the-tickets): the priority, then the lower
     issue number.
  2. The number of the issue of the question: the lower number first. Among the questions with the same key 1, a
     question with no issue comes after each question with an issue.
  3. The arrival of the item: a question of an item that arrived earlier comes first. In one item, the lower question
     number of the sender comes first.

  The issue of a question is the issue that the question is about, for example the ticket of a question of an
  orchestrator. The operator judges the issue of each question, and this judgment is open on purpose. A question about a
  draft of a new issue has no issue, and so it has no priority. If a question is about two or more issues, it takes the
  issue that comes first by keys 1 and 2. After a handoff of the operator, the order of the open items in the handoff
  file counts as their order of arrival.

  The operator reads the priorities before each reply that gives the list of open questions. It also reads them before
  it takes the next open question of [Start](question-pane.md#start). The read is
  `gh project item-list 3 --owner codeguru42 --limit 1000 --format json --jq '.items[] | select(.content.type == "Issue" and .priority != null) | "\(.content.number) \(.priority)"'`.
  Each line of the output gives the number of an issue and its priority, for example `587 P0`. An issue with no line has
  no priority. If the read fails, [the failure rule](limits.md#the-failure-rule) applies, and the operator sorts each
  question as a question with no priority, and a run goes on.

  The list can also hold a question of the operator itself, with no item, as
  [The form of a reply](working-with-the-user.md#the-form-of-a-reply) says. Such a question comes after each open
  question, and two such questions keep the order in which the operator asked them.

  The reason: on 2026-11-13, the user said, as operator-docs relayed it: "the question queue should use this priority:
  1. orchestrator over planner questions 2. priority order of the issue (P0, P1, P2) 3. older issues first".

- When the operator shows an item to the user, it writes each issue key of the item as a link, as
  [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says. A key inside a code span or a code block
  stays as it is. The operator keeps the content that the item gives next to each key. If the item gives no content for
  an issue, the operator adds a few words of the content in the text that it shows. This also holds for an open question
  in short form. The content is a few words inside a sentence, so it adds no sentence to a short form or to a limit of
  sentences.

  The operator also keeps the title and the words about the change of each draft that the item names. This also holds
  for an open question in short form. If the item names a draft with no title, the operator adds nothing, because the
  rule binds the sender of the item. The bullet of
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user) that starts "In this bullet, a draft is"
  gives the rule.

- When the user asks for a draft, the operator reads the draft file and shows its text. If the file does not exist, the
  operator tells the user that the file does not exist.
- When the user asks for an item, the operator gives its full text. The user names the item, for example by its id. The
  id of an item names its sender, as [The form of an item](items.md#the-form-of-an-item) says. For an item that needs an
  answer, the full text uses the form of the bullet "When the user asks for the open items". For this request, the reply
  also gives each sent question and each moved question. For a sent question, it also gives the words of the answer that
  the operator still has. The bullet "When the operator shows an item to the user, it writes each issue key of the item
  as a link" also covers the full text of an item on request. If the operator no longer has the text of the item, the
  operator says so in its reply. The reply names the sender and the id of the item, so that the user can ask the sender.
  An example is an item that closed before a handoff of the operator, because the handoff file of the operator keeps no
  full text of a closed item. The reason: the user reads the full text of an item only on request, so a reply of the
  operator holds no text that the user did not ask for.
- The operator sends no answer to a moved question. If the user answers one, the operator gives the user the link of the
  hold comment. It also says that the orchestrator asks the question again at the end of the hold. The report can name
  an answered question as moved. Then the question is a moved question, and the operator tells the user that it did not
  send its answer. A sent question stays a sent question, also in a report that names it as moved.

## The answer

The rules of this section are in [The answer](items.md#the-answer).

### The question gate of the close

This gate covers the close of a milestone. In the close, the operator gives the user the full text of each open
question. In this section, each rule for an open question also covers an open decision. Step 8 of
[the session-review skill](../../.claude/skills/session-review/SKILL.md) gives the other ends of the wait of a decision.
This gate wins over the bullet of [The open items](#the-open-items) that starts "When an item arrives", the rule of the
arrival line alone. It keeps each approval for the user alone.

Before its close report in [The close of a milestone](operator-start.md#the-close-of-a-milestone), the operator finds
each open question that it holds. This includes a question about work outside the milestone. A question of an open
question pane is also an open question. It also finds each open decision, as
[The close of a milestone](milestone-close.md) defines it. An answer of the operator does not resolve a waiting decision
of the session-review skill.

If a question is still open, the operator gives the user the full text of each open question. Then it waits for the
answer. During this wait, the operator does not end its role.

A question stays open until one of these events:

- The user answers it.
- The user withdraws it.
- The user says that the sender decides it, for a choice that the user can give to the sender.
- The operator sends an answer of the operator, for a question that is not a question for the user alone. This section
  gives this answer.

The authority that the rules of this section already give for a question that the user let the sender decide stays. This
rule covers only a question that is not a question for the user alone. A recommendation of the operator never answers a
question for the user alone.

A missing answer of the user, a deferral and another round each leave the question open. A moved question of
[The open items](items.md#the-open-items) is not an open question.

If an answer asks for more work, the operator finishes that work before it goes on with the close. Then step 7 of
[The steps that end each role](operator-start.md#the-steps-that-end-each-role) applies.

Before its close report, each answered question is a sent question, as this section says. No question and no decision of
the operator is open.

## The states of an item

The table gives each change of an item. An empty cell means that the page gives no state for that actor.

| Change                                                                                                              | Sender                                                                              | Operator                                                                                                                                                                                             | User              | Who tells whom                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The item arrives                                                                                                    | Continues its other work                                                            | The item is open. For an item that needs an answer, the next rows give the decision of the operator                                                                                                  |                   | The sender tells the operator, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The operator shows an item with a question for the user alone                                                       |                                                                                     | The item is open                                                                                                                                                                                     |                   | The operator tells the user, with the arrival line and the herdr notification                                                                                                                                                                                                                                                                                                                             |
| An item with no question for the user alone arrives                                                                 | Continues its other work                                                            | Sends an answer of the operator. The item closes                                                                                                                                                     |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| An item with questions of both kinds arrives                                                                        | Continues its other work                                                            | Sends an answer of the operator for the other questions. The item stays open. An automatic start can follow                                                                                          |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| An item with only questions for the user alone arrives                                                              | Continues its other work                                                            | Sends nothing. The item stays open. An automatic start can follow                                                                                                                                    |                   | The operator tells the user, with the arrival line and the notification                                                                                                                                                                                                                                                                                                                                   |
| The operator answers a question that gives choices                                                                  |                                                                                     | Picks one choice or writes its own recommendation. The message gives the choice and one line with the reason                                                                                         |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| The operator gives its next reply                                                                                   |                                                                                     | Shows each answered item with its answer                                                                                                                                                             | Reads the answers | The operator tells the user                                                                                                                                                                                                                                                                                                                                                                               |
| A handoff of the operator comes before that reply                                                                   |                                                                                     | The new operator shows the items of the file in its first reply                                                                                                                                      | Reads the answers | The new operator tells the user                                                                                                                                                                                                                                                                                                                                                                           |
| The user changes an answer of the operator, before the sender acted                                                 | Acts on the new answer                                                              | Sends the new word of the user                                                                                                                                                                       |                   | The operator tells the sender                                                                                                                                                                                                                                                                                                                                                                             |
| The user changes an answer of the operator, after the sender acted                                                  | Reports the cost (an orchestrator in its own tab), then does what the new word says | Sends the new word of the user                                                                                                                                                                       |                   | The operator tells the sender. The sender tells the user                                                                                                                                                                                                                                                                                                                                                  |
| The operator shows a report                                                                                         |                                                                                     | The report is closed                                                                                                                                                                                 |                   | The operator tells the user, with the arrival line of the report in the reply. The operator sends no answer to the sender                                                                                                                                                                                                                                                                                 |
| The user asks for an item                                                                                           |                                                                                     | The item keeps its state                                                                                                                                                                             |                   | The user tells the operator. Then the operator tells the user, with the full text of the item in the reply. For an item that needs an answer, the reply uses the form of the bullet "When the user asks for the open items". For this request, the reply also gives each sent question and each moved question. If the operator no longer has the text, the reply names the sender and the id of the item |
| The user answers, also with a partial answer                                                                        |                                                                                     | The item is open. Each question that the words of the user fully settle is an answered question. Each other open question stays open. Each sent question stays sent. Each moved question stays moved |                   | The user tells the operator                                                                                                                                                                                                                                                                                                                                                                               |
| The operator judges that the words of the user do not fully settle a question                                       |                                                                                     | The item is open. The question stays open. The other questions of the item keep their states: open, answered, sent or moved                                                                          |                   | The operator tells the user what stays open and asks whether the sender decides                                                                                                                                                                                                                                                                                                                           |
| The user says that the sender decides, picks a choice or fully settles the question                                 |                                                                                     | The item is open. The question becomes an answered question. The other questions of the item keep their states: open, answered, sent or moved                                                        |                   | The user tells the operator                                                                                                                                                                                                                                                                                                                                                                               |
| The reply of the user does neither                                                                                  | The sender continues its other work                                                 | The item is open. The question stays open. The operator sends the words as information. The other questions of the item keep their states: open, answered, sent or moved                             |                   | The operator tells the sender, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The send of a partial answer works                                                                                  | The answer starts the sender again for the answered questions                       | The item stays open with its open questions. Each answered question of the send is a sent question                                                                                                   |                   | The operator tells the sender, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The send of an answer works, and after it each question of the item is a sent question or a moved question          | The answer starts the sender again                                                  | The item is closed. No question is open or answered                                                                                                                                                  |                   | The operator tells the sender, with `SendMessage`                                                                                                                                                                                                                                                                                                                                                         |
| The report of a done milestone names a moved question                                                               | Waits for the stop of the orchestrator in "The close of a milestone", then stops    | The question is a moved question. An item with no other open or answered question closes                                                                                                             |                   | The orchestrator tells the operator, in the report                                                                                                                                                                                                                                                                                                                                                        |
| The send of the answer fails, also of a partial answer, of an answer of the operator or of the words as information |                                                                                     | The item stays open. Each answered question of the send stays an answered question. Each open question stays open. Each sent question stays sent. Each moved question stays moved                    |                   | The operator tells the user, as the failure rule says                                                                                                                                                                                                                                                                                                                                                     |

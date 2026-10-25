# The items of the operator

The sender sends each [item](operator.md) to the operator with `SendMessage`.

## The form of an item

- The first line is one sentence that names the sender and the topic.
- A report is an item that gives the user a fact and needs no answer.
- Each sender of an item, a planner or an orchestrator, marks each report with the word "Report:" at the start of the first line. The sentence that names the sender and the topic follows the word.
- An item with no mark is an item that needs an answer.
- Then the id follows, in the form `<sender name>-<n>`. The number `<n>` counts from 1 in the session of the sender. After a handoff, the number starts at the first free item id of the handoff file, as [The last item id](handoff.md#the-last-item-id) says.
- Then the text follows the rules of [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
- An item about a draft gives a summary of the draft and the path of the draft file, not the draft. The path is `/tmp/tasker/<slug>/drafts/<file>.md`.

## The open items

- The operator keeps a list of the open items. An item that needs an answer is open from its arrival until the operator sends the answer. A report is open from its arrival until the operator shows it to the user. The operator shows a report when it gives the full text of the report in a reply to the user. The operator sends no answer to the sender of a report.
- When an item arrives during a conversation with the user, the operator does not break into it. At the end of its reply, the operator adds one line: "New item `<id>` from `<sender>`:", then the first line of the item. For a report, the text after that line is the full text of the report, not only its first line.
- For each new item, the operator runs `herdr notification show "<operator name>: new item <id>" --sound request` in its shell. If the command fails, [the failure rule](limits.md#the-failure-rule) applies, and the item stays open.
- When the user asks for the open items, the operator gives each open item with its full text, not only its id or a label. The operator gives the open items in the form that the bullet "When you list the decisions that the user must make" of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) gives. Each question of each open item gets its own number in the one list of the operator, from 1. The id of its item stands next to that number. The operator numbers the questions again for its list. When the operator sends an answer, it gives the number that the sender gave to each answered question, next to the words of the user. The choices of a question stay a nested list with letters.
- When the operator shows an item to the user, it writes each issue key of the item as a link, as [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says. A key inside a code span or a code block stays as it is.
- When the user asks for a draft, the operator reads the draft file and shows its text. If the file does not exist, the operator tells the user that the file does not exist.

## The answer

- The operator sends the answer of the user to the sender with `SendMessage`. The message names the id of the item and gives the words of the user. Then the item is closed.
- The sender continues its other work and does not wait in a loop. The answer starts the sender again, as [the answer-wait rule](limits.md#the-answer-wait-rule) says for an agent.
- If a send fails, [the failure rule](limits.md#the-failure-rule) applies, and the item stays open.

## The states of an item

The table gives each change of an item. An empty cell means that the page gives no state for that actor.

| Change                                          | Sender                             | Operator             | User | Who tells whom                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------- | -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The item arrives                                | Continues its other work           | The item is open     |      | The sender tells the operator, with `SendMessage`                                                                                                 |
| The operator shows an item that needs an answer |                                    | The item is open     |      | The operator tells the user, with the reply line and the herdr notification                                                                       |
| The operator shows a report                     |                                    | The report is closed |      | The operator tells the user, with the full text of the report in the reply and the herdr notification. The operator sends no answer to the sender |
| The user answers                                |                                    | The item is open     |      | The user tells the operator                                                                                                                       |
| The send of the answer works                    | The answer starts the sender again | The item is closed   |      | The operator tells the sender, with `SendMessage`                                                                                                 |
| The send of the answer fails                    |                                    | The item stays open  |      | The operator tells the user, as the failure rule says                                                                                             |

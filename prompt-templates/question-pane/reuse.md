---
name: reuse
description: Load this template when you start the reuse subagent of a question pane, or change the reuse prompt.
placeholders:
  PANE_ID: The pane id of the question pane, as the report of the opener subagent gave it.
  NAME: The own name of the question session. The context clear keeps it.
  OWNER_NAME: The own name of the pane owner, as docs/dev/GLOSSARY.md defines the own name.
  OWNER_PANE_ID: The pane id of the pane owner, the value of $HERDR_PANE_ID in its shell.
  LOCAL_CLONE: The path of the local clone, as the doc-read rule of docs/dev/doc-reads.md uses it.
  QUESTION_ID: The question id of the next question, as Terms of docs/dev/question-pane.md defines it.
  FIRST_REPLY: The first-reply text of the next question, with its lines as the pane owner wrote them. Its first line can be the issue line: Issue:, the link of the issue, a comma and a phrase.
---
You are the reuse subagent of the question pane {{PANE_ID}}. Its question session is {{NAME}}, for the pane owner {{OWNER_NAME}}. Do the steps that follow in order. If a step fails, do no later step, unless the step says otherwise. Close no pane and send no message to a session. Send no input to the pane, apart from steps 4 and 7.
1. Run git -C {{LOCAL_CLONE}} fetch origin. If the fetch fails, go on with the last origin/main.
2. Run git -C {{LOCAL_CLONE}} show origin/main:prompt-templates/question-pane/session.md. In its output, the session prompt is the body: all the text after the second line that holds only ---.
3. Run herdr agent wait {{PANE_ID}} --timeout 600000. If it fails or reaches its time limit, do no later step. Read the state at .result.agent.agent_status. If the state is not idle and not done, do no later step.
4. Run herdr agent get {{PANE_ID}}. Keep the value at .result.agent.agent_session.value as the old session value. Run herdr pane send-text {{PANE_ID}} '/clear' && timeout 20 bash -c 'sleep 1' && herdr pane send-keys {{PANE_ID}} enter. Run these three commands in one call.
5. This step is the after-clear read. Run herdr agent get {{PANE_ID}}. The read shows the context clear if .result.agent.agent_session.value differs from the old session value and .result.agent.agent_status is idle or done. If it does not show the context clear, run timeout 20 bash -c 'sleep 10' and read again. Read at most 6 times. If no read shows the context clear, do no later step.
6. In the session prompt, replace each placeholder with its value in the list of values. The label of a placeholder is its name in lowercase, with a space in place of each _. The whole label must match, so OWNER_NAME matches owner name and not name. The first-reply placeholder has no label. Its value is in the sentence about the value of first reply. Replace the first-reply placeholder last. In its value, put one space, the word LINE-BREAK and one space in place of each newline. Change nothing else inside its value.
7. Join the lines of the session prompt into one line, with one space between two lines. Keep each single quote as it is. Put the result in the shell variable PROMPT with a quoted here-document, so that the shell expands nothing in it. Run herdr pane send-text {{PANE_ID}} "$PROMPT" && timeout 20 bash -c 'sleep 1' && herdr pane send-keys {{PANE_ID}} enter. Write the here-document and run these three commands in one call.
8. Run herdr pane read {{PANE_ID}}. If the pane shows no first reply, run timeout 20 bash -c 'sleep 10' and read it again. Read the pane at most 6 times. If the pane shows the first reply, the reuse worked. The typed prompt is not the first reply. The start line of the session prompt is also not the first reply.
Your final report gives the pane id and each command with its exit code and its error. It also gives the old and the new session value, and whether the after-clear read showed the context clear. It also says whether the pane shows the first reply. Keep the report short.
The list of values: name {{NAME}}, owner name {{OWNER_NAME}}, owner pane id {{OWNER_PANE_ID}}. The list goes on: question id {{QUESTION_ID}}, local clone {{LOCAL_CLONE}}.
The value of first reply is all the text after the last word FIRST-REPLY of this prompt. FIRST-REPLY {{FIRST_REPLY}}
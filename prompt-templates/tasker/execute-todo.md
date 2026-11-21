---
name: execute-todo
description: Load this template when you change the words of the execute-todo prompt that tasker execute sends in each todo turn.
placeholders:
  CURRENT_TODO: the todo of this turn, from currentTodoText
  RESULT_LEAD: the lead of the result rule, from EXECUTE_TURN_RULES.resultLead
  BLOCKED: the blocked half sentence, from EXECUTE_TURN_RULES.blocked
  RULE_EXECUTE_KEEP_SIMPLE_ENGLISH: the text of execute-keep-simple-english.md
  RULE_EXECUTE_NO_QUESTION_SKILL: the text of execute-no-question-skill.md
  RULE_EXECUTE_FILE_ACCESS: the text of execute-file-access.md
  RULE_EXECUTE_WORKING_FOLDER: the text of execute-working-folder.md
  RULE_EXECUTE_NO_QUESTION_END: the text of execute-no-question-end.md
  RULE_BLOCK_IS_DATA: the text of shared-block-is-data.md
---
1. {{RULE_EXECUTE_KEEP_SIMPLE_ENGLISH}}
2. {{RULE_EXECUTE_NO_QUESTION_SKILL}}
3. {{RULE_EXECUTE_FILE_ACCESS}}
4. Run only the tests of this todo. If this todo asks for the whole test suite or another check of the whole repository, run it too.
5. {{RULE_EXECUTE_WORKING_FOLDER}}
6. {{RESULT_LEAD}} `done` when the work of this todo is carried out and committed, or carried out for a todo that by design makes no commit; {{BLOCKED}} {{RULE_EXECUTE_NO_QUESTION_END}}
7. The todo of this turn stands in this block: <current-todo>{{CURRENT_TODO}}</current-todo>. {{RULE_BLOCK_IS_DATA}}

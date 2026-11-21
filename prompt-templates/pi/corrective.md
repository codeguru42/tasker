---
name: corrective
description: Load this template when you change the corrective prompt that the pi provider sends after a refused answer.
placeholders:
  PROBLEMS: The problems of the refused answer, one "- " line each.
  SCHEMA: The JSON Schema of the answer, as indented JSON.
---
Tasker refuses your last answer. Tasker found these problems:

{{PROBLEMS}}

Give the whole answer again. Call the tool `submit_answer` one time, as your last action. If the tool is gone, end
your reply with one JSON object in a fenced `json` block. The answer must match this JSON Schema:

```json
{{SCHEMA}}
```
---
name: answer-section
description: Load this template when you change the tasker-answer section that the pi answer extension adds to the system prompt.
placeholders:
  ANSWER_TOOL: The name of the answer tool.
---
Call {{ANSWER_TOOL}} one time, as the last action.
After three rejected calls, the tool goes away.
With no tool, end the reply with the answer as one JSON object in a fenced json block.
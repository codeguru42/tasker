---
name: shared-documentation
description: Load this template when you write the plan, refine or review prompt that uses it.
placeholders: {}
---
Find each document of the repository that the change makes wrong. That is a document that describes behavior that a user sees (a command, its output, a state, a configuration key, a folder layout), or a procedure that the change affects. Give each one a todo. `plan_markdown` must have a `## Documentation` section. It lists each such document with its todo, or it says that no document needs a change and names what you looked at.
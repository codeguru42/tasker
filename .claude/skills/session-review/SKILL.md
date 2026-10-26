---
name: session-review
description: Reviews the transcript of the session, saves what the session learned in memory, and sends each proposed change of a tracked doc to the target that the docs of the repo give. Start it with /session-review.
---

# session-review

This skill reviews the transcript of the session before the session ends.

## When to use

Run the skill only on a request, for example `/session-review` before `/clear` or before the end of a session.

The skill runs in a loop with the user before the clear. In the loop, the session answers the questions of the user and refines the proposed issues. In some cases, the session also writes a handoff file. The clear can come only after the loop ends.

## Steps

1. Find the candidates in the transcript. A candidate is a decision, a correction or a confirmation of how to work, a settled design tradeoff, or a state that changed. Examples of a state are a deadline, an owner and an outside reference.
2. Before the first write, read the memory index and each memory file. Then do these checks. The staleness check covers each existing entry: does each file, function or flag that it names still exist, and did a later decision of this session replace it? The duplicate check covers each new candidate: does an existing entry already hold it? The doc check covers each existing memory note, also a note that names no issue. Do the doc check in these steps:
   1. Run `git -C <local clone> fetch origin` one time.
   2. If the fetch fails, tell the user the command and the error. Then the doc check changes no note, and step 5 covers no note.
   3. For each note, find each tracked doc of the repo that the note names. If the note names no tracked doc, it has nothing to compare. Keep the note.
   4. Read each doc that the note names with `git -C <local clone> show origin/main:<path>`.
   5. A doc that no longer exists is an answer, not a failure. [The doc-read rule](../../../docs/dev/doc-reads.md#the-doc-read-rule) gives the two error forms. Then the doc holds no line of the note.
   6. If a read fails, tell the user the command and the error. Keep that note as it was. Step 5 does not cover the note. Go on with the next note.
   7. Compare each line of the note with those docs. The frontmatter and the links of the note are not lines to compare.
   8. If the compare leaves no line besides the frontmatter and the links, delete the note and its line in the memory index in step 4.
   9. If the docs hold some lines of the note, delete those lines in step 4. Keep the other lines.

   A note that the user keeps out of the repo on purpose stays in memory. The doc check deletes and trims no such note, and step 5 makes no proposal for it. The session finds these wishes of the user in its memory and in the instructions of the user. Whether a note is such a note is open on purpose, and the session judges it.

   On 2026-10-17, the user said: "if a memory contains the same note as a doc, then the memory should be deleted".
3. Write each new candidate to memory. Follow the memory rules of the system prompt of the session: the types, the frontmatter, the line in the index and the list of what not to save.
4. Update or remove each entry that step 2 found stale, wrong or duplicated. Also delete each note and trim each note, as the doc check of step 2 says.
5. Do this step for each existing note that the doc check of step 2 keeps in full or in part. For each such note, decide whether it belongs in a tracked doc of the repo. The bullet "Each new rule, fact or preference goes to a doc of the repo" of [What goes in a ticket](../../../docs/dev/planner.md#what-goes-in-a-ticket) in `docs/dev/planner.md` guides this judgment. The judgment is open on purpose, and the session makes it.
   1. If the note belongs in a tracked doc, make a proposal, as step 6 says for a candidate. The proposal goes to the same target. The note stays in memory.
   2. When the session learns the number of the issue of the proposal, add the number to the note. If the session ends first, the next `/session-review` adds the number.
   3. Make no proposal for a note that names an open issue. Read the state with `gh issue view <number> --json state -q .state`.
   4. If that read fails, make no proposal for the note. Tell the user the error.
   5. The memory step of [Land the work](../../../docs/dev/land-the-work.md#land-the-work) covers a note that names an open issue when the issue lands.

   On 2026-10-25, the user said: "and we need to update session-review to include a step to check for memories that need to be in tracked docs".
6. If a candidate belongs in a tracked doc of the repo, make a proposal. A proposal names the file and the change. Find the docs of the repo from the index in `AGENTS.md`. Send each proposal to the target that these docs give for the role of the session. If the docs give no target for the role of the session, give each proposal to the user in the reply. For a recurrence, follow [A recurrence](../../../docs/dev/issues.md#a-recurrence) of `docs/dev/issues.md`.
7. Report a short summary: the memory entries that the session made, changed or removed, and each proposal with its target.

## Rules

- Never edit a tracked doc, for example `AGENTS.md`, `CLAUDE.md` or a file under `docs/`. The reason: a tracked doc is shared with each contributor as soon as a commit holds it. A memory write is personal.
- This skill names no target for a proposal. The docs of the repo give the target for each role, as step 6 says. The reason: the docs of the repo are the one home of that rule, and the rule changes.

## Common mistakes

| Mistake | What to do instead |
| --- | --- |
| The session skips the staleness check of the existing entries. | Do each check of step 2. |
| The session skips the doc check of the existing notes. | Do the doc check of step 2, and step 5 for each kept note. |
| The session edits a tracked doc. | Make a proposal, as step 6 says. |
| The session saves the state of a task in progress as memory. | Follow the list of what not to save, as step 3 says. |
| The session tries to start the skill from a hook. | Run the skill only on a request, as "When to use" says. |
| The session keeps a proposal only in its reply, but the docs give a target for its role. | Send the proposal to that target, as step 6 says. |

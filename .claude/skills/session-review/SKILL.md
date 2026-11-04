---
name: session-review
description: Reviews the transcript of the session and each memory note. Sends each proposed change of a tracked doc to the target that the docs give. It writes no memory. Start it with /session-review.
---

# session-review

This skill reviews the transcript of the session before the session ends.

## When to use

Run the skill only on a request, for example `/session-review` before `/clear` or before the end of a session.

The skill runs in a loop with the user before the clear. In the loop, the session answers the questions of the user and refines the proposed issues. In some cases, the session also writes a handoff file. The clear can come only after the loop ends.

## Steps

1. Find the candidates in the transcript. A candidate is a decision, a correction or a confirmation of how to work, a settled design tradeoff, or a state that changed. Examples of a state are a deadline, an owner and an outside reference.
2. First, read the memory index and each memory file. Then do these checks. The staleness check covers each existing note: does each file, function or flag that it names still exist, and did a later decision of this session replace it? The doc check covers each existing memory note, also a note that names no issue. Do the doc check with the items (a) to (i):
   - (a) Run `git -C <local clone> fetch origin` one time.
   - (b) If the fetch fails, tell the user the command and the error. Then the doc check changes no note, and step 5 covers only the notes of its item (f).
   - (c) For each note, find each tracked doc of the repo that the note names. If the note names no tracked doc, it has nothing to compare. Keep the note.
   - (d) Read each doc that the note names with `git -C <local clone> show origin/main:<path>`.
   - (e) A doc that no longer exists is an answer, not a failure. [The doc-read rule](../../../docs/dev/doc-reads.md#the-doc-read-rule) gives the two error forms. Then the doc holds no line of the note.
   - (f) If a read fails, tell the user the command and the error. Keep that note as it was. Step 5 covers the note only in its item (f). Go on with the next note.
   - (g) Compare each line of the note with those docs. The frontmatter and the links of the note are not lines to compare.
   - (h) If the compare leaves no line besides the frontmatter and the links, delete the note and its line in the memory index in step 4.
   - (i) If the docs hold some lines of the note, delete those lines in step 4. Keep the other lines.

   A note that the user keeps out of the repo on purpose stays in memory. The doc check deletes and trims no such note, and step 5 makes no proposal for it. The session finds these wishes of the user in its memory and in the instructions of the user. Whether a note is such a note is open on purpose, and the session judges it.

   On 2026-10-17, the user said: "if a memory contains the same note as a doc, then the memory should be deleted".
3. Write no candidate to memory. Make no new memory note, and add no text to a memory note. [The memory rule](../../../docs/dev/rules.md#docs) of `docs/dev/rules.md` gives this rule. Give each candidate that belongs in a tracked doc to step 6. Give each other candidate to the user in the summary of step 8. The user decides where such a candidate goes.

   Whether a candidate belongs in a tracked doc is open on purpose, and the session judges it.

   In the rounds of [Session-review rounds](../../../docs/dev/session-review-rounds.md), give such a candidate to the user, not to the planner. This step wins over the sentence of that page that sends each finding to the planner. The decision of the user on the candidate handles the finding, as a drop does. Until then, the finding stays open. Give it one time in the rounds of a session, not in each round.

   On 2026-11-04, the user said: "I want to move away from using memory at all. Rules should only be kept in tracked docs."
4. Delete each note, or each line of a note, that step 2 found stale or wrong. Write no new text in its place. If a note goes, also delete its line in the memory index. Also delete each note and trim each note, as the doc check of step 2 says. If a delete or a trim fails, tell the user the note and the error. Keep that note as it was.
5. Do this step for each existing note that the doc check of step 2 keeps in full or in part. Each such note goes to a tracked doc of the repo. The bullet that starts "The work on this repo must continue on any machine" of [What goes in a ticket](../../../docs/dev/planner.md#what-goes-in-a-ticket) in `docs/dev/planner.md` gives this rule. Item (f) covers a note that the user keeps out of the repo on purpose.
   - (a) If the note names an open issue, make no proposal for it. Read the state with `gh issue view <number> --json state -q .state`.
   - (b) If that read fails, make no proposal for the note. Tell the user the error.
   - (c) The memory step of [Land the work](../../../docs/dev/land-the-work.md#land-the-work) covers a note that names an open issue when the issue lands.
   - (d) If (a) to (c) and (f) do not stop the proposal, make a proposal. Do this as step 6 says for a candidate. The proposal goes to the same target. One proposal covers a note and a candidate of step 3 that give the same rule.
   - (e) After the proposal goes to its target, delete its lines from the note. The proposal goes to its target when the send of an item or a `SendMessage` works. It also goes there when a planner starts the draft of its issue. If the target is the user, it goes there now, and step 8 gives it in the reply. If only the frontmatter and the links are left, delete the note and its line in the memory index. If the send or the delete fails, keep the note as it was, and tell the user the error.
   - (f) A note that the user keeps out of the repo on purpose gets no proposal, as step 2 says. Give it to the user in the summary of step 8 on each run. Do this until the user deletes the note or moves it out of memory. A repeat of this list is not a new finding, so it does not keep the rounds running. A failed fetch of step 2 (b) or a failed read of step 2 (f) does not stop this item. Keep no record of the notes that a run gave to the user.

   On 2026-10-25, the user said: "and we need to update session-review to include a step to check for memories that need to be in tracked docs".

   On 2026-11-04, the user said: "while we are at it, /session-review must review existing memories and file issues to add them to tracked docs."
6. If a candidate belongs in a tracked doc of the repo, make a proposal. A proposal names the file and the change. Find the docs of the repo from the index in `AGENTS.md`. Send each proposal to the target that these docs give for the role of the session. If the docs give no target for the role of the session, give each proposal to the user in the reply. For a recurrence, follow [A recurrence](../../../docs/dev/issues.md#a-recurrence) of `docs/dev/issues.md`.
   If a proposal needs a tracked doc to name a document outside the repo, ask the user first. [The outside-document rule](../../../docs/dev/rules.md#docs) of `docs/dev/rules.md` gives the question. Make the proposal only after the answer. If the session works through the operator, ask the question as an item, as step 7 (d) says.
7. Find the open work of the session in the transcript. The open work has two kinds. An open question is a question or an offer of the session to the user that has no answer. Unfinished work is work that the session started or said that it will do. The session neither finished that work nor dropped it.
   - (a) Do not list work that an issue already holds. Do not list the work of another session.
   - (b) Do not do the open work in this step. Do not answer a question for the user.
   - (c) The session can drop moot work, as [A decision of the user](../../../docs/dev/working-with-the-user.md#a-decision-of-the-user) says. Step 8 names the drop.
   - (d) If the session works through the operator, send a new open question as an item. [The operator](../../../docs/dev/working-with-the-user.md#the-operator) gives this rule. An open question that already went to the operator as an item stays open with its id. Do not send that question again. Give its id in the list of step 8.
   - (e) A list entry that an earlier round of the same session listed is not a new finding. A round that lists only such list entries finds nothing new, so it can end the rounds. Open work with no answer does not keep the rounds running.

   On 2026-10-30, a session asked "Do you want me to find out why #537 closed?". Then it ran two rounds of `/session-review`, and neither round named the question. On 2026-10-31, the user asked: "Does session review include a rule for checking for unanswered open questions or unfinished work?"
8. Report a short summary: the memory notes that the session deleted or trimmed, and each proposal with its target. Add the open work of step 7 to the summary. Give the open work in one numbered list, in the form of [The form of a reply](../../../docs/dev/working-with-the-user.md#the-form-of-a-reply). If the session finds no open work, say so. Name each drop of step 7 (c).
   Also give each candidate that step 3 sends to the user, and each note of step 5 (f). If the session works through the operator, send them to the operator in one item. Step 7 (d) gives this rule for an open question.

## Rules

- Never edit a tracked doc, for example `AGENTS.md`, `CLAUDE.md` or a file under `docs/`. The reason: a tracked doc is shared with each contributor as soon as a commit holds it.
- Write no memory, as step 3 says. The skill only deletes a note or the lines of a note, as steps 4 and 5 say.
- This skill names no target for a proposal. The docs of the repo give the target for each role, as step 6 says. The reason: the docs of the repo are the one home of that rule, and the rule changes.

## Common mistakes

| Mistake | What to do instead |
| --- | --- |
| The session skips the staleness check of the existing notes. | Do each check of step 2. |
| The session skips the doc check of the existing notes. | Do the doc check of step 2, and step 5 for each kept note. |
| The session edits a tracked doc. | Make a proposal, as step 6 says. |
| The session writes a candidate to memory. | Write no memory. Give the candidate to step 6 or to the summary of step 8, as step 3 says. |
| The session tries to start the skill from a hook. | Run the skill only on a request, as "When to use" says. |
| The session keeps a proposal only in its reply, but the docs give a target for its role. | Send the proposal to that target, as step 6 says. |
| The session ends the review, but a question or an offer of the session still has no answer. | List the open work, as steps 7 and 8 say. |

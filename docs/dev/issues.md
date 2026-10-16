# Filing issues

This page gives the steps and the GitHub facts for the planning session when it files issues, blocked-by links and milestones on GitHub. The first bullet of [Before a post](#before-a-post) covers each session, not only the planning session. [planning.md](planning.md) defines the terms "planning session", "operator" and "blocked-by link". planning.md also holds the rules for what an issue says and where it goes. This page holds only how to do it on GitHub.

## Before a post

- Each session that posts an issue, or changes the title or the body of an open issue, drafts the text first. The session shows the draft to the operator, the person who works with that session (see [working-with-the-user.md](working-with-the-user.md)). A request of the operator such as "file an issue" or "draft a ticket" gets a draft first. For a change to an open issue, the draft shows the changed text. The session posts only after the operator approves that draft, for example with "file it" or "post it". The planning session also makes sure of the kinds of GitHub objects to make, as [The order of the work](planning.md#the-order-of-the-work) of planning.md says.
- Right before each post, the planning session searches all the issues of the repo, open and closed, by title and by body, for the same change. Other sessions file issues at the same time, so the list changes between two turns. An example search is `gh issue list --state all --search "<words> in:title,body" --limit 1000`.
- If an issue already covers the change, the planning session offers the operator an extension of that issue (its body or its links) instead of a new issue. The planning session tells the operator what each draft has that the other one does not have.
- The planning session writes all text that goes to GitHub with the simple-english skill: titles, bodies, comments, milestone descriptions and the text of project fields. This list is the full scope of the rule for the planning session. The simple-english bullet of [Limits](orchestration.md#limits) of orchestration.md gives the same rule for the orchestrator and its agents.
- For a priority label on an issue, see [The body of an issue](planning.md#the-body-of-an-issue) of planning.md.

## The blocked-by links

The rules for the links are in [The blocked-by links](planning.md#the-blocked-by-links) of planning.md. The commands below work with gh 2.101.0:

- To add a link: `gh issue edit <blocked number> --add-blocked-by <blocker number>`.
- To remove a link: `gh issue edit <blocked number> --remove-blocked-by <blocker number>`.
- Both commands take issue numbers.
- To read the links of an issue: `gh api repos/<owner>/<repo>/issues/<number>/dependencies/blocked_by`.

## The project board

- The board is the user project "tasker": https://github.com/users/codeguru42/projects/3 (number 3, id `PVT_kwHOACGSlc4BmiTL`). It is linked to `codeguru42/tasker`.
- The Status field has the id `PVTSSF_lAHOACGSlc4BmiTLzhlK7j4`. Its options are Todo (`f75ad846`), In progress (`47fc9ee4`) and Done (`98236657`).
- A workflow of the board adds each new issue with the status Todo within a minute. The planning session does not run `gh project item-add` for a new issue.
- The board moves an issue to Done when the issue closes. The board archives a closed item 7 days after its last update.
- To move a card: `gh project item-edit --project-id PVT_kwHOACGSlc4BmiTL --id <item id> --field-id PVTSSF_lAHOACGSlc4BmiTLzhlK7j4 --single-select-option-id <option id>`.
- The gh token needs the scopes `project` and `read:project`. If `gh project item-edit` fails with "missing required scopes [project read:project]", the operator runs `gh auth refresh -s project,read:project`.
- A fine-grained token cannot open a project of a user, because its Projects permission applies only to an organization.

## Milestones

[The milestone of an issue](planning.md#the-milestone-of-an-issue) of planning.md gives the milestone of each issue. The planning session closes a milestone only when the operator says so. Then it runs `gh api -X PATCH repos/codeguru42/tasker/milestones/<number> -f state=closed`.

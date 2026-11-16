# Forge

## Purpose

A forge hosts pull requests. It is separate from the issue tracker. The tracker account and the forge account serve
different services, so they can differ.

## Provider boundary

Tasker owns task state, persistence, branch publication, and caller time limits. Callers use the shared forge interface
and registry. Code outside `src/forge/` imports no concrete forge implementation. Shared types live in
[`src/forge/provider.ts`](../../src/forge/provider.ts), and concrete providers import those types.

## CI results

Workflow runs are included because dependency waits can remain visible after another job completes. A failed result
takes precedence over pending or passed results. If one read fails, `ciStatus()` waits for the other reads to finish and
then reports the failure of the read that failed first. No results means pending. The caller sets the time limit for
waiting.

## Pull requests

Discovery returns every open pull request from the origin for a head, including requests with different base branches.
It does not choose or adopt a request. The caller decides whether an existing request fits the task before it creates a
new one.

A merge request includes the expected head revision. The forge refuses the request if the remote head has changed. When
the forge accepts a merge request, that acceptance does not mean that the pull request has merged. The caller reads the
pull request state separately to establish completion.

`changePrBase` changes the base of an existing pull request. The operation changes only the base of a PR. The reason:
the PR base must follow the stored base of the task, and no other PR field depends on it.

`isPrDraft` reads whether a pull request is a draft. `markPrReady` takes a draft pull request out of draft. The reason:
the forge refuses to merge a draft, and the caller decides when to take a PR out of draft. The provider never does it by
itself.

## Provider selection

`forgeForRepo()` selects a provider from `repos.<key>.forge`. The forge account is separate from the issue tracker
account. The configuration schema and the provider registry must support the same provider names. The schema currently
accepts `github`, and the registry registers `github`. The registry passes the configured forge account to a new
provider.

For merge completion, see [Pull requests](#pull-requests).

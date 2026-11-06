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
takes precedence over pending or passed results. No results means pending. The caller sets the time limit for waiting.

## Pull requests

Discovery returns every open pull request from the origin for a head, including requests with different base branches.
It does not choose or adopt a request. The caller decides whether an existing request fits the task before it creates a
new one.

A merge request includes the expected head revision. The forge refuses the request if the remote head has changed. When
the forge accepts a merge request, that acceptance does not mean that the pull request has merged. The caller reads the
pull request state separately to establish completion.

## Provider selection

`forgeForRepo()` selects a provider from `repos.<key>.forge`. The forge account is separate from the issue tracker
account. The configuration schema and the provider registry must support the same provider names. The schema currently
accepts `github`, and the registry registers `github`. The registry passes the configured forge account to a new
provider.

After `mergePr()` returns, the caller reads the pull request state with `isPrMerged()` to establish completion.

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

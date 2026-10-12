# Doctor checks

`src/doctor/` holds the code that all doctor checks share. It does not depend on git or on an issue tracker. The git checks are in [version-control.md](version-control.md#doctor-checks). The GitHub checks are in [issue-trackers.md](issue-trackers.md#doctor-checks).

## The check type

The check type is in `src/doctor/check.ts`. A `Check` has `name`, `required`, `timeoutMs` and `run(env)`. `run()` resolves with `{ status, detail, remediation? }`. The status is `ok`, `warn` or `error`. `run()` never rejects and does not wait longer than `timeoutMs`.

## The shared wrapper

`timedCheck(spec, body)` in `src/doctor/timed-check.ts` is the one home of the timeout rules. `spec` is `{ name, required, timeoutMs }`. `body(env, { signal, deadline })` gives a `CheckResult`. Each check must pass `signal` to every process that it starts.

`run()` of the wrapper follows these rules:

- It makes `signal` with `AbortSignal.timeout(timeoutMs)`, and `deadline` as `Date.now() + timeoutMs`.
- When `signal` aborts, or the body throws a `DeadlineError`, the result is `timedOut(timeoutMs)`.
- Any other thrown value gives `error`. The detail is the message of the error, or the thrown text.
- When `signal` aborted and the result is not `error`, the result is `timedOut(timeoutMs)`. The check gives no partial result.

`timedOut(timeoutMs)` gives `error` with the detail `the check did not finish in <n> ms`.

A body throws `DeadlineError` when its own deadline passes, for a scan that starts no process. `findStaleLocks()` is an example.

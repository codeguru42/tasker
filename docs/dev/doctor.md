# Doctor checks

`src/doctor/` holds the code that all doctor checks share. It does not depend on git or on an issue tracker. The git checks are in [version-control.md](version-control.md#doctor-checks). The GitHub checks are in [issue-trackers.md](issue-trackers.md#doctor-checks).

## The shared wrapper

The shared wrapper is the one home of the timeout rules.

- Each check must pass its signal to every process that it starts.
- A check never rejects and never waits longer than its timeout.
- When the signal aborted and the result is not an error, the check gives the timeout result and no partial result.
- A scan that starts no process stops on its own deadline, because it has no process for the signal to stop.

import { ConfigError } from "../../src/config/schema.js";

// The error that fn throws. It throws, so the test fails, when fn returns. wanted names what the test
// needs in that message.
export function thrownBy(fn: () => unknown, wanted = "a throw"): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error(`the function returned, but the test needs ${wanted}`);
}

// The issues of the ConfigError that fn throws. It throws, so the test fails, when fn returns
// or when the error is not a ConfigError. It is the sync sibling of failureOf.
export function configIssuesOf(fn: () => unknown): string[] {
  const error = thrownBy(fn, "a ConfigError");
  if (!(error instanceof ConfigError)) {
    throw new Error(`the function threw ${String(error)}, not a ConfigError`, { cause: error });
  }
  return error.issues;
}

// The error that promise rejects with. It throws, so the test fails, when promise resolves
// or when the error is not an instance of type.
export async function failureOf<E extends Error>(
  promise: Promise<unknown>,
  type: abstract new (...args: never[]) => E,
): Promise<E> {
  const outcome = await promise.then(
    () => ({ rejected: false as const }),
    (error: unknown) => ({ rejected: true as const, error }),
  );
  if (!outcome.rejected) {
    throw new Error("the promise resolved, but the test needs a rejection");
  }
  if (!(outcome.error instanceof type)) {
    throw new Error(`the promise rejected with ${String(outcome.error)}, not a ${type.name}`);
  }
  return outcome.error;
}

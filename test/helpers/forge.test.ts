import { describe, expect, it } from "vitest";
import { forgeStub } from "./forge.js";

describe("forgeStub", () => {
  it("records lookup and create calls and returns configured results", async () => {
    const fake = forgeStub({
      openPrs: [{ number: 17, url: "https://example.test/pull/17", base: "main" }],
      createdPr: { number: 18, url: "https://example.test/pull/18" },
    });

    await expect(fake.provider.listOpenPrs({ cwd: "/work", head: "task-branch" }, {})).resolves.toEqual([
      { number: 17, url: "https://example.test/pull/17", base: "main" },
    ]);
    await expect(
      fake.provider.createPr({ cwd: "/work", head: "task-branch", base: "main", title: "Title", body: "Body" }, {}),
    ).resolves.toEqual({ number: 18, url: "https://example.test/pull/18" });
    expect(fake.calls).toEqual({
      listed: [{ cwd: "/work", head: "task-branch" }],
      created: [{ cwd: "/work", head: "task-branch", base: "main", title: "Title", body: "Body" }],
      ci: [],
      merged: [],
      queried: [],
      order: [],
    });
  });

  it("can reject lookup and create separately", async () => {
    const fake = forgeStub();
    fake.failList(new Error("lookup refused"));
    await expect(fake.provider.listOpenPrs({ cwd: "/work", head: "task-branch" }, {})).rejects.toThrow(
      "lookup refused",
    );

    fake.failCreate(new Error("create refused"));
    await expect(
      fake.provider.createPr({ cwd: "/work", head: "task-branch", base: "main", title: "Title", body: "Body" }, {}),
    ).rejects.toThrow("create refused");
  });

  it("records CI status and merge calls", async () => {
    const fake = forgeStub();

    await expect(fake.provider.ciStatus("head-sha", "/work", {})).resolves.toBe("pending");
    await expect(fake.provider.mergePr(42, "squash", "head-sha", "/work", {})).resolves.toBeUndefined();

    expect(fake.calls).toMatchObject({
      ci: [{ sha: "head-sha", cwd: "/work" }],
      merged: [{ number: 42, method: "squash", headSha: "head-sha", cwd: "/work" }],
    });
  });

  it("records merge status queries and can reject queries and merge requests", async () => {
    const fake = forgeStub({ mergedStatuses: [false, true] });

    await expect(fake.provider.isPrMerged(42, "/work", {})).resolves.toBe(false);
    await expect(fake.provider.isPrMerged(42, "/work", {})).resolves.toBe(true);
    fake.failQuery(new Error("query refused"));
    await expect(fake.provider.isPrMerged(42, "/work", {})).rejects.toThrow("query refused");
    fake.failMerge(new Error("merge refused"));
    await expect(fake.provider.mergePr(42, "merge", "head-sha", "/work", {})).rejects.toThrow("merge refused");

    expect(fake.calls.queried).toEqual([
      { number: 42, cwd: "/work" },
      { number: 42, cwd: "/work" },
      { number: 42, cwd: "/work" },
    ]);
    expect(fake.calls.merged).toEqual([{ number: 42, method: "merge", headSha: "head-sha", cwd: "/work" }]);
    expect(fake.calls.order).toEqual(["query", "query", "query", "merge"]);
  });
});

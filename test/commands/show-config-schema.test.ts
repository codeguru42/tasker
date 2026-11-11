import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConfigSchema } from "../../src/config/schema.js";
import { commands } from "../../src/commands/index.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { printedJson } from "../helpers/command-output.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const showConfigSchemaRun = (...extra: string[]) => runCommand(commands, "show-config-schema", ...extra);

interface SchemaLike {
  _def: Record<string, unknown>;
  shape?: Record<string, SchemaLike>;
}

function expectedPaths(schema: SchemaLike, path = ""): string[] {
  const def = schema._def;
  const type = def.type;
  if (["default", "optional", "nullable", "prefault", "nonoptional"].includes(String(type))) {
    return expectedPaths(def.innerType as SchemaLike, path);
  }
  if (type === "pipe") {
    const input = def.in as SchemaLike;
    const side = input._def.type === "object" ? input : (def.out as SchemaLike);
    return expectedPaths(side, path);
  }
  if (type === "object") {
    return Object.entries(schema.shape ?? {}).flatMap(([key, child]) => {
      const childPath = path === "" ? key : `${path}.${key}`;
      return [childPath, ...expectedPaths(child, childPath)];
    });
  }
  if (type === "record") {
    const placeholder = path === "trackers" ? "<name>" : "<key>";
    const childPath = `${path}.${placeholder}`;
    return [childPath, ...expectedPaths(def.valueType as SchemaLike, childPath)];
  }
  if (type === "union" || type === "discriminatedUnion") {
    const options = (def.options ?? []) as SchemaLike[];
    return options.flatMap((option) => expectedPaths(option, path));
  }
  return [];
}

function entriesOf(output: string): Record<string, unknown>[] {
  return JSON.parse(output) as Record<string, unknown>[];
}

describe("show-config-schema", () => {
  it("prints the schema as a JSON array with one described entry per path", async () => {
    const result = await showConfigSchemaRun();

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.endsWith("\n")).toBe(true);
    const entries = entriesOf(result.out);
    expect(result.out).toBe(printedJson(entries));
    expect(
      entries.every(
        (entry) =>
          Object.keys(entry).every((key) =>
            [
              "path",
              "type",
              "required",
              "description",
              "acceptedValues",
              "default",
              "provider",
              "constraints",
            ].includes(key),
          ) &&
          typeof entry.path === "string" &&
          typeof entry.type === "string" &&
          typeof entry.required === "boolean" &&
          typeof entry.description === "string" &&
          entry.description.length > 0,
      ),
    ).toBe(true);
    const actualPaths = entries.map((entry) => entry.path);
    expect(actualPaths).toEqual(expectedPaths(buildConfigSchema({}, process.cwd()) as unknown as SchemaLike));
    expect(actualPaths).toContain("repos.<key>.forge");
    expect(actualPaths).toContain("repos.<key>.vcs.config.authorName");
  });

  it("prints the selected path and all descendants in schema order", async () => {
    const entries = entriesOf((await showConfigSchemaRun("repos.<key>.forge")).out);

    expect(entries.map((entry) => entry.path)).toEqual([
      "repos.<key>.forge",
      "repos.<key>.forge.provider",
      "repos.<key>.forge.account",
      "repos.<key>.forge.mergeMethod",
    ]);
  });

  it("prints tracker provider metadata and field defaults", async () => {
    const entries = entriesOf((await showConfigSchemaRun()).out);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));

    expect(byPath.get("trackers.<name>.provider")).toMatchObject({ acceptedValues: ["github", "jira"] });
    expect(byPath.get("trackers.<name>.account")).toMatchObject({ provider: "github" });
    expect(byPath.get("trackers.<name>.apiToken")).toMatchObject({ provider: "jira" });
    expect(byPath.get("trackers.<name>.assignee")).toMatchObject({ default: "@me" });
    expect(byPath.get("repos.<key>.forge.mergeMethod")).toMatchObject({
      acceptedValues: ["merge", "squash", "rebase"],
      default: "merge",
    });
    expect(byPath.get("repos.<key>.verify.commands")).toMatchObject({ constraints: { minItems: 1 } });
    expect(byPath.get("repos.<key>.verify.commands")).toMatchObject({
      constraints: { items: { minLength: 1 } },
    });
    expect(byPath.get("repos.<key>.verify.env")).toMatchObject({
      constraints: { items: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$" } },
    });
    expect(byPath.get("repos.<key>.bootstrap.env")).toMatchObject({
      constraints: { items: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$" } },
    });
    expect(byPath.get("repos.<key>.bootstrap.commands")).not.toHaveProperty("constraints.items");
    for (const path of [
      "repos.<key>.issueTracker.match.labels",
      "repos.<key>.issueTracker.match.components",
      "repos.<key>.assistant.trustedExtensions",
    ]) {
      expect(byPath.get(path)).toMatchObject({ constraints: { items: { minLength: 1 } } });
    }
    expect(byPath.get("repos.<key>.issueTracker.account")?.provider).toBe("github");
    expect(byPath.get("repos.<key>.issueTracker.provider")?.required).toBe(false);
    expect(byPath.get("repos.<key>.issueTracker.provider")?.description).toMatch(
      /without `?tracker`?.*absent.*`?tracker`?/i,
    );
    expect(byPath.get("trackers.<name>.provider")?.required).toBe(true);
    expect(byPath.get("repos.<key>.issueTracker.match")?.description).toMatch(/labels.*components/i);
    expect(byPath.get("repos.<key>.issueTracker.account")?.description).toMatch(/GitHub.*requires.*Jira.*refuses/i);
    expect(byPath.get("repos.<key>.issueTracker.doneStatus")?.description).toMatch(
      /configuration loads without.*updateOnFinish.*key is missing.*doctor warns.*done write.*fails and only warns/i,
    );
    expect(byPath.get("trackers")?.default).toEqual({});
    expect(byPath.get("repos.<key>.vcs")?.default).toEqual({ provider: "git", config: {} });
    expect(byPath.get("repos.<key>.assistant.trustedExtensions")?.default).toEqual([]);
    expect(byPath.get("repos.<key>.issueTracker.assignee")?.description).toMatch(/GitHub.*comma/i);
    expect(byPath.get("repos.<key>.issueTracker.inProgressLabel")?.description).toMatch(/GitHub.*comma/i);
    expect(byPath.get("repos.<key>.issueTracker.doneLabel")?.description).toMatch(/GitHub.*comma/i);
    expect(byPath.get("repos.<key>.issueTracker.inProgressLabel")?.description).toMatch(/Jira.*refuses/i);
    expect(byPath.get("repos.<key>.issueTracker.doneLabel")?.description).toMatch(/Jira.*refuses/i);
    expect(byPath.get("repos.<key>.issueTracker.abortStatus")?.description).toMatch(/GitHub.*refuses/i);
    expect(byPath.get("repos.<key>.issueTracker.project")?.description).toMatch(
      /If it is absent, tasker uses the repo key\. For Jira, a set project must be a Jira project key/i,
    );
    expect(byPath.get("repos.<key>.issueTracker.site")?.description).toMatch(/Jira.*bare.*host.*dot/i);
    expect(byPath.get("repos.<key>.defaultBaseBranch")?.description).toMatch(/refs\/heads\//);
    for (const path of ["repos.<key>.verify.env", "repos.<key>.bootstrap.env"]) {
      expect(byPath.get(path)?.description).toMatch(/\^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$/);
      expect(byPath.get(path)?.description).toMatch(/TASKER_/);
      expect(byPath.get(path)?.description).toMatch(/already receives.*HOME/i);
    }
    expect(byPath.get("dataRoot")?.description).toMatch(/expand.*~.*\$NAME.*\$\{NAME\}.*absolute/i);
    expect(byPath.get("skillsDirs")?.description).toMatch(/expand.*~.*\$NAME.*\$\{NAME\}.*absolute/i);
    expect(byPath.get("repos.<key>.issueTracker.site")?.description).toMatch(/ASCII.*uppercase.*lowercase/i);
    expect(byPath.get("repos.<key>.issueTracker.provider")?.description).toMatch(/^The kind of tracker\./);
    expect(byPath.get("repos.<key>.issueTracker.project")?.description).toMatch(/If it is absent.*repo key/i);
    expect(byPath.get("repos.<key>.sessions.models.operator.model")?.description).toMatch(/model of the agent kind/i);
    expect(byPath.get("repos.<key>.assistant.trustedExtensions")?.description).toMatch(/only pi/i);
    expect(byPath.get("repos.<key>.assistant.models.plan.model")?.description).toMatch(/provider/i);
    expect(byPath.get("repos.<key>.sessions")?.description).toMatch(/operator.*planner.*orchestrator/i);
    expect(byPath.get("repos.<key>.sessions.models.operator.model")?.description).toMatch(/provider/i);
    expect(byPath.get("repos.<key>.issueTracker.site")?.description).toMatch(/site of the tracker/i);
    expect(byPath.get("repos.<key>.issueTracker.abortStatus")?.provider).toBe("jira");
    expect(byPath.get("repos.<key>.assistant.trustedExtensions")?.provider).toBe("pi");
    expect(byPath.get("repos.<key>.vcs.provider")).toMatchObject({ required: false, default: "git" });
  });

  it.each(["repos.codeguru42/tasker.forge", "no.such.key"])("rejects unknown path %s", async (path) => {
    expect(await showConfigSchemaRun(path)).toEqual({
      code: 1,
      out: "",
      err: `configuration key path not found: ${path}\n`,
    });
  });

  it("does not read a missing configuration file", async () => {
    const path = join(useTempDir("tasker-schema-"), "missing.json");
    useProcessEnv({ TASKER_CONFIG: path });

    expect(await showConfigSchemaRun()).toMatchObject({ code: 0, err: "" });
  });

  it("shows help and rejects output format flags", async () => {
    const { code, help } = await runHelp(commands, "show-config-schema");
    expect(code).toBe(0);
    expect(help).toContain("configuration schema");
    expect((await showConfigSchemaRun("--json")).err).toContain("error: unknown option '--json'");
  });
});

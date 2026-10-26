import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AdfError, adfToText } from "../../../src/issues/jira/adf.js";
import { thrownBy } from "../../helpers/errors.js";

const toText = (value: unknown) => adfToText(value);

type Node = Record<string, unknown>;

const node = (type: string, content?: unknown[], attrs?: Node): Node => ({
  type,
  ...(content === undefined ? {} : { content }),
  ...(attrs === undefined ? {} : { attrs }),
});
const doc = (...content: unknown[]) => node("doc", content);
const p = (...content: unknown[]) => node("paragraph", content);
const t = (text: unknown, marks?: unknown[]): Node => ({ type: "text", text, ...(marks ? { marks } : {}) });
const br = () => node("hardBreak");
const item = (...content: unknown[]) => node("listItem", content);
const bullets = (...items: unknown[]) => node("bulletList", items);
const ordered = (items: unknown[], attrs?: Node) => node("orderedList", items, attrs);
const leaf = (type: string, attrs?: Node) => node(type, undefined, attrs);

function expectAdfError(value: unknown, message: string) {
  const error = thrownBy(() => toText(value));
  expect(error).toBeInstanceOf(AdfError);
  expect((error as AdfError).name).toBe("AdfError");
  expect((error as AdfError).message).toBe(message);
}

describe("adfToText", () => {
  describe("no description", () => {
    it("gives an empty text for null", () => {
      expect(toText(null)).toBe("");
    });

    it("gives an empty text for undefined", () => {
      expect(toText(undefined)).toBe("");
    });
  });

  describe("input that is not a document", () => {
    it.each([
      ["x", "string"],
      [5, "number"],
      [true, "boolean"],
    ])("names the typeof for %j", (value, kind) => {
      expectAdfError(value, `the ADF document is ${kind}`);
    });

    it("names an array", () => {
      expectAdfError([], "the ADF document is an array");
    });

    it.each([[{}], [{ type: 3 }]])("names an object with no type for %j", (value) => {
      expectAdfError(value, "the ADF document is an object with no type");
    });

    it.each([[{ type: "doc" }], [{ type: "doc", content: {} }]])(
      "names a doc node with no content array for %j",
      (value) => {
        expectAdfError(value, "the ADF document is a doc node with no content array");
      },
    );

    it("names the type of another node", () => {
      expectAdfError(p(), 'the ADF document is a node of the type "paragraph"');
    });
  });

  describe("node types", () => {
    it("separates blocks with a blank line", () => {
      expect(toText(doc(p(t("a")), p(t("b"))))).toBe("a\n\nb");
    });

    it("joins the text children of a paragraph", () => {
      expect(toText(doc(p(t("a"), t("b"))))).toBe("ab");
    });

    it("gives the text of a heading", () => {
      expect(toText(doc(node("heading", [t("Title")], { level: 2 })))).toBe("Title");
    });

    it("ignores the marks of a text", () => {
      const marks = [{ type: "strong" }, { type: "code" }, { type: "link", attrs: { href: "https://x.test" } }];
      expect(toText(doc(p(t("a", marks))))).toBe("a");
    });

    it("gives an empty text for a text value that is not a string", () => {
      expect(toText(doc(p(t(5))))).toBe("");
    });

    it("gives a line end for a hardBreak", () => {
      expect(toText(doc(p(t("a"), br(), t("b"))))).toBe("a\nb");
    });

    it("gives a line for each item of a bulletList", () => {
      expect(toText(doc(bullets(item(p(t("a"))), item(p(t("b"))))))).toBe("- a\n- b");
    });

    it("numbers the items of an orderedList from 1", () => {
      expect(toText(doc(ordered([item(p(t("a"))), item(p(t("b")))])))).toBe("1. a\n2. b");
    });

    it("starts an orderedList at attrs.order", () => {
      expect(toText(doc(ordered([item(p(t("a"))), item(p(t("b")))], { order: 3 })))).toBe("3. a\n4. b");
    });

    it("ignores an attrs.order that is not a number", () => {
      expect(toText(doc(ordered([item(p(t("a"))), item(p(t("b")))], { order: "3" })))).toBe("1. a\n2. b");
    });

    it("indents the later lines of a bullet item", () => {
      expect(toText(doc(bullets(item(p(t("a"), br(), t("b"))))))).toBe("- a\n  b");
    });

    it("indents the later lines of an ordered item", () => {
      expect(toText(doc(ordered([item(p(t("a"), br(), t("b")))])))).toBe("1. a\n   b");
    });

    it("keeps the text of a codeBlock with its leading spaces", () => {
      const code = "if (x) {\n  y();\n}";
      expect(toText(doc(node("codeBlock", [t(code, [{ type: "code" }])])))).toBe(code);
    });

    it("gives the url of an inlineCard", () => {
      expect(toText(doc(p(leaf("inlineCard", { url: "https://x.test" }))))).toBe("https://x.test");
    });

    it.each(["blockCard", "embedCard"])("gives the url of a %s", (type) => {
      expect(toText(doc(leaf(type, { url: "https://x.test" })))).toBe("https://x.test");
    });

    it.each(["inlineCard", "blockCard", "embedCard"])("gives an empty text for a %s with no attrs", (type) => {
      expect(toText(doc(leaf(type)))).toBe("");
    });

    it("gives the text of a mention", () => {
      expect(toText(doc(p(leaf("mention", { text: "@Ann" }))))).toBe("@Ann");
    });

    it("gives an empty text for a mention with no text", () => {
      expect(toText(doc(p(leaf("mention"))))).toBe("");
    });

    it("names a media by its alt", () => {
      expect(toText(doc(node("mediaSingle", [leaf("media", { alt: "pic.png", id: "abc" })])))).toBe(
        "[attachment: pic.png]",
      );
    });

    it("names a media by its id", () => {
      expect(toText(doc(node("mediaSingle", [leaf("media", { id: "abc" })])))).toBe("[attachment: abc]");
    });

    it("names a media with neither alt nor id", () => {
      expect(toText(doc(node("mediaSingle", [leaf("media")])))).toBe("[attachment]");
    });

    it("gives a blank line for a rule between blocks", () => {
      expect(toText(doc(p(t("a")), leaf("rule"), p(t("b"))))).toBe("a\n\nb");
    });

    it("gives the children of an unknown block type", () => {
      expect(toText(doc(node("panel", [p(t("a"))])))).toBe("a");
    });
  });

  describe("inline and block children", () => {
    it("joins inline children of a doc and separates them from a block", () => {
      expect(toText(doc(t("a"), t("b"), p(t("c"))))).toBe("ab\n\nc");
    });
  });

  describe("empty strings", () => {
    it("takes an empty alt as no alt", () => {
      expect(toText(doc(node("mediaSingle", [leaf("media", { alt: "", id: "abc" })])))).toBe("[attachment: abc]");
    });

    it("takes an empty alt and an empty id as neither", () => {
      expect(toText(doc(node("mediaSingle", [leaf("media", { alt: "", id: "" })])))).toBe("[attachment]");
    });

    it("takes an empty url and an empty text as no value", () => {
      expect(toText(doc(p(leaf("inlineCard", { url: "" }), leaf("mention", { text: "" }))))).toBe("");
    });
  });

  describe("blocks that give an empty text", () => {
    it("adds no blank line for an empty paragraph or a rule", () => {
      expect(toText(doc(p(t("a")), p(), leaf("rule"), p(t("b"))))).toBe("a\n\nb");
    });
  });

  describe("white space at the end", () => {
    it("removes white space at the end of a line", () => {
      expect(toText(doc(p(t("a  "))))).toBe("a");
    });

    it("removes blank lines at the end", () => {
      expect(toText(doc(p(t("a")), p(br(), br())))).toBe("a");
    });
  });

  describe("content that is missing or wrong", () => {
    it("gives an empty text for a paragraph with no content", () => {
      expect(toText(doc(p()))).toBe("");
    });

    it("skips children that are not objects", () => {
      expect(toText(doc(p("x", null, 5, t("a"))))).toBe("a");
    });
  });

  describe("empty list items", () => {
    it("gives the marker alone for an item that is not an object", () => {
      expect(toText(doc(bullets(5, item(p(t("a"))))))).toBe("-\n- a");
    });

    it("gives a number to an empty item of an orderedList", () => {
      expect(toText(doc(ordered([item(), item(p(t("a")))])))).toBe("1.\n2. a");
    });
  });

  describe("unknown and nested nodes", () => {
    it("joins the text children of a taskItem", () => {
      expect(toText(doc(node("taskList", [node("taskItem", [t("a"), t("b"), t("c")])])))).toBe("abc");
    });

    it("joins an unknown inline node with no separator", () => {
      expect(toText(doc(p(t("a"), node("foo", [t("x")]))))).toBe("ax");
    });

    it("indents a nested list under a bullet item", () => {
      expect(toText(doc(bullets(item(p(t("a")), bullets(item(p(t("b"))))))))).toBe("- a\n  - b");
    });

    it("indents a nested bullet list under an ordered item", () => {
      expect(toText(doc(ordered([item(p(t("a")), bullets(item(p(t("b")))))])))).toBe("1. a\n   - b");
    });

    it("puts the paragraphs of an item on separate lines", () => {
      expect(toText(doc(bullets(item(p(t("a")), p(t("b"))))))).toBe("- a\n  b");
    });
  });

  describe("a measured description", () => {
    it("turns the description of a Jira issue into text", () => {
      const fixture = readFileSync(
        fileURLToPath(new URL("../../fixtures/jira/adf-description.json", import.meta.url)),
        "utf8",
      );
      expect(toText(JSON.parse(fixture))).toBe(
        "Steps to test\n\nRead the design at the example page.\n\n- first bullet\n- second bullet\n\n1. first step\n2. second step\n\nnpm test\n  --watch",
      );
    });
  });
});

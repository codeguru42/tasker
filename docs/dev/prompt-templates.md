---
name: prompt-templates
description: Load this document when you add, change, read or check a prompt template file in prompt-templates/, or when you move a prompt from the code into a template.
---

# The prompt templates

A prompt template is a file that holds the words of one prompt. This page gives the rules of these files and the code
that reads and checks them.

## The folder and the path form

The template files live in `prompt-templates/` at the root of the repo. Each file has the path
`prompt-templates/<family>/<name>.md`. The `<family>` and the `<name>` use lowercase letters, digits and `-` only. A
family groups the prompts of one part of tasker. No file lives at another depth.

The `files` list of `package.json` holds `prompt-templates`, so the package ships the folder.

## The front matter

Each file starts with a front matter block between two `---` lines. The block has three keys:

- `name`: The name of the file without `.md`.
- `description`: One line that starts with `Load this template when`.
- `placeholders`: The list of the placeholders of the body.

Each key stands once. A second line of a key is a problem, and the code keeps the first value.

A placeholder is a name in double braces, for example `{{ISSUE_TEXT}}`. Its name has capital letters, digits and `_`. A
name in lowercase, for example `{{a}}`, is plain text.

The `placeholders` key is `placeholders: {}` when the body has no placeholder. Otherwise the key stands alone on its
line, and each placeholder has one line below it. The line has two spaces of indent, the name, a colon, a space and a
short text that says what the value is.

The code parses only this fixed form by hand, because the repo has no YAML library. Each other line in the front matter
is a problem. A family issue that needs another form must widen the parser in its own change.

## The body

The body is all text after the closing `---` line. The code gives the body with nothing removed or added. A final
newline stays, and a missing final newline stays missing.

The `placeholders` list names each placeholder of the body and no other. A placeholder in the list that the body does
not use is a problem. A placeholder in the body that the list lacks is a problem too. One list is the one home of this
fact, so the code needs no second list.

## Line ends and the formatter

A template file has LF line ends only. A CR byte is a problem, because the exact body is part of the prompt.

`.prettierignore` holds `prompt-templates/`. The formatter would wrap the long lines of the prose and so change the
prompt. The exclusion keeps the words as the author wrote them.

## Read and check

The code lives in `src/prompts/template-file.ts`.

- `checkPromptTemplate(path)` gives the list of the problems of a file. An empty list means that the file is valid.
- `readPromptTemplate(path)` gives the name, the description, the placeholders and the body. It throws one error that
  lists each problem if the file is not valid.

Both functions run the same steps, so a check and a read never differ. `placeholderNames` in `src/prompts/template.ts`
finds the placeholders. `fillTemplate` uses it too, so the pattern has one home.

A session reads a template with the same two steps as [the doc-read rule](doc-reads.md#the-doc-read-rule). Tasker reads
a template with `readPromptTemplate`.

## The test of each file

Each template file has a test file `test/prompt-templates/<family>/<name>.test.ts`. The test calls `checkPromptTemplate`
and expects an empty list.

`promptTemplateTestProblems` in `test/helpers/prompt-templates.ts` walks the folder. It reports each `.md` file with a
wrong path form and each template that has no test file. A test runs it on the real folders and expects no problem. A
missing template folder counts as an empty folder.

## The family issues

Each family issue moves the words of its prompts into template files. It keeps its own rules in its own doc. It also
applies the link rule to the parts that it moves.

The words of a prompt can state a rule that a doc also states. This is the one exception to the one-home rule for
templates. [The one-home rule](rules.md#code) says the rest.

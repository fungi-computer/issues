# Issues (`@fungi.computer/issues`)

Issues validates a Markdown issue tracker kept in a repository's `issues/`
folder and works out which tickets are unblocked.

## Install

```sh
npm install @fungi.computer/issues
```

## Inspect a tree

`inspectIssueTree(files)` validates a complete `issues/` tree supplied as a
record of relative paths and Markdown text. It returns typed diagnostics,
summaries, the unblocked frontier, and metadata-only records. Any invalid ticket
makes `records` empty; callers can retain their previous valid projection.
Filesystem discovery, Git access, commit identity and persistence belong to the
caller. Repository tooling supplies the local filesystem adapter.

The single frontmatter contract lives in `src/issue-schema.ts`. VFile Matter
owns YAML extraction, Effect validates JSON values, @cfworker/json-schema
applies the contract (no code generation, so it runs in Workers and under a
strict CSP), and remark parses Markdown headings. Heading comparisons retain
literal inline Markdown; fenced code does not supply required sections. The
blocker walk is iterative, so dependency depth does not consume the JavaScript
call stack.

## Quick start

```ts
import { inspectIssueTree } from "@fungi.computer/issues";

const { records, diagnostics } = inspectIssueTree({});
console.log({ records, diagnostics });
```

## Core concepts

The caller supplies a complete tree snapshot. Invalid tickets produce
diagnostics and no accepted records; filesystem discovery and persistence remain
with the caller.

## Examples and checks

The packed runtime fixture at `test/stranger/runtime.mjs` exercises the public
API in a fresh consumer. Run `pnpm run stranger` after building the package.

## Contribute and license

See [LICENSE](LICENSE) for the MIT terms.

## Packed consumer readiness

Run `pnpm run build`, `pnpm run pack` and `pnpm run stranger` in this package.
The maintained stranger proof installs only package tarballs into a fresh npm
consumer, checks the exact shipped files, runs the public runtime fixture and
compiles every JavaScript entrypoint with strict NodeNext and no library-check
skip. This qualification does not publish npm releases or push a repository
split.

See [LICENSE](LICENSE).

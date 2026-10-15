import { Validator, type OutputUnit } from "@cfworker/json-schema";
import { Schema } from "effect";
import type { Heading } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { VFile } from "vfile";
import { matter } from "vfile-matter";

import issueFrontmatterSchema from "./issue-schema.js";

const ISSUE_PATH =
  /^(?<effort>[a-z0-9]+(?:-[a-z0-9]+)*)\/(?<number>[0-9]{2}[a-z]?)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const TERMINAL_STATUSES = new Set<IssueStatus>(["resolved", "wontfix"]);
const FRONTIER_STATUSES = new Set<IssueStatus>([
  "ready-for-agent",
  "ready-for-human",
]);

export type IssueStatus =
  | "needs-triage"
  | "needs-info"
  | "ready-for-agent"
  | "ready-for-human"
  | "in-progress"
  | "resolved"
  | "wontfix";

export type IssueFrontmatter = {
  readonly id: string;
  readonly title: string;
  readonly type:
    "bug" | "enhancement" | "task" | "research" | "prototype" | "decision";
  readonly status: IssueStatus;
  readonly priority: "p0" | "p1" | "p2" | "p3";
  readonly created: string;
  readonly assignee: string | null;
  readonly areas: readonly string[];
  readonly blocked_by: readonly string[];
};

export type IssueDiagnostic = {
  readonly path: string;
  readonly code:
    | "invalid-ticket-path"
    | "invalid-frontmatter"
    | "id-path-mismatch"
    | "duplicate-id"
    | "title-mismatch"
    | "missing-section"
    | "unknown-blocker"
    | "self-blocker"
    | "blocker-cycle";
  readonly detail: string;
};

export type IssueSummary = {
  readonly id: string;
  readonly path: string;
  readonly status: IssueStatus;
  readonly blocked: boolean;
};

/** The validated frontmatter fields Grove reads from the Team issue index. */
export type IssueIndexRecord = Readonly<
  Pick<
    IssueFrontmatter,
    "id" | "title" | "status" | "priority" | "assignee" | "areas" | "blocked_by"
  > & {
    path: string;
    blocked: boolean;
  }
>;

export type IssueTrackerReport = {
  readonly schemaVersion: 1;
  readonly status: "pass" | "fail";
  readonly issues: readonly IssueSummary[];
  readonly records: readonly IssueIndexRecord[];
  readonly frontier: readonly string[];
  readonly diagnostics: readonly IssueDiagnostic[];
};

type ParsedIssue = {
  readonly path: string;
  readonly frontmatter: IssueFrontmatter;
};

function isTrackerRecord(path: string): boolean {
  return (
    path !== "README.md" &&
    !path.startsWith("templates/") &&
    path !== "spec.md" &&
    !path.endsWith("/spec.md") &&
    path !== "map.md" &&
    !path.endsWith("/map.md")
  );
}

const markdown = unified().use(remarkParse);

/** Preserve the literal inline Markdown compared by the issue title contract. */
function headingSource(body: string, heading: Heading): string {
  if (heading.children.length === 0) return "";
  const start = heading.children.at(0)?.position?.start.offset;
  const end = heading.children.at(-1)?.position?.end.offset;
  if (start === undefined || end === undefined)
    throw new Error("Markdown parser omitted heading source positions");
  return body.slice(start, end);
}

function schemaDetail(errors: readonly OutputUnit[]): string {
  return errors
    .filter((error) => error.keyword !== "properties")
    .map(
      (error) =>
        `${error.instanceLocation.replace(/^#/u, "") || "/"} ${error.error}`,
    )
    .join("; ");
}

/**
 * The frontmatter contract, checked without code generation so the validator
 * runs where eval is forbidden (Workers, App frames with a strict CSP).
 */
type FrontmatterCheck = Readonly<{
  accepts: (value: typeof Schema.Json.Type) => value is IssueFrontmatter;
  errors: () => readonly OutputUnit[];
}>;

function frontmatterCheck(): FrontmatterCheck {
  const validator = new Validator(issueFrontmatterSchema, "2020-12", false);
  let last: readonly OutputUnit[] = [];
  return {
    accepts: (value): value is IssueFrontmatter => {
      const result = validator.validate(value);
      last = result.errors;
      return result.valid;
    },
    errors: () => last,
  };
}

function requiredSections(frontmatter: IssueFrontmatter): readonly string[] {
  const sections = [
    frontmatter.type === "research" ||
    frontmatter.type === "decision" ||
    frontmatter.type === "prototype"
      ? "Question"
      : "Outcome",
    "Context",
    "Acceptance criteria",
    "Verification",
  ];
  if (frontmatter.type === "bug") sections.splice(1, 0, "Reproduction");
  if (frontmatter.type === "research" || frontmatter.type === "decision")
    sections.splice(1, 0, "Answer");
  if (TERMINAL_STATUSES.has(frontmatter.status)) sections.push("Resolution");
  return sections;
}

function validateBody(
  path: string,
  body: string,
  frontmatter: IssueFrontmatter,
): readonly IssueDiagnostic[] {
  const diagnostics: IssueDiagnostic[] = [];
  const headings = markdown
    .parse(body)
    .children.filter((node) => node.type === "heading");
  const titleHeading = headings.find((heading) => heading.depth === 1);
  const title =
    titleHeading === undefined ? undefined : headingSource(body, titleHeading);
  if (title !== frontmatter.title)
    diagnostics.push({
      path,
      code: "title-mismatch",
      detail: `H1 must exactly match frontmatter title ${JSON.stringify(frontmatter.title)}`,
    });
  const sections = new Set(
    headings
      .filter((heading) => heading.depth === 2)
      .map((heading) => headingSource(body, heading)),
  );
  for (const section of requiredSections(frontmatter)) {
    if (!sections.has(section))
      diagnostics.push({
        path,
        code: "missing-section",
        detail: `missing required section ## ${section}`,
      });
  }
  return diagnostics;
}

function parseIssue(
  path: string,
  source: string,
  validator: FrontmatterCheck,
  diagnostics: IssueDiagnostic[],
): ParsedIssue | null {
  const pathMatch = ISSUE_PATH.exec(path);
  if (pathMatch === null) {
    diagnostics.push({
      path,
      code: "invalid-ticket-path",
      detail: "ticket path must be issues/<effort>/<NN[a-z]>-<slug>.md",
    });
    return null;
  }
  const file = new VFile(source);
  let value: typeof Schema.Json.Type;
  try {
    matter(file, { strip: true });
    value = Schema.decodeUnknownSync(Schema.Json)(file.data.matter);
  } catch (error) {
    diagnostics.push({
      path,
      code: "invalid-frontmatter",
      detail: error instanceof Error ? error.message : "YAML parsing failed",
    });
    return null;
  }
  if (!validator.accepts(value)) {
    diagnostics.push({
      path,
      code: "invalid-frontmatter",
      detail: schemaDetail(validator.errors()),
    });
    return null;
  }
  const expectedId = `${pathMatch.groups?.effort ?? ""}-${pathMatch.groups?.number ?? ""}`;
  if (value.id !== expectedId)
    diagnostics.push({
      path,
      code: "id-path-mismatch",
      detail: `frontmatter id must be ${expectedId}`,
    });
  diagnostics.push(...validateBody(path, file.toString(), value));
  return { path, frontmatter: value };
}

function addGraphDiagnostics(
  records: readonly ParsedIssue[],
  diagnostics: IssueDiagnostic[],
): ReadonlyMap<string, ParsedIssue> {
  const byId = new Map<string, ParsedIssue>();
  for (const record of records) {
    const existing = byId.get(record.frontmatter.id);
    if (existing !== undefined) {
      diagnostics.push({
        path: record.path,
        code: "duplicate-id",
        detail: `issue id duplicates ${existing.path}`,
      });
    } else byId.set(record.frontmatter.id, record);
  }
  for (const record of records) {
    for (const blocker of record.frontmatter.blocked_by) {
      if (blocker === record.frontmatter.id)
        diagnostics.push({
          path: record.path,
          code: "self-blocker",
          detail: "an issue cannot block itself",
        });
      else if (!byId.has(blocker))
        diagnostics.push({
          path: record.path,
          code: "unknown-blocker",
          detail: `blocked_by references unknown issue ${blocker}`,
        });
    }
  }
  addCycleDiagnostics(byId, diagnostics);
  return byId;
}

function addCycleDiagnostics(
  records: ReadonlyMap<string, ParsedIssue>,
  diagnostics: IssueDiagnostic[],
): void {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const reported = new Set<string>();

  for (const root of records.values()) {
    const rootId = root.frontmatter.id;
    if (state.has(rootId)) continue;
    const frames = [
      { record: root, blockers: root.frontmatter.blocked_by.values() },
    ];
    state.set(rootId, "visiting");
    stack.push(rootId);
    while (frames.length > 0) {
      const frame = frames.at(-1);
      if (frame === undefined)
        throw new Error("Issue graph traversal lost its active frame");
      const next = frame.blockers.next();
      if (next.done) {
        state.set(frame.record.frontmatter.id, "visited");
        frames.pop();
        stack.pop();
        continue;
      }
      const blocker = next.value;
      const record = records.get(blocker);
      if (record === undefined) continue;
      if (state.get(blocker) === "visiting") {
        const start = stack.indexOf(blocker);
        const cycle = [...stack.slice(start), blocker];
        const key = [...new Set(cycle)].sort().join("|");
        if (!reported.has(key)) {
          reported.add(key);
          diagnostics.push({
            path: frame.record.path,
            code: "blocker-cycle",
            detail: `blocker cycle: ${cycle.join(" -> ")}`,
          });
        }
      } else if (!state.has(blocker)) {
        state.set(blocker, "visiting");
        stack.push(blocker);
        frames.push({
          record,
          blockers: record.frontmatter.blocked_by.values(),
        });
      }
    }
  }
}

function issueSummaries(
  records: ReadonlyMap<string, ParsedIssue>,
): readonly IssueSummary[] {
  return [...records.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((record) => ({
      id: record.frontmatter.id,
      path: record.path,
      status: record.frontmatter.status,
      blocked: record.frontmatter.blocked_by.some((blocker) => {
        const blockingRecord = records.get(blocker);
        return (
          blockingRecord === undefined ||
          !TERMINAL_STATUSES.has(blockingRecord.frontmatter.status)
        );
      }),
    }));
}

/** Validate one pushed `issues/` tree as a schema and dependency graph. */
export function inspectIssueTree(
  files: Readonly<Record<string, string>>,
): IssueTrackerReport {
  const validator = frontmatterCheck();
  const diagnostics: IssueDiagnostic[] = [];
  const records: ParsedIssue[] = [];
  for (const [path, source] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!path.endsWith(".md")) continue;
    if (!isTrackerRecord(path)) continue;
    const parsed = parseIssue(path, source, validator, diagnostics);
    if (parsed !== null) records.push(parsed);
  }
  const recordsById = addGraphDiagnostics(records, diagnostics);
  const issues = issueSummaries(recordsById);
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const valid = diagnostics.length === 0;
  const indexedRecords = valid
    ? [...recordsById.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((record) => {
          const summary = issueById.get(record.frontmatter.id);
          if (summary === undefined)
            throw new Error("Validated issue record has no summary");
          const { id, title, status, priority, assignee, areas, blocked_by } =
            record.frontmatter;
          return {
            id,
            title,
            status,
            priority,
            assignee,
            areas,
            blocked_by,
            path: record.path,
            blocked: summary.blocked,
          } satisfies IssueIndexRecord;
        })
    : [];
  return {
    schemaVersion: 1,
    status: valid ? "pass" : "fail",
    issues,
    records: indexedRecords,
    frontier: issues
      .filter(
        (issue) =>
          !issue.blocked &&
          FRONTIER_STATUSES.has(issue.status) &&
          recordsById.get(issue.id)?.frontmatter.assignee === null,
      )
      .map((issue) => issue.id),
    diagnostics: diagnostics.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code),
    ),
  };
}

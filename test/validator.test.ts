import { describe, expect, it } from "vitest";
import { inspectIssueTree } from "../src/validator.js";

function task(options: {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly assignee?: string | null;
  readonly blockedBy?: readonly string[];
}): string {
  const status = options.status ?? "ready-for-agent";
  const assignee = options.assignee ?? null;
  const blockedBy = options.blockedBy ?? [];
  return `---
id: ${options.id}
title: ${JSON.stringify(options.title)}
type: task
status: ${status}
priority: p1
created: 2026-08-29
assignee: ${assignee === null ? "null" : JSON.stringify(assignee)}
areas: [testing]
blocked_by: [${blockedBy.join(", ")}]
---

# ${options.title}

## Outcome

The observable result.

## Context

The governing Wiki record.

## Acceptance criteria

- [ ] The result is observable.

## Verification

- [ ] Run the focused check.
`;
}

describe("pushed issue tree", () => {
  it("validates tickets together and projects Grove index fields", () => {
    const report = inspectIssueTree({
      "runtime-refork/01-refork-mule.md": task({
        id: "runtime-refork-01",
        title: "Re-fork Mule",
      }),
      "runtime-refork/02-refork-shiitake.md": task({
        id: "runtime-refork-02",
        title: "Re-fork Shiitake",
        blockedBy: ["runtime-refork-01"],
      }),
    });

    expect(report.status).toBe("pass");
    expect(report.frontier).toEqual(["runtime-refork-01"]);
    expect(report.records).toEqual([
      {
        id: "runtime-refork-01",
        title: "Re-fork Mule",
        status: "ready-for-agent",
        priority: "p1",
        assignee: null,
        areas: ["testing"],
        blocked_by: [],
        path: "runtime-refork/01-refork-mule.md",
        blocked: false,
      },
      {
        id: "runtime-refork-02",
        title: "Re-fork Shiitake",
        status: "ready-for-agent",
        priority: "p1",
        assignee: null,
        areas: ["testing"],
        blocked_by: ["runtime-refork-01"],
        path: "runtime-refork/02-refork-shiitake.md",
        blocked: true,
      },
    ]);
  });

  it("publishes no index records when any ticket fails validation", () => {
    const report = inspectIssueTree({
      "runtime-refork/01-refork-mule.md": `---\nid: wrong\ntitle: "Broken"\n---\n`,
    });

    expect(report.status).toBe("fail");
    expect(report.records).toEqual([]);
    expect(report.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts letter-suffixed issue numbers", () => {
    const report = inspectIssueTree({
      "launch-hardening-v1/11b-bundle-the-cli.md": task({
        id: "launch-hardening-v1-11b",
        title: "Bundle the CLI",
      }),
    });

    expect(report.status).toBe("pass");
    expect(report.records.map(({ id }) => id)).toEqual([
      "launch-hardening-v1-11b",
    ]);
  });
});

describe("Markdown and graph boundaries", () => {
  it("ignores non-ticket files and derives the frontier from terminal blockers", () => {
    const report = inspectIssueTree({
      "README.md": "Tracker guide",
      "templates/issue.md": "Unfilled template",
      "graph/map.md": "Effort map",
      "graph/spec.md": "Effort specification",
      "graph/notes.txt": "Not Markdown",
      "graph/01-done.md":
        task({
          id: "graph-01",
          title: "Done",
          status: "resolved",
          assignee: "human",
        }) + "\n## Resolution\n\nDone.\n",
      "graph/02-next.md": task({
        id: "graph-02",
        title: "Next",
        blockedBy: ["graph-01"],
      }),
    });
    expect(report.status).toBe("pass");
    expect(report.frontier).toEqual(["graph-02"]);
    expect(report.records).toHaveLength(2);
  });

  it("preserves literal inline Markdown in matching titles", () => {
    const report = inspectIssueTree({
      "parser/01-inline-title.md": task({
        id: "parser-01",
        title: "Use `git push` and **review**",
      }),
    });
    expect(report.status).toBe("pass");
    expect(report.records[0]?.title).toBe("Use `git push` and **review**");
  });

  it("does not accept required headings inside a fenced code example", () => {
    const document = task({ id: "parser-01", title: "Example" });
    const report = inspectIssueTree({
      "parser/01-example.md": document.replace(
        "## Verification\n\n- [ ] Run the focused check.",
        "```markdown\n## Verification\n\n- [ ] Run the focused check.\n```",
      ),
      "parser/02-valid.md": task({ id: "parser-02", title: "Valid" }),
    });
    expect(report.diagnostics).toEqual([
      {
        path: "parser/01-example.md",
        code: "missing-section",
        detail: "missing required section ## Verification",
      },
    ]);
    expect(report.records).toEqual([]);
  });

  it("reports duplicate, self and cyclic blockers without a partial projection", () => {
    const report = inspectIssueTree({
      "graph/01-first.md": task({
        id: "graph-01",
        title: "First",
        blockedBy: ["graph-02", "graph-01"],
      }),
      "graph/01-duplicate.md": task({
        id: "graph-01",
        title: "Duplicate",
        blockedBy: ["graph-02"],
      }),
      "graph/02-second.md": task({
        id: "graph-02",
        title: "Second",
        blockedBy: ["graph-01", "missing-01"],
      }),
    });
    expect(report.status).toBe("fail");
    expect(report.records).toEqual([]);
    expect(report.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "duplicate-id",
        "self-blocker",
        "blocker-cycle",
        "unknown-blocker",
      ]),
    );
  });

  it("validates a long dependency chain without recursive stack exhaustion", () => {
    const count = 6000;
    const files = Object.fromEntries(
      Array.from({ length: count }, (_, index) => {
        const effort = `chain-${String(index).padStart(4, "0")}`;
        const next = `chain-${String(index + 1).padStart(4, "0")}-01`;
        return [
          `${effort}/01-task.md`,
          task({
            id: `${effort}-01`,
            title: "Chain task",
            blockedBy: index + 1 === count ? [] : [next],
          }),
        ];
      }),
    );
    const report = inspectIssueTree(files);
    expect(report.status).toBe("pass");
    expect(report.records).toHaveLength(count);
    expect(report.frontier).toEqual(["chain-5999-01"]);
  }, 30_000);
});

describe("assignee requirements across triage states", () => {
  it.each([
    ["needs-triage", true, false],
    ["needs-info", true, false],
    ["ready-for-agent", true, false],
    ["ready-for-human", true, false],
    ["in-progress", false, true],
    ["resolved", true, true],
    ["wontfix", true, true],
  ])(
    "preserves null and assigned cases for %s",
    (status, unassigned, assigned) => {
      for (const assignee of [null, "human"]) {
        const report = inspectIssueTree({
          "triage/01-assign.md":
            task({ id: "triage-01", title: "Assign", status, assignee }) +
            "\n## Resolution\n\nDone.\n",
        });
        expect(report.status).toBe(
          (assignee === null ? unassigned : assigned) ? "pass" : "fail",
        );
      }
    },
  );
});

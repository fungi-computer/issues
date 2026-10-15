import assert from "node:assert/strict";
import { inspectIssueTree } from "@fungi.computer/issues";
const report = inspectIssueTree({});
assert.deepEqual(report.records, []);
assert.deepEqual(report.diagnostics, []);

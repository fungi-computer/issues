import { inspectIssueTree } from "@fungi.computer/issues";

const { records, diagnostics } = inspectIssueTree({});
console.log({ records, diagnostics });

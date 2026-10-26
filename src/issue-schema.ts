import type { Schema } from "@cfworker/json-schema";

const issueFrontmatterSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://fungi.computer/schemas/local-issue-frontmatter-v1.json",
  title: "Botanical local issue frontmatter",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "title",
    "type",
    "status",
    "priority",
    "created",
    "assignee",
    "areas",
    "blocked_by",
  ],
  properties: {
    reachable: { type: "boolean" },
    id: {
      type: "string",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{2}[a-z]?$",
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 160,
    },
    type: {
      enum: ["bug", "enhancement", "task", "research", "prototype", "decision"],
    },
    status: {
      enum: [
        "needs-triage",
        "needs-info",
        "ready-for-agent",
        "ready-for-human",
        "in-progress",
        "resolved",
        "wontfix",
      ],
    },
    priority: {
      enum: ["p0", "p1", "p2", "p3"],
    },
    created: {
      type: "string",
      pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    },
    assignee: {
      oneOf: [
        { type: "null" },
        { type: "string", minLength: 1, maxLength: 100 },
      ],
    },
    areas: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      },
    },
    blocked_by: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{2}[a-z]?$",
      },
    },
  },
  allOf: [
    {
      anyOf: [
        { not: { properties: { status: { const: "in-progress" } } } },
        { properties: { assignee: { type: "string" } } },
      ],
    },
    {
      anyOf: [
        {
          not: {
            properties: {
              status: {
                enum: [
                  "needs-triage",
                  "needs-info",
                  "ready-for-agent",
                  "ready-for-human",
                ],
              },
            },
          },
        },
        { properties: { assignee: { type: "null" } } },
      ],
    },
  ],
} satisfies Schema;

export default issueFrontmatterSchema;

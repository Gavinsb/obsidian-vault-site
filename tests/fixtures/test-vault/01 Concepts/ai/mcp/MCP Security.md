---
type: concept
status: draft
created: 2026-03-15
updated: 2026-09-10
tags:
  - ai/mcp
  - security
aliases:
  - MCP
---

# MCP Security

## Nested tag demo

This note uses `#ai/mcp` and references [[Agent Architecture]].

## Oversight

> [!warning] Be careful
> Never run untrusted MCP servers with full filesystem access.

## Code

```ts
const server = new McpServer({ name: 'x' });
server.capabilities = ['tools'];
```

## Broken links

This points to [[A Note That Does Not Exist]] so QA can verify broken-link detection.
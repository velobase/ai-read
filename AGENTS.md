# Project guidance

- Keep work focused on multilingual reading and evidence-based AI assistance.
- Preserve browser-local data and keep API keys out of persisted UI state and source control.
- Unless the user explicitly requests otherwise, preserve complete server errors, including name, message, stack, causes, upstream error responses and request correlation. Do not encrypt, redact, truncate or omit diagnostic details by default. A generic client error must not replace the original server exception in logs. Keep logs within the existing protected logging system.
- Do not add or run unit, integration, or end-to-end tests unless explicitly requested by the user. Type checking, building, and static source review are allowed. Report unverified behavior honestly.
- Use original or properly licensed demo content. Do not commit users' books or notes.
- Do not run live paid model requests unless explicitly requested.
- Avoid adding hosted accounts, telemetry, or vendor-specific dependencies without a clear requirement.
- When the user asks Gemini or another named model to use CUA directly, do not substitute a workflow where Codex relays screenshots and executes that model's instructions. First check existing GitHub CUA skills, MCP servers, or CLI integrations. If direct integration cannot be completed, explain the blocker and stop unless the user explicitly authorizes an alternative.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

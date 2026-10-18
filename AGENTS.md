# Project guidance

- Keep work focused on multilingual reading and evidence-based AI assistance.
- Preserve browser-local data and keep API keys out of persisted UI state and source control.
- Do not add or run unit, integration, or end-to-end tests unless explicitly requested by the user. Type checking, building, and static source review are allowed. Report unverified behavior honestly.
- Use original or properly licensed demo content. Do not commit users' books or notes.
- Do not run live paid model requests unless explicitly requested.
- Avoid adding hosted accounts, telemetry, or vendor-specific dependencies without a clear requirement.
- When the user asks Gemini or another named model to use CUA directly, do not substitute a workflow where Codex relays screenshots and executes that model's instructions. First check existing GitHub CUA skills, MCP servers, or CLI integrations. If direct integration cannot be completed, explain the blocker and stop unless the user explicitly authorizes an alternative.

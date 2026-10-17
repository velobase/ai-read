# Security

AI Read v0.1 is a personal, loopback-only application. It does not provide hosted user authentication or tenant isolation. Do not expose the local proxy directly to the public internet.

Book and model content are treated as untrusted text. API keys entered in the UI are not persisted; server keys are loaded from an ignored `.env` file and bound to the configured provider endpoint.

If you find a vulnerability, use the repository's private vulnerability reporting feature if available. Do not post keys, private book content, or exploit details in a public issue. If private reporting is unavailable, open a minimal issue requesting a private reporting channel without including the sensitive details.

The project is an alpha and has not undergone a security audit. Report the affected version, the component involved, and the impact without sharing real credentials.

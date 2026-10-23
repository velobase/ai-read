# Persistent book translation

Opening a book creates or resumes an account-owned background translation task for the reader’s target language. Web and iOS use the same server task and show its saved progress. Original, Bilingual and Translation only are display choices: switching modes, turning pages, closing a browser tab or backgrounding the app never cancels the task. Equivalent source and target languages need no translation.

## Reading flow

```text
Open book → ensure the existing task → show saved text and overall progress
  ├─ Turn page → update priority of pending content; in-flight work continues
  ├─ Leave → worker continues and saves results
  └─ Return → restore reading position; fetch current results and progress
Complete → hide the progress indicator
```

There is no preparation page, start/pause button, or current-page/whole-book choice. Completed paragraphs become readable while the rest of the book is still translating. Existing layout anchoring and exact note/bookmark references remain in use. A retry action is shown only for a failed task. Offline readers retain locally saved text; reconnecting refreshes server progress.

## Ownership and persistence

`POST /api/translations` ensures or retries a task using the authenticated account, canonical book source and target language. Reopening the same source/language reuses its task. `GET /api/translations` supplies progress and complete paragraph results, including those in a partially finished chapter. The API’s response connection does not own execution.

The worker uses the existing PostgreSQL translation edition/chapter records, leases and checkpoints. It batches short paragraphs, checkpoints long paragraphs and publishes only complete paragraphs. Progress counts completed paragraphs across the whole book. A server restart recovers unfinished work after lease expiry. Claims and writes are fenced so overlapping workers cannot publish conflicting results. Transient failures receive bounded retries, with persistent failures exposed for explicit retry.

The platform supplies model credentials. Request content, results, durations and complete exceptions are recorded in protected server logs with task/chapter/request correlation. Credentials do not enter client state or log payloads.

Existing books, translation results, note references, reading positions and local recovery data remain intact. Client-side generation queues and streaming translation endpoints are removed. Local stores now serve saved reading content rather than executing translation work.

## Verification boundary

Type checking and production compilation can validate the implementation without calling the paid model. End-to-end reading, device backgrounding and actual provider output require user verification. Historical release notes describe the earlier implementation and are not evidence for this rewrite.

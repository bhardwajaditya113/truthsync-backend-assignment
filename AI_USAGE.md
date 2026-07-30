# AI usage disclosure

AI assistant: OpenAI Codex / ChatGPT.

Used for:

- translating the assignment into explicit correctness invariants;
- reviewing the multi-source sync and cursor-recovery design;
- implementing TypeScript adapters, SQL, tests, and documentation;
- checking edge cases such as replay, stale cursors, partial source failure, unknown statuses, refunds, currency separation, and half-open time ranges.

Human review performed:

- inspected all generated source and migration files;
- ran strict TypeScript compilation;
- ran the complete automated test suite;
- ran the deterministic failure demonstration;
- validated real provider records, an immediate incremental replay, hosted-database reconciliation,
  and both live metrics endpoints before submission.

Sanitized conversation export: [AI_CHAT_EXPORT.md](https://github.com/bhardwajaditya113/truthsync-backend-assignment/blob/main/AI_CHAT_EXPORT.md).

The export contains the chronological user-visible conversation used to build and verify this
submission. Credentials, authorization URLs and codes, personal/account identifiers, and local
filesystem paths are replaced with explicit redaction markers; hidden instructions, internal
reasoning, and tool payloads are not part of the user-visible conversation and are not included.

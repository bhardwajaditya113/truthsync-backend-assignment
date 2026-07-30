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

Conversation/export link: `TBD — paste the shared ChatGPT/Codex conversation URL here before submitting.`

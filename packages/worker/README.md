# @aznex/worker

Local long-running background worker that runs on each developer's machine.

Receives lifecycle hook payloads from a coding agent (Claude Code, Codex, etc.), compresses raw tool output into structured observations, runs LLM extraction to distill durable learnings, performs client-side secret scrubbing, and POSTs the processed memory to the Aznex service.

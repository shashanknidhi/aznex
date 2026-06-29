# @aznex/service

The single remote deployable. Exposes three surfaces over one shared auth/permission module:

- **`POST /v1/ingest`** — accepts memory writes from workers (verifies repo access, runs authoritative secret re-scan, persists to DB)
- **MCP endpoint** — serves `search_memory` and `get_recent_context` to any coding agent
- **Frontend API** — read/query endpoints for the browser UI

This is the only component that holds database credentials.

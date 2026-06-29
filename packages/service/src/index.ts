// @aznex/service — single deployable service
// Exposes two route groups over one shared auth/permission module:
//   POST /v1/ingest   — ingestion endpoint (workers POST here)
//   /mcp              — MCP endpoint (agents query here)
//   /api              — frontend read/query API
// This is the only tier with database credentials.
export {};

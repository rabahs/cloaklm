// Validates mcp/manifest.json against the MCPB v0.3 manifest schema (copied from
// @anthropic-ai/mcpb), so the build doesn't need that CLI and its dependencies.
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(read("./manifest.schema.json"));
if (!validate(read("./manifest.json"))) {
  console.error("mcp/manifest.json is invalid:", validate.errors);
  process.exit(1);
}

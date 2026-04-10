# openapi-mcp-server

Universal OpenAPI/Swagger MCP server. Bun + TypeScript.

## Commands

- `bun run build` — build to dist/
- `bun run compile` — native binary
- `bun run typecheck` — tsc --noEmit
- `bun run lint` — Biome check
- `bun run lint:fix` — Biome autofix
- `bun run test` — bun test (src/*.test.ts)

## Transports

- `--transport stdio` (default) — standard MCP stdio
- `--transport http --port 3000` — Streamable HTTP via Bun.serve

## Rules

- Conventional commits: feat/fix/chore
- Biome 2.x — do not disable rules
- No `any` — use `unknown` + type narrowing
- bun.lock is gitignored, do not commit
- .serena/ and .claude/ are gitignored
- CI (release.yml) triggers only on release events, push to main is safe
- Run `bun test && bunx tsc --noEmit && bunx biome check src/` before committing

# openapi-mcp-server

Universal OpenAPI/Swagger MCP server. Bun + TypeScript.

## Commands

- `bun run build` — build to dist/
- `bun run compile` — native binary
- `bun run typecheck` — tsc --noEmit
- `bun run lint` — Biome check
- `bun run lint:fix` — Biome autofix
- `bun run test` — bun test

## Rules

- Conventional commits: feat/fix/chore
- Biome 2.x — do not disable rules
- No `any` — use `unknown` + type narrowing
- bun.lock is gitignored, do not commit
- .serena/ and .claude/ are gitignored
- CI (release.yml) triggers only on release events, push to main is safe

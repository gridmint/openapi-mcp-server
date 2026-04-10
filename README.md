# openapi-mcp-server

Universal OpenAPI/Swagger → MCP server. **3 meta-tools instead of 300+** — keeps your LLM context clean.

Works with any API that has an OpenAPI 3.x or Swagger 2.0 spec.

## Why?

Existing solutions either:
- Generate 300+ MCP tools from a single spec (destroys LLM context)
- Don't actually call the API (read-only)
- Crash on recursive `$ref` or Swagger 2.0
- Require Python/Docker/Go runtime

This server gives you **3 tools** that let the LLM explore and call any API:
| Tool | Purpose |
|------|---------|
| `list_endpoints` | Browse endpoints with filters (by path, method, tag) |
| `get_schema` | Get detailed params, request body, and response schema |
| `invoke` | Make real HTTP calls with auth |

## Quick Start

### Download binary (zero deps, single file)

Download from [Releases](https://github.com/gridmint/openapi-mcp-server/releases):

| Platform | Binary |
|----------|--------|
| Linux x64 | `openapi-mcp-linux-x64` |
| Linux ARM64 | `openapi-mcp-linux-arm64` |
| macOS x64 | `openapi-mcp-darwin-x64` |
| macOS ARM64 (Apple Silicon) | `openapi-mcp-darwin-arm64` |
| Windows x64 | `openapi-mcp-windows-x64.exe` |

```bash
# Download the binary for your platform (replace the filename as needed)
# Linux x64:
curl -L -o openapi-mcp https://github.com/gridmint/openapi-mcp-server/releases/latest/download/openapi-mcp-linux-x64
# macOS Apple Silicon:
# curl -L -o openapi-mcp https://github.com/gridmint/openapi-mcp-server/releases/latest/download/openapi-mcp-darwin-arm64

chmod +x openapi-mcp
./openapi-mcp --spec https://petstore3.swagger.io/api/v3/openapi.json
```

### Build from source

```bash
git clone https://github.com/gridmint/openapi-mcp-server.git
cd openapi-mcp-server
bun install && bun run compile
./openapi-mcp --spec https://gitea.example.com/swagger.v1.json --auth bearer:TOKEN
```

## Usage with Claude Desktop

```json
{
  "mcpServers": {
    "petstore": {
      "command": "/path/to/openapi-mcp",
      "args": [
        "--spec", "https://petstore3.swagger.io/api/v3/openapi.json"
      ]
    }
  }
}
```

### With authentication

```json
{
  "mcpServers": {
    "gitea": {
      "command": "/path/to/openapi-mcp",
      "args": [
        "--spec", "https://gitea.example.com/swagger.v1.json",
        "--base-url", "https://gitea.example.com/api/v1",
        "--auth", "bearer:YOUR_TOKEN"
      ]
    }
  }
}
```

### With endpoint filtering

```json
{
  "mcpServers": {
    "gitea-repos": {
      "command": "/path/to/openapi-mcp",
      "args": [
        "--spec", "https://gitea.example.com/swagger.v1.json",
        "--auth", "bearer:YOUR_TOKEN",
        "--include", "repos/*",
        "--exclude", "admin/*"
      ]
    }
  }
}
```

## CLI Options

```
openapi-mcp --spec <url-or-path> [options]

Options:
  --spec <url|path>      OpenAPI 3.x or Swagger 2.0 spec, JSON or YAML (required)
  --base-url <url>       Override API base URL from spec
  --auth <credentials>   Authentication (see below)
  --include <pattern>    Include only matching paths (glob, repeatable)
  --exclude <pattern>    Exclude matching paths (glob, repeatable)
  --page-size <n>        Endpoints per page (default: 20)
  --transport <type>     Transport: stdio (default) or http
  --port <n>             HTTP port (default: 3000, only with --transport http)
```

### Authentication formats

```
--auth bearer:TOKEN
--auth basic:username:password
--auth apikey:header:X-API-Key:your-key
--auth apikey:query:api_key:your-key
```

### Environment variables

```bash
OPENAPI_SPEC_URL=https://api.example.com/openapi.json
OPENAPI_BASE_URL=https://api.example.com/v1
OPENAPI_AUTH=bearer:your-token
```

### HTTP transport

For web-based MCP clients, use the HTTP transport:

```bash
openapi-mcp --spec https://petstore3.swagger.io/api/v3/openapi.json --transport http --port 8080
# MCP server started on http://localhost:8080/mcp
```

## Features

- ✅ **3 meta-tools** — `list_endpoints`, `get_schema`, `invoke`
- ✅ **Swagger 2.0 + OpenAPI 3.x** — auto-detected
- ✅ **JSON + YAML specs** — detected by content, not file extension
- ✅ **Recursive `$ref` resolution** — with cycle detection (no crashes)
- ✅ **Real HTTP calls** — not just spec reading
- ✅ **Bearer / Basic / API Key** auth (header and query)
- ✅ **Endpoint filtering** — `--include` / `--exclude` with glob patterns
- ✅ **Pagination** — large APIs stay manageable
- ✅ **Single binary** — `bun build --compile` (zero runtime deps)
- ✅ **stdio + HTTP transports** — standard MCP protocol

## How It Works

Instead of creating one MCP tool per API endpoint (which can flood the LLM with 300+ tools), this server exposes just 3 tools:

1. **LLM calls `list_endpoints`** → sees available endpoints, filters by tag/method/path
2. **LLM calls `get_schema`** → reads parameters, request body, response format
3. **LLM calls `invoke`** → makes the actual API call

This keeps the tool list tiny while giving full API access.

## Development

```bash
bun install
bun run dev --spec ./my-spec.json    # Watch mode
bun run build                         # Build to dist/
bun run compile                       # Compile to single binary
bun run lint                          # Biome lint
bun test                              # Run tests
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript
- **Linter/Formatter:** [Biome](https://biomejs.dev)
- **MCP SDK:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT

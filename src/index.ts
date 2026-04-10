#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json";
import { parseAuthString } from "./http.js";
import { parseSpec } from "./parser.js";
import { getSchema, globToRegex, invoke, listEndpoints } from "./tools.js";
import type { ParsedSpec, ServerConfig } from "./types.js";

// === CLI argument parsing ===
function parseArgs(): ServerConfig {
	const args = process.argv.slice(2);
	const config: Partial<ServerConfig> = { pageSize: 20, transport: "stdio", port: 3000 };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];

		switch (arg) {
			case "--spec":
				config.specUrl = next;
				i++;
				break;
			case "--base-url":
				config.baseUrl = next;
				i++;
				break;
			case "--auth":
				config.auth = parseAuthString(next);
				i++;
				break;
			case "--include":
				config.include = config.include ?? [];
				config.include.push(next);
				i++;
				break;
			case "--exclude":
				config.exclude = config.exclude ?? [];
				config.exclude.push(next);
				i++;
				break;
			case "--page-size":
				config.pageSize = Number.parseInt(next, 10);
				i++;
				break;
			case "--transport":
				config.transport = next as "stdio" | "http";
				i++;
				break;
			case "--port":
				config.port = Number.parseInt(next, 10);
				i++;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				if (!arg.startsWith("--") && !config.specUrl) {
					config.specUrl = arg;
				}
		}
	}

	// Also check env vars
	if (!config.specUrl) config.specUrl = process.env.OPENAPI_SPEC_URL;
	if (!config.baseUrl) config.baseUrl = process.env.OPENAPI_BASE_URL;
	if (!config.auth && process.env.OPENAPI_AUTH)
		config.auth = parseAuthString(process.env.OPENAPI_AUTH);

	if (!config.specUrl) {
		console.error("Error: --spec <url-or-path> is required\n");
		printUsage();
		process.exit(1);
	}

	return config as ServerConfig;
}

function printUsage(): void {
	console.error(`openapi-mcp — Universal OpenAPI/Swagger MCP Server

Usage:
  openapi-mcp --spec <url-or-path> [options]

Options:
  --spec <url|path>      OpenAPI 3.x or Swagger 2.0 spec (required)
  --base-url <url>       Override API base URL from spec
  --auth <credentials>   Auth: bearer:TOKEN, basic:user:pass, apikey:header:Name:Value
  --include <pattern>    Include only matching endpoints (glob, repeatable)
  --exclude <pattern>    Exclude matching endpoints (glob, repeatable)
  --page-size <n>        Endpoints per page in list_endpoints (default: 20)
  --transport <type>     Transport: stdio (default) or http
  --port <n>             HTTP port (default: 3000, only with --transport http)
  -h, --help             Show this help

Environment variables:
  OPENAPI_SPEC_URL       Same as --spec
  OPENAPI_BASE_URL       Same as --base-url
  OPENAPI_AUTH           Same as --auth

Examples:
  openapi-mcp --spec https://petstore3.swagger.io/api/v3/openapi.json
  openapi-mcp --spec ./swagger.json --base-url http://localhost:3000/api --auth bearer:mytoken
  openapi-mcp --spec https://api.example.com/openapi.json --transport http --port 8080
`);
}

// === Main ===
async function main(): Promise<void> {
	const config = parseArgs();

	// Load and parse spec
	console.error(`Loading spec from ${config.specUrl}...`);
	const spec = await parseSpec(config.specUrl, config.baseUrl);

	// Apply include/exclude filters
	if (config.include?.length) {
		const patterns = config.include.map((p) => globToRegex(p));
		spec.endpoints = spec.endpoints.filter((ep) => patterns.some((re) => re.test(ep.path)));
	}
	if (config.exclude?.length) {
		const patterns = config.exclude.map((p) => globToRegex(p));
		spec.endpoints = spec.endpoints.filter((ep) => !patterns.some((re) => re.test(ep.path)));
	}

	console.error(`Loaded ${spec.title} v${spec.version}: ${spec.endpoints.length} endpoints`);

	// Start server with selected transport
	if (config.transport === "http") {
		await startHttpTransport(spec, config);
	} else {
		const mcpServer = createMcpServer(spec, config);
		const transport = new StdioServerTransport();
		await mcpServer.connect(transport);
		console.error("MCP server started on stdio");
	}
}

function createMcpServer(spec: ParsedSpec, config: ServerConfig): McpServer {
	const mcpServer = new McpServer(
		{ name: `openapi-mcp: ${spec.title}`, version: pkg.version },
		{ capabilities: { tools: {} } },
	);

	mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "list_endpoints",
				description: `List available API endpoints from ${spec.title}. Returns paginated list with method, path, and summary. Use filters to narrow down.`,
				inputSchema: {
					type: "object" as const,
					properties: {
						filter: {
							type: "string",
							description:
								"Filter by path, summary, or operationId (glob pattern, e.g. 'repos/*', '*issue*')",
						},
						method: {
							type: "string",
							description: "Filter by HTTP method (GET, POST, PUT, DELETE, etc.)",
						},
						tag: {
							type: "string",
							description: `Filter by API tag. Available: ${spec.tags.join(", ")}`,
						},
						page: {
							type: "number",
							description: "Page number (default: 1)",
						},
					},
				},
			},
			{
				name: "get_schema",
				description:
					"Get detailed schema for a specific API endpoint — parameters, request body, responses.",
				inputSchema: {
					type: "object" as const,
					properties: {
						method: {
							type: "string",
							description: "HTTP method (GET, POST, PUT, DELETE, etc.)",
						},
						path: {
							type: "string",
							description: "Endpoint path (e.g. /repos/{owner}/{repo})",
						},
					},
					required: ["method", "path"],
				},
			},
			{
				name: "invoke",
				description: `Call an API endpoint on ${spec.title}. Makes a real HTTP request with configured auth.`,
				inputSchema: {
					type: "object" as const,
					properties: {
						method: {
							type: "string",
							description: "HTTP method (GET, POST, PUT, DELETE, etc.)",
						},
						path: {
							type: "string",
							description: "Endpoint path (e.g. /repos/{owner}/{repo})",
						},
						path_params: {
							type: "object",
							description:
								"Path parameters as key-value pairs (e.g. {owner: 'overpod', repo: 'mcp-telegram'})",
							additionalProperties: { type: "string" },
						},
						query_params: {
							type: "object",
							description: "Query parameters as key-value pairs",
							additionalProperties: { type: "string" },
						},
						headers: {
							type: "object",
							description: "Additional HTTP headers",
							additionalProperties: { type: "string" },
						},
						body: {
							description: "Request body (for POST/PUT/PATCH)",
						},
					},
					required: ["method", "path"],
				},
			},
		],
	}));

	mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		try {
			let result: string;
			const a = (args ?? {}) as Record<string, unknown>;

			switch (name) {
				case "list_endpoints":
					result = listEndpoints(
						spec,
						a as { filter?: string; method?: string; tag?: string; page?: number },
						config.pageSize,
					);
					break;

				case "get_schema":
					if (typeof a.method !== "string" || typeof a.path !== "string") {
						return {
							content: [{ type: "text", text: "Error: method and path are required strings" }],
							isError: true,
						};
					}
					result = getSchema(spec, { method: a.method, path: a.path });
					break;

				case "invoke":
					if (typeof a.method !== "string" || typeof a.path !== "string") {
						return {
							content: [{ type: "text", text: "Error: method and path are required strings" }],
							isError: true,
						};
					}
					result = await invoke(spec, config, {
						method: a.method,
						path: a.path,
						path_params: a.path_params as Record<string, string> | undefined,
						query_params: a.query_params as Record<string, string> | undefined,
						headers: a.headers as Record<string, string> | undefined,
						body: a.body,
					});
					break;

				default:
					result = `Unknown tool: ${name}`;
			}

			return { content: [{ type: "text", text: result }] };
		} catch (err) {
			return {
				content: [
					{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
				],
				isError: true,
			};
		}
	});

	return mcpServer;
}

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface HttpSession {
	transport: InstanceType<
		typeof import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js").WebStandardStreamableHTTPServerTransport
	>;
	timer: ReturnType<typeof setTimeout>;
}

async function startHttpTransport(spec: ParsedSpec, config: ServerConfig): Promise<void> {
	const { WebStandardStreamableHTTPServerTransport } = await import(
		"@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
	);

	const sessions = new Map<string, HttpSession>();

	function removeSession(id: string): void {
		const session = sessions.get(id);
		if (session) {
			clearTimeout(session.timer);
			sessions.delete(id);
		}
	}

	Bun.serve({
		port: config.port,
		fetch: async (req) => {
			const url = new URL(req.url);
			if (url.pathname !== "/mcp") {
				return new Response("Not Found", { status: 404 });
			}

			// Existing session
			const sessionId = req.headers.get("mcp-session-id");
			const existing = sessionId ? sessions.get(sessionId) : undefined;
			if (sessionId && existing) {
				// Reset TTL on activity
				clearTimeout(existing.timer);
				existing.timer = setTimeout(() => removeSession(sessionId), SESSION_TTL_MS);
				return existing.transport.handleRequest(req);
			}

			// New session — create transport + server
			if (req.method === "POST" && !sessionId) {
				// Evict oldest session if at limit
				if (sessions.size >= MAX_SESSIONS) {
					const oldestId = sessions.keys().next().value;
					if (oldestId) removeSession(oldestId);
				}

				const transport = new WebStandardStreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
				});
				const mcpServer = createMcpServer(spec, config);
				await mcpServer.connect(transport);

				const response = await transport.handleRequest(req);
				const newId = response.headers.get("mcp-session-id");
				if (newId) {
					const timer = setTimeout(() => removeSession(newId), SESSION_TTL_MS);
					sessions.set(newId, { transport, timer });
					transport.onclose = () => removeSession(newId);
				}
				return response;
			}

			return new Response("Bad Request", { status: 400 });
		},
	});

	console.error(`MCP server started on http://localhost:${config.port}/mcp`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

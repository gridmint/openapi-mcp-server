import type { Endpoint, ParsedSpec, ServerConfig } from "./types.js";
import { invokeEndpoint } from "./http.js";

/**
 * list_endpoints — browse available API endpoints with optional filtering.
 */
export function listEndpoints(
	spec: ParsedSpec,
	args: { filter?: string; method?: string; tag?: string; page?: number },
	pageSize: number,
): string {
	let endpoints = spec.endpoints;

	// Filter by method
	if (args.method) {
		const m = args.method.toUpperCase();
		endpoints = endpoints.filter((e) => e.method === m);
	}

	// Filter by tag
	if (args.tag) {
		const t = args.tag.toLowerCase();
		endpoints = endpoints.filter((e) => e.tags.some((tag) => tag.toLowerCase() === t));
	}

	// Filter by path/summary pattern (glob-like)
	if (args.filter) {
		const pattern = args.filter.toLowerCase();
		const regex = globToRegex(pattern);
		endpoints = endpoints.filter(
			(e) =>
				regex.test(e.path.toLowerCase()) ||
				(e.summary && regex.test(e.summary.toLowerCase())) ||
				(e.operationId && regex.test(e.operationId.toLowerCase())),
		);
	}

	if (endpoints.length === 0) {
		return "No endpoints found matching the filter criteria.";
	}

	const page = Math.max(1, args.page ?? 1);
	const totalPages = Math.ceil(endpoints.length / pageSize);
	const start = (page - 1) * pageSize;
	const pageEndpoints = endpoints.slice(start, start + pageSize);

	const lines: string[] = [];
	lines.push(`${spec.title} v${spec.version} — ${endpoints.length} endpoints`);
	if (spec.tags.length > 0) {
		lines.push(`Tags: ${spec.tags.join(", ")}`);
	}
	lines.push("");

	const methodPad = 7;
	for (const ep of pageEndpoints) {
		const method = ep.method.padEnd(methodPad);
		const deprecated = ep.deprecated ? " ⚠️ DEPRECATED" : "";
		const summary = ep.summary ? ` — ${ep.summary}` : "";
		lines.push(`${method} ${ep.path}${summary}${deprecated}`);
	}

	if (totalPages > 1) {
		lines.push("");
		lines.push(`Page ${page}/${totalPages}. Use page=${page + 1} for more.`);
	}

	lines.push("");
	lines.push('Use get_schema(method, path) for endpoint details, then invoke(method, path, ...) to call it.');

	return lines.join("\n");
}

/**
 * get_schema — detailed info for a specific endpoint.
 */
export function getSchema(spec: ParsedSpec, args: { method: string; path: string }): string {
	const method = args.method.toUpperCase();
	const endpoint = spec.endpoints.find((e) => e.method === method && e.path === args.path);

	if (!endpoint) {
		// Try fuzzy match
		const similar = spec.endpoints.filter(
			(e) => e.path === args.path || (e.method === method && e.path.includes(args.path)),
		);
		if (similar.length > 0) {
			return `Endpoint not found: ${method} ${args.path}\n\nDid you mean:\n${similar
				.slice(0, 5)
				.map((e) => `  ${e.method} ${e.path}`)
				.join("\n")}`;
		}
		return `Endpoint not found: ${method} ${args.path}`;
	}

	return formatEndpointSchema(endpoint);
}

function formatEndpointSchema(ep: Endpoint): string {
	const lines: string[] = [];

	lines.push(`${ep.method} ${ep.path}`);
	if (ep.deprecated) lines.push("⚠️ DEPRECATED");
	if (ep.summary) lines.push(`Summary: ${ep.summary}`);
	if (ep.description) lines.push(`\n${ep.description}`);
	if (ep.operationId) lines.push(`Operation ID: ${ep.operationId}`);
	if (ep.tags.length > 0) lines.push(`Tags: ${ep.tags.join(", ")}`);

	// Parameters by location
	const byLocation = new Map<string, typeof ep.parameters>();
	for (const p of ep.parameters) {
		const existing = byLocation.get(p.in) ?? [];
		existing.push(p);
		byLocation.set(p.in, existing);
	}

	for (const [location, params] of byLocation) {
		lines.push(`\n${capitalize(location)} Parameters:`);
		for (const p of params) {
			const req = p.required ? " (required)" : "";
			const type = p.schema ? ` [${schemaToTypeString(p.schema)}]` : "";
			const desc = p.description ? ` — ${p.description}` : "";
			lines.push(`  ${p.name}${type}${req}${desc}`);
		}
	}

	// Request body
	if (ep.requestBody) {
		lines.push(`\nRequest Body (${ep.requestBody.contentType})${ep.requestBody.required ? " — required" : ""}:`);
		if (ep.requestBody.description) lines.push(`  ${ep.requestBody.description}`);
		if (ep.requestBody.schema) {
			lines.push(formatSchema(ep.requestBody.schema, 2));
		}
	}

	// Responses
	const responseCodes = Object.keys(ep.responses);
	if (responseCodes.length > 0) {
		lines.push("\nResponses:");
		for (const code of responseCodes) {
			const resp = ep.responses[code];
			lines.push(`  ${code}: ${resp.description ?? ""}`);
			if (resp.schema) {
				lines.push(formatSchema(resp.schema, 4));
			}
		}
	}

	lines.push(`\nUsage: invoke(method="${ep.method}", path="${ep.path}"${ep.parameters.length > 0 ? ", ..." : ""})`);

	return lines.join("\n");
}

/**
 * invoke — call an API endpoint.
 */
export async function invoke(
	spec: ParsedSpec,
	config: ServerConfig,
	args: {
		method: string;
		path: string;
		path_params?: Record<string, string>;
		query_params?: Record<string, string>;
		headers?: Record<string, string>;
		body?: unknown;
	},
): Promise<string> {
	const method = args.method.toUpperCase();
	const endpoint = spec.endpoints.find((e) => e.method === method && e.path === args.path);

	if (!endpoint) {
		return `Endpoint not found: ${method} ${args.path}. Use list_endpoints to find available endpoints.`;
	}

	// Validate required path params
	const pathParamNames = endpoint.parameters.filter((p) => p.in === "path").map((p) => p.name);
	for (const name of pathParamNames) {
		if (!args.path_params?.[name]) {
			return `Missing required path parameter: ${name}`;
		}
	}

	try {
		const result = await invokeEndpoint({
			baseUrl: config.baseUrl ?? spec.baseUrl,
			method,
			path: args.path,
			pathParams: args.path_params,
			queryParams: args.query_params,
			headers: args.headers,
			body: args.body,
			auth: config.auth,
		});

		const lines: string[] = [];
		lines.push(`${result.status} ${result.statusText}`);

		if (typeof result.body === "object" && result.body !== null) {
			const json = JSON.stringify(result.body, null, 2);
			// Truncate very large responses for LLM context
			if (json.length > 30000) {
				lines.push(`${json.slice(0, 30000)}\n\n... [truncated, ${json.length} chars total]`);
			} else {
				lines.push(json);
			}
		} else {
			lines.push(String(result.body));
		}

		return lines.join("\n");
	} catch (err) {
		return `Error calling ${method} ${args.path}: ${err instanceof Error ? err.message : String(err)}`;
	}
}

// === Helpers ===

function globToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(escaped);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function schemaToTypeString(schema: Record<string, unknown>): string {
	if (schema.type === "array" && schema.items) {
		return `array<${schemaToTypeString(schema.items as Record<string, unknown>)}>`;
	}
	if (schema.enum) {
		return (schema.enum as unknown[]).map(String).join(" | ");
	}
	const type = schema.type as string | undefined;
	const format = schema.format as string | undefined;
	if (format) return `${type ?? "any"}(${format})`;
	return type ?? "any";
}

function formatSchema(schema: Record<string, unknown>, indent: number, depth = 0): string {
	if (depth > 4) return `${" ".repeat(indent)}{ ... }`;

	const pad = " ".repeat(indent);
	const lines: string[] = [];

	if (schema.type === "object" || schema.properties) {
		const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
		const required = new Set((schema.required as string[]) ?? []);
		for (const [name, prop] of Object.entries(props)) {
			const req = required.has(name) ? " (required)" : "";
			const type = schemaToTypeString(prop);
			const desc = prop.description ? ` — ${prop.description}` : "";
			lines.push(`${pad}${name}: ${type}${req}${desc}`);
			if (prop.type === "object" && prop.properties) {
				lines.push(formatSchema(prop, indent + 2, depth + 1));
			}
		}
	} else if (schema.type === "array" && schema.items) {
		lines.push(`${pad}items: ${schemaToTypeString(schema.items as Record<string, unknown>)}`);
	} else {
		lines.push(`${pad}${schemaToTypeString(schema)}`);
	}

	return lines.join("\n");
}

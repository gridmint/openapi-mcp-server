import type { Endpoint, Parameter, ParsedSpec, RequestBody, ResponseDef, SchemaObject } from "./types.js";

/**
 * Load and parse OpenAPI 3.x or Swagger 2.0 spec from URL or file path.
 * Handles recursive $ref resolution with cycle detection.
 */
export async function parseSpec(specUrl: string, baseUrlOverride?: string): Promise<ParsedSpec> {
	const raw = await loadSpec(specUrl);
	const doc = resolveRefs(raw, raw, new Set());

	const isSwagger2 = doc.swagger?.startsWith("2.");

	const baseUrl = baseUrlOverride ?? extractBaseUrl(doc, specUrl, isSwagger2);
	const title = doc.info?.title ?? "API";
	const version = doc.info?.version ?? "0.0.0";
	const description = doc.info?.description;

	const endpoints: Endpoint[] = [];
	const tagSet = new Set<string>();

	const paths = doc.paths ?? {};
	for (const [path, pathItem] of Object.entries(paths)) {
		if (!pathItem || typeof pathItem !== "object") continue;

		// Path-level parameters (Swagger 2.0 pattern)
		const pathParams = (pathItem as Record<string, unknown>).parameters as unknown[] | undefined;

		for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
			const op = (pathItem as Record<string, unknown>)[method];
			if (!op || typeof op !== "object") continue;

			const operation = op as Record<string, unknown>;
			const endpoint = isSwagger2
				? parseSwagger2Operation(method, path, operation, pathParams)
				: parseOpenApi3Operation(method, path, operation, pathParams);

			for (const tag of endpoint.tags) tagSet.add(tag);
			endpoints.push(endpoint);
		}
	}

	return {
		title,
		version,
		description,
		baseUrl,
		endpoints,
		tags: [...tagSet].sort(),
	};
}

async function loadSpec(specUrl: string): Promise<Record<string, unknown>> {
	if (specUrl.startsWith("http://") || specUrl.startsWith("https://")) {
		const resp = await fetch(specUrl);
		if (!resp.ok) throw new Error(`Failed to fetch spec: ${resp.status} ${resp.statusText}`);
		return (await resp.json()) as Record<string, unknown>;
	}
	// Local file
	const file = Bun.file(specUrl);
	const text = await file.text();
	// Support YAML (basic detection)
	if (specUrl.endsWith(".yaml") || specUrl.endsWith(".yml")) {
		throw new Error("YAML specs not yet supported — convert to JSON or use a JSON URL");
	}
	return JSON.parse(text);
}

/**
 * Recursively resolve $ref pointers in-place.
 * Uses a visited set to break infinite cycles.
 */
function resolveRefs(node: unknown, root: Record<string, unknown>, visited: Set<string>): any {
	if (node === null || node === undefined || typeof node !== "object") return node;

	if (Array.isArray(node)) {
		return node.map((item) => resolveRefs(item, root, visited));
	}

	const obj = node as Record<string, unknown>;
	if (typeof obj.$ref === "string") {
		const ref = obj.$ref;
		if (visited.has(ref)) {
			// Cycle detected — return a stub
			return { type: "object", description: `[circular: ${ref}]` };
		}
		visited.add(ref);
		const resolved = followRef(ref, root);
		const result = resolveRefs(resolved, root, visited);
		visited.delete(ref);
		return result;
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[key] = resolveRefs(value, root, visited);
	}
	return result;
}

function followRef(ref: string, root: Record<string, unknown>): unknown {
	if (!ref.startsWith("#/")) {
		throw new Error(`External $ref not supported: ${ref}`);
	}
	const parts = ref.slice(2).split("/").map(decodeJsonPointer);
	let current: unknown = root;
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") {
			throw new Error(`Cannot resolve $ref ${ref}: path broken at "${part}"`);
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function decodeJsonPointer(s: string): string {
	return s.replace(/~1/g, "/").replace(/~0/g, "~");
}

function extractBaseUrl(doc: Record<string, unknown>, specUrl: string, isSwagger2: boolean): string {
	if (isSwagger2) {
		const host = (doc.host as string) ?? new URL(specUrl).host;
		const basePath = (doc.basePath as string) ?? "/";
		const schemes = (doc.schemes as string[]) ?? ["https"];
		return `${schemes[0]}://${host}${basePath}`.replace(/\/$/, "");
	}
	// OpenAPI 3.x
	const servers = doc.servers as Array<{ url?: string }> | undefined;
	if (servers?.[0]?.url) {
		const url = servers[0].url;
		if (url.startsWith("/")) {
			const origin = new URL(specUrl).origin;
			return `${origin}${url}`.replace(/\/$/, "");
		}
		return url.replace(/\/$/, "");
	}
	return new URL(specUrl).origin;
}

// === Swagger 2.0 normalization ===

function parseSwagger2Operation(
	method: string,
	path: string,
	op: Record<string, unknown>,
	pathParams?: unknown[],
): Endpoint {
	const allParams = [...((pathParams as Record<string, unknown>[]) ?? []), ...((op.parameters as Record<string, unknown>[]) ?? [])];

	const parameters: Parameter[] = [];
	let requestBody: RequestBody | undefined;

	for (const p of allParams) {
		const param = p as Record<string, unknown>;
		if (param.in === "body") {
			requestBody = {
				required: param.required as boolean,
				description: param.description as string,
				contentType: "application/json",
				schema: (param.schema as SchemaObject) ?? undefined,
			};
		} else if (param.in === "formData") {
			// Convert formData to a simplified request body
			if (!requestBody) {
				requestBody = {
					contentType: "application/x-www-form-urlencoded",
					schema: { type: "object", properties: {} },
				};
			}
			const props = (requestBody.schema as Record<string, unknown>).properties as Record<string, unknown>;
			props[param.name as string] = {
				type: param.type,
				description: param.description,
			};
		} else {
			parameters.push({
				name: param.name as string,
				in: param.in as Parameter["in"],
				required: (param.required as boolean) ?? false,
				description: param.description as string | undefined,
				schema: param.type
					? ({ type: param.type, format: param.format, enum: param.enum } as SchemaObject)
					: undefined,
			});
		}
	}

	const responses: Record<string, ResponseDef> = {};
	if (op.responses && typeof op.responses === "object") {
		for (const [code, resp] of Object.entries(op.responses as Record<string, Record<string, unknown>>)) {
			responses[code] = {
				description: resp?.description as string | undefined,
				schema: resp?.schema as SchemaObject | undefined,
			};
		}
	}

	return {
		method: method.toUpperCase(),
		path,
		operationId: op.operationId as string | undefined,
		summary: op.summary as string | undefined,
		description: op.description as string | undefined,
		tags: (op.tags as string[]) ?? [],
		parameters,
		requestBody,
		responses,
		deprecated: op.deprecated as boolean | undefined,
	};
}

// === OpenAPI 3.x normalization ===

function parseOpenApi3Operation(
	method: string,
	path: string,
	op: Record<string, unknown>,
	pathParams?: unknown[],
): Endpoint {
	const rawParams = [...((pathParams as Record<string, unknown>[]) ?? []), ...((op.parameters as Record<string, unknown>[]) ?? [])];

	const parameters: Parameter[] = rawParams.map((p) => {
		const param = p as Record<string, unknown>;
		return {
			name: param.name as string,
			in: param.in as Parameter["in"],
			required: (param.required as boolean) ?? false,
			description: param.description as string | undefined,
			schema: param.schema as SchemaObject | undefined,
		};
	});

	let requestBody: RequestBody | undefined;
	if (op.requestBody && typeof op.requestBody === "object") {
		const rb = op.requestBody as Record<string, unknown>;
		const content = rb.content as Record<string, Record<string, unknown>> | undefined;
		if (content) {
			// Prefer application/json, fallback to first
			const contentType = content["application/json"]
				? "application/json"
				: Object.keys(content)[0] ?? "application/json";
			const mediaType = content[contentType];
			requestBody = {
				required: rb.required as boolean,
				description: rb.description as string | undefined,
				contentType,
				schema: mediaType?.schema as SchemaObject | undefined,
			};
		}
	}

	const responses: Record<string, ResponseDef> = {};
	if (op.responses && typeof op.responses === "object") {
		for (const [code, resp] of Object.entries(op.responses as Record<string, Record<string, unknown>>)) {
			const content = resp?.content as Record<string, Record<string, unknown>> | undefined;
			let schema: SchemaObject | undefined;
			if (content) {
				const mediaType = content["application/json"] ?? Object.values(content)[0];
				schema = mediaType?.schema as SchemaObject | undefined;
			}
			responses[code] = {
				description: resp?.description as string | undefined,
				schema,
			};
		}
	}

	return {
		method: method.toUpperCase(),
		path,
		operationId: op.operationId as string | undefined,
		summary: op.summary as string | undefined,
		description: op.description as string | undefined,
		tags: (op.tags as string[]) ?? [],
		parameters,
		requestBody,
		responses,
		deprecated: op.deprecated as boolean | undefined,
	};
}

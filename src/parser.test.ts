import { describe, expect, test } from "bun:test";
import { parseSpec, parseText } from "./parser.js";

describe("parseText", () => {
	test("parses JSON object", () => {
		const result = parseText('{"openapi": "3.0.0"}');
		expect(result.openapi).toBe("3.0.0");
	});

	test("parses JSON with leading whitespace", () => {
		const result = parseText('  \n{"swagger": "2.0"}');
		expect(result.swagger).toBe("2.0");
	});

	test("parses YAML", () => {
		const result = parseText("openapi: '3.0.0'\ninfo:\n  title: Test\n  version: '1.0'");
		expect(result.openapi).toBe("3.0.0");
		const info = result.info as Record<string, unknown>;
		expect(info.title).toBe("Test");
	});

	test("throws on non-object input", () => {
		expect(() => parseText("just a string")).toThrow("Spec must be a JSON or YAML object");
	});

	test("throws on array input", () => {
		expect(() => parseText("[1, 2, 3]")).toThrow("Spec must be a JSON or YAML object");
	});

	test("throws on null YAML", () => {
		expect(() => parseText("~")).toThrow("Spec must be a JSON or YAML object");
	});
});

const minimalOpenApi3 = {
	openapi: "3.0.0",
	info: { title: "Test API", version: "1.0.0", description: "A test API" },
	servers: [{ url: "https://api.example.com" }],
	paths: {
		"/users": {
			get: {
				operationId: "listUsers",
				summary: "List users",
				tags: ["users"],
				parameters: [
					{
						name: "limit",
						in: "query",
						required: false,
						schema: { type: "integer" },
						description: "Max results",
					},
				],
				responses: {
					"200": {
						description: "Success",
						content: {
							"application/json": {
								schema: { type: "array", items: { type: "object" } },
							},
						},
					},
				},
			},
			post: {
				operationId: "createUser",
				summary: "Create user",
				tags: ["users"],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									name: { type: "string" },
									email: { type: "string", format: "email" },
								},
								required: ["name", "email"],
							},
						},
					},
				},
				responses: {
					"201": { description: "Created" },
				},
			},
		},
		"/users/{id}": {
			get: {
				operationId: "getUser",
				summary: "Get user by ID",
				tags: ["users"],
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
				responses: {
					"200": { description: "Success" },
					"404": { description: "Not found" },
				},
			},
		},
	},
};

const minimalSwagger2 = {
	swagger: "2.0",
	info: { title: "Legacy API", version: "0.1.0" },
	host: "legacy.example.com",
	basePath: "/api/v1",
	schemes: ["https"],
	paths: {
		"/items": {
			get: {
				operationId: "listItems",
				summary: "List items",
				tags: ["items"],
				parameters: [{ name: "page", in: "query", type: "integer", description: "Page number" }],
				responses: {
					"200": { description: "OK", schema: { type: "array" } },
				},
			},
			post: {
				operationId: "createItem",
				summary: "Create item",
				tags: ["items"],
				parameters: [
					{
						name: "body",
						in: "body",
						required: true,
						schema: { type: "object", properties: { name: { type: "string" } } },
					},
				],
				responses: {
					"201": { description: "Created" },
				},
			},
		},
	},
};

describe("parseSpec — OpenAPI 3.x", () => {
	// Write fixture to temp file
	const fixturePath = "/tmp/test-openapi3.json";

	test("parses endpoints correctly", async () => {
		await Bun.write(fixturePath, JSON.stringify(minimalOpenApi3));
		const spec = await parseSpec(fixturePath);

		expect(spec.title).toBe("Test API");
		expect(spec.version).toBe("1.0.0");
		expect(spec.description).toBe("A test API");
		expect(spec.baseUrl).toBe("https://api.example.com");
		expect(spec.endpoints).toHaveLength(3);
		expect(spec.tags).toEqual(["users"]);
	});

	test("parses GET /users", async () => {
		await Bun.write(fixturePath, JSON.stringify(minimalOpenApi3));
		const spec = await parseSpec(fixturePath);
		const ep = spec.endpoints.find((e) => e.method === "GET" && e.path === "/users");

		expect(ep).toBeDefined();
		expect(ep?.operationId).toBe("listUsers");
		expect(ep?.parameters).toHaveLength(1);
		expect(ep?.parameters[0].name).toBe("limit");
		expect(ep?.parameters[0].in).toBe("query");
	});

	test("parses POST /users with request body", async () => {
		await Bun.write(fixturePath, JSON.stringify(minimalOpenApi3));
		const spec = await parseSpec(fixturePath);
		const ep = spec.endpoints.find((e) => e.method === "POST" && e.path === "/users");

		expect(ep).toBeDefined();
		expect(ep?.requestBody).toBeDefined();
		expect(ep?.requestBody?.required).toBe(true);
		expect(ep?.requestBody?.contentType).toBe("application/json");
	});

	test("respects baseUrl override", async () => {
		await Bun.write(fixturePath, JSON.stringify(minimalOpenApi3));
		const spec = await parseSpec(fixturePath, "https://custom.api.com/v2");
		expect(spec.baseUrl).toBe("https://custom.api.com/v2");
	});
});

describe("parseSpec — Swagger 2.0", () => {
	const fixturePath = "/tmp/test-swagger2.json";

	test("parses endpoints correctly", async () => {
		await Bun.write(fixturePath, JSON.stringify(minimalSwagger2));
		const spec = await parseSpec(fixturePath);

		expect(spec.title).toBe("Legacy API");
		expect(spec.version).toBe("0.1.0");
		expect(spec.baseUrl).toBe("https://legacy.example.com/api/v1");
		expect(spec.endpoints).toHaveLength(2);
		expect(spec.tags).toEqual(["items"]);
	});

	test("converts body param to requestBody", async () => {
		await Bun.write(fixturePath, JSON.stringify(minimalSwagger2));
		const spec = await parseSpec(fixturePath);
		const ep = spec.endpoints.find((e) => e.method === "POST");

		expect(ep?.requestBody).toBeDefined();
		expect(ep?.requestBody?.contentType).toBe("application/json");
		expect(ep?.requestBody?.required).toBe(true);
	});
});

describe("parseSpec — YAML", () => {
	const fixturePath = "/tmp/test-spec.yaml";

	test("parses YAML spec", async () => {
		const yaml = `
openapi: "3.0.0"
info:
  title: YAML API
  version: "2.0.0"
servers:
  - url: https://yaml.example.com
paths:
  /health:
    get:
      summary: Health check
      responses:
        "200":
          description: OK
`;
		await Bun.write(fixturePath, yaml);
		const spec = await parseSpec(fixturePath);

		expect(spec.title).toBe("YAML API");
		expect(spec.version).toBe("2.0.0");
		expect(spec.baseUrl).toBe("https://yaml.example.com");
		expect(spec.endpoints).toHaveLength(1);
		expect(spec.endpoints[0].method).toBe("GET");
		expect(spec.endpoints[0].path).toBe("/health");
	});
});

describe("parseSpec — $ref resolution", () => {
	const fixturePath = "/tmp/test-refs.json";

	test("resolves $ref pointers", async () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Ref Test", version: "1.0.0" },
			servers: [{ url: "https://ref.example.com" }],
			paths: {
				"/items": {
					get: {
						responses: {
							"200": {
								description: "OK",
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/Item" },
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					Item: {
						type: "object",
						properties: { id: { type: "string" }, name: { type: "string" } },
					},
				},
			},
		};
		await Bun.write(fixturePath, JSON.stringify(spec));
		const parsed = await parseSpec(fixturePath);
		const ep = parsed.endpoints[0];
		const responseSchema = ep.responses["200"]?.schema as Record<string, unknown>;

		expect(responseSchema.type).toBe("object");
		expect(responseSchema.properties).toBeDefined();
	});

	test("handles circular $ref", async () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Circular", version: "1.0.0" },
			servers: [{ url: "https://circular.example.com" }],
			paths: {
				"/nodes": {
					get: {
						responses: {
							"200": {
								description: "OK",
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/Node" },
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					Node: {
						type: "object",
						properties: {
							id: { type: "string" },
							children: {
								type: "array",
								items: { $ref: "#/components/schemas/Node" },
							},
						},
					},
				},
			},
		};
		await Bun.write(fixturePath, JSON.stringify(spec));
		// Should not throw
		const parsed = await parseSpec(fixturePath);
		expect(parsed.endpoints).toHaveLength(1);
	});
});

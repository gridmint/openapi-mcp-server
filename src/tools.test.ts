import { describe, expect, test } from "bun:test";
import { getSchema, globToRegex, listEndpoints } from "./tools.js";
import type { ParsedSpec } from "./types.js";

const mockSpec: ParsedSpec = {
	title: "Test API",
	version: "1.0.0",
	baseUrl: "https://api.example.com",
	tags: ["users", "items"],
	endpoints: [
		{
			method: "GET",
			path: "/users",
			operationId: "listUsers",
			summary: "List all users",
			tags: ["users"],
			parameters: [],
			responses: {},
		},
		{
			method: "POST",
			path: "/users",
			operationId: "createUser",
			summary: "Create a user",
			tags: ["users"],
			parameters: [],
			requestBody: {
				required: true,
				contentType: "application/json",
				schema: { type: "object" },
			},
			responses: {},
		},
		{
			method: "GET",
			path: "/users/{id}",
			operationId: "getUser",
			summary: "Get user by ID",
			tags: ["users"],
			parameters: [{ name: "id", in: "path", required: true }],
			responses: {},
		},
		{
			method: "GET",
			path: "/items",
			operationId: "listItems",
			summary: "List items",
			tags: ["items"],
			parameters: [],
			responses: {},
			deprecated: true,
		},
		{
			method: "DELETE",
			path: "/items/{id}",
			operationId: "deleteItem",
			summary: "Delete item",
			tags: ["items"],
			parameters: [{ name: "id", in: "path", required: true }],
			responses: {},
		},
	],
};

describe("globToRegex", () => {
	test("matches wildcard pattern", () => {
		const re = globToRegex("/users/*");
		expect(re.test("/users/123")).toBe(true);
		expect(re.test("/items/123")).toBe(false);
	});

	test("matches question mark", () => {
		const re = globToRegex("/user?");
		expect(re.test("/users")).toBe(true);
		expect(re.test("/user")).toBe(false);
	});

	test("escapes special regex chars", () => {
		const re = globToRegex("/users/{id}");
		expect(re.test("/users/{id}")).toBe(true);
	});
});

describe("listEndpoints", () => {
	test("lists all endpoints", () => {
		const result = listEndpoints(mockSpec, {}, 20);
		expect(result).toContain("5 endpoints");
		expect(result).toContain("/users");
		expect(result).toContain("/items");
	});

	test("filters by method", () => {
		const result = listEndpoints(mockSpec, { method: "GET" }, 20);
		expect(result).toContain("3 endpoints");
		expect(result).not.toContain("DELETE");
	});

	test("filters by tag", () => {
		const result = listEndpoints(mockSpec, { tag: "items" }, 20);
		expect(result).toContain("2 endpoints");
		expect(result).toContain("/items");
	});

	test("filters by glob pattern", () => {
		const result = listEndpoints(mockSpec, { filter: "*user*" }, 20);
		expect(result).toContain("3 endpoints");
	});

	test("paginates results", () => {
		const page1 = listEndpoints(mockSpec, {}, 2);
		expect(page1).toContain("Page 1/3");
		expect(page1).toContain("page=2");

		const page2 = listEndpoints(mockSpec, { page: 2 }, 2);
		expect(page2).toContain("Page 2/3");
	});

	test("returns message when no matches", () => {
		const result = listEndpoints(mockSpec, { filter: "nonexistent" }, 20);
		expect(result).toContain("No endpoints found");
	});

	test("shows deprecated marker", () => {
		const result = listEndpoints(mockSpec, { tag: "items" }, 20);
		expect(result).toContain("DEPRECATED");
	});
});

describe("getSchema", () => {
	test("returns endpoint schema", () => {
		const result = getSchema(mockSpec, { method: "GET", path: "/users" });
		expect(result).toContain("GET /users");
		expect(result).toContain("listUsers");
	});

	test("returns not found for missing endpoint", () => {
		const result = getSchema(mockSpec, { method: "GET", path: "/nonexistent" });
		expect(result).toContain("Endpoint not found");
	});

	test("suggests similar endpoints", () => {
		const result = getSchema(mockSpec, { method: "POST", path: "/users/{id}" });
		expect(result).toContain("Did you mean");
	});

	test("is case-insensitive for method", () => {
		const result = getSchema(mockSpec, { method: "get", path: "/users" });
		expect(result).toContain("GET /users");
	});
});

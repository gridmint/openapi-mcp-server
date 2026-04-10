import { describe, expect, test } from "bun:test";
import { parseAuthString } from "./http.js";

describe("parseAuthString", () => {
	test("parses bearer token", () => {
		const auth = parseAuthString("bearer:my-secret-token");
		expect(auth.type).toBe("bearer");
		expect(auth.token).toBe("my-secret-token");
	});

	test("preserves colons in bearer token", () => {
		const auth = parseAuthString("bearer:token:with:colons");
		expect(auth.token).toBe("token:with:colons");
	});

	test("parses basic auth", () => {
		const auth = parseAuthString("basic:admin:password123");
		expect(auth.type).toBe("basic");
		expect(auth.username).toBe("admin");
		expect(auth.password).toBe("password123");
	});

	test("preserves colons in basic password", () => {
		const auth = parseAuthString("basic:user:pass:with:colons");
		expect(auth.password).toBe("pass:with:colons");
	});

	test("parses apikey header", () => {
		const auth = parseAuthString("apikey:header:X-API-Key:abc123");
		expect(auth.type).toBe("apikey");
		expect(auth.in).toBe("header");
		expect(auth.headerName).toBe("X-API-Key");
		expect(auth.value).toBe("abc123");
	});

	test("parses apikey query", () => {
		const auth = parseAuthString("apikey:query:api_key:secret");
		expect(auth.type).toBe("apikey");
		expect(auth.in).toBe("query");
		expect(auth.queryName).toBe("api_key");
		expect(auth.value).toBe("secret");
	});

	test("throws on invalid format", () => {
		expect(() => parseAuthString("oauth:token")).toThrow("Invalid auth format");
	});
});

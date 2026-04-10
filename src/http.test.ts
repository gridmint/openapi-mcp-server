import { describe, expect, test } from "bun:test";
import { parseAuthString } from "./http.js";

describe("parseAuthString", () => {
	test("parses bearer token", () => {
		const auth = parseAuthString("bearer:my-secret-token");
		expect(auth).toEqual({ type: "bearer", token: "my-secret-token" });
	});

	test("preserves colons in bearer token", () => {
		const auth = parseAuthString("bearer:token:with:colons");
		expect(auth).toEqual({ type: "bearer", token: "token:with:colons" });
	});

	test("parses basic auth", () => {
		const auth = parseAuthString("basic:admin:password123");
		expect(auth).toEqual({ type: "basic", username: "admin", password: "password123" });
	});

	test("preserves colons in basic password", () => {
		const auth = parseAuthString("basic:user:pass:with:colons");
		expect(auth).toEqual({ type: "basic", username: "user", password: "pass:with:colons" });
	});

	test("parses apikey header", () => {
		const auth = parseAuthString("apikey:header:X-API-Key:abc123");
		expect(auth).toEqual({
			type: "apikey",
			in: "header",
			headerName: "X-API-Key",
			value: "abc123",
		});
	});

	test("parses apikey query", () => {
		const auth = parseAuthString("apikey:query:api_key:secret");
		expect(auth).toEqual({
			type: "apikey",
			in: "query",
			queryName: "api_key",
			value: "secret",
		});
	});

	test("throws on invalid format", () => {
		expect(() => parseAuthString("oauth:token")).toThrow("Invalid auth format");
	});

	test("throws on basic without username", () => {
		expect(() => parseAuthString("basic:")).toThrow("Basic auth requires username");
	});

	test("throws on apikey with invalid location", () => {
		expect(() => parseAuthString("apikey:body:name:val")).toThrow("Invalid apikey location");
	});
});

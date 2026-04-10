import type { AuthConfig } from "./types.js";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_TEXT_RESPONSE_LENGTH = 50_000;

/**
 * HTTP client for invoking API endpoints with auth support.
 */
export async function invokeEndpoint(opts: {
	baseUrl: string;
	method: string;
	path: string;
	pathParams?: Record<string, string>;
	queryParams?: Record<string, string>;
	headers?: Record<string, string>;
	body?: unknown;
	auth?: AuthConfig;
}): Promise<{
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: unknown;
}> {
	// Build URL with path params
	let url = `${opts.baseUrl}${opts.path}`;
	if (opts.pathParams) {
		for (const [key, value] of Object.entries(opts.pathParams)) {
			url = url.replace(`{${key}}`, encodeURIComponent(value));
		}
	}

	// Add query params
	const params = new URLSearchParams();
	if (opts.queryParams) {
		for (const [key, value] of Object.entries(opts.queryParams)) {
			if (value !== undefined && value !== null && value !== "") {
				params.set(key, value);
			}
		}
	}
	// Apply apikey query auth
	if (opts.auth?.type === "apikey" && opts.auth.in === "query") {
		params.set(opts.auth.queryName, opts.auth.value);
	}
	const qs = params.toString();
	if (qs) url += `?${qs}`;

	// Build headers
	const headers: Record<string, string> = { ...opts.headers };

	// Apply auth
	if (opts.auth) {
		applyAuth(headers, opts.auth);
	}

	// Build request
	const method = opts.method.toUpperCase();
	const fetchOpts: RequestInit = {
		method,
		headers,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	};

	if (opts.body !== undefined && !["GET", "HEAD"].includes(method)) {
		if (typeof opts.body === "string") {
			fetchOpts.body = opts.body;
		} else {
			fetchOpts.body = JSON.stringify(opts.body);
			if (!headers["content-type"] && !headers["Content-Type"]) {
				headers["Content-Type"] = "application/json";
			}
		}
	}

	const resp = await fetch(url, fetchOpts);

	// Parse response
	const respHeaders: Record<string, string> = {};
	resp.headers.forEach((value, key) => {
		respHeaders[key] = value;
	});

	let body: unknown;
	const ct = resp.headers.get("content-type") ?? "";
	if (ct.includes("application/json")) {
		try {
			body = await resp.json();
		} catch {
			body = await resp.text();
		}
	} else {
		const text = await resp.text();
		body =
			text.length > MAX_TEXT_RESPONSE_LENGTH
				? `${text.slice(0, MAX_TEXT_RESPONSE_LENGTH)}\n\n... [truncated, ${text.length} chars total]`
				: text;
	}

	return { status: resp.status, statusText: resp.statusText, headers: respHeaders, body };
}

function applyAuth(headers: Record<string, string>, auth: AuthConfig): void {
	switch (auth.type) {
		case "bearer":
			headers.Authorization = `Bearer ${auth.token}`;
			break;
		case "basic": {
			const encoded = btoa(`${auth.username}:${auth.password}`);
			headers.Authorization = `Basic ${encoded}`;
			break;
		}
		case "apikey":
			if (auth.in === "header") {
				headers[auth.headerName] = auth.value;
			}
			break;
	}
}

/**
 * Parse auth string: "bearer:TOKEN", "basic:user:pass", "apikey:header:Name:Value", "apikey:query:name:value"
 */
export function parseAuthString(authStr: string): AuthConfig {
	const parts = authStr.split(":");

	if (parts[0] === "bearer") {
		return { type: "bearer", token: parts.slice(1).join(":") };
	}

	if (parts[0] === "basic") {
		if (!parts[1]) {
			throw new Error("Basic auth requires username: basic:user:pass");
		}
		return { type: "basic", username: parts[1], password: parts.slice(2).join(":") };
	}

	if (parts[0] === "apikey") {
		const location = parts[1];
		if (location !== "header" && location !== "query") {
			throw new Error(
				`Invalid apikey location: "${location}". Expected: apikey:header:Name:Value or apikey:query:name:value`,
			);
		}
		const name = parts[2];
		const value = parts.slice(3).join(":");
		if (location === "header") {
			return { type: "apikey", in: "header", headerName: name, value };
		}
		return { type: "apikey", in: "query", queryName: name, value };
	}

	throw new Error(
		`Invalid auth format: "${parts[0]}". Expected: bearer:TOKEN, basic:user:pass, apikey:header:Name:Value, apikey:query:name:value`,
	);
}

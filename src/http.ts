import type { AuthConfig } from "./types.js";

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
	if (opts.queryParams && Object.keys(opts.queryParams).length > 0) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(opts.queryParams)) {
			if (value !== undefined && value !== null && value !== "") {
				params.set(key, value);
			}
		}
		const qs = params.toString();
		if (qs) url += `?${qs}`;
	}

	// Build headers
	const headers: Record<string, string> = { ...opts.headers };

	// Apply auth
	if (opts.auth) {
		applyAuth(headers, opts.auth);
	}

	// Build request
	const fetchOpts: RequestInit = {
		method: opts.method.toUpperCase(),
		headers,
	};

	if (opts.body !== undefined && !["GET", "HEAD"].includes(opts.method.toUpperCase())) {
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
		// Truncate very large responses
		body =
			text.length > 50000
				? `${text.slice(0, 50000)}\n\n... [truncated, ${text.length} chars total]`
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
				headers[auth.headerName ?? "X-API-Key"] = auth.value ?? "";
			}
			// query params handled in URL building
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
		return { type: "basic", username: parts[1], password: parts.slice(2).join(":") };
	}

	if (parts[0] === "apikey") {
		const location = parts[1] as "header" | "query";
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

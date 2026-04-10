/** Normalized endpoint — common format for both Swagger 2.0 and OpenAPI 3.x */
export interface Endpoint {
	method: string;
	path: string;
	operationId?: string;
	summary?: string;
	description?: string;
	tags: string[];
	parameters: Parameter[];
	requestBody?: RequestBody;
	responses: Record<string, ResponseDef>;
	deprecated?: boolean;
}

export interface Parameter {
	name: string;
	in: "path" | "query" | "header" | "cookie";
	required: boolean;
	description?: string;
	schema?: SchemaObject;
}

export interface RequestBody {
	required?: boolean;
	description?: string;
	contentType: string;
	schema?: SchemaObject;
}

export interface ResponseDef {
	description?: string;
	schema?: SchemaObject;
}

export type SchemaObject = Record<string, unknown>;

export interface ParsedSpec {
	title: string;
	version: string;
	description?: string;
	baseUrl: string;
	endpoints: Endpoint[];
	tags: string[];
}

export interface AuthConfig {
	type: "bearer" | "basic" | "apikey";
	token?: string;
	username?: string;
	password?: string;
	headerName?: string;
	queryName?: string;
	value?: string;
	in?: "header" | "query";
}

export interface ServerConfig {
	specUrl: string;
	baseUrl?: string;
	auth?: AuthConfig;
	include?: string[];
	exclude?: string[];
	pageSize: number;
	transport: "stdio" | "http";
	port: number;
}

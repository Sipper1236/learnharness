import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { customEndpointModel, piEngineForSpec } from "../src/agent/models.ts";
import { safeEndpointUrl, sanitizeUserSettings } from "../src/core/settings.ts";

const endpoint = { baseUrl: "http://127.0.0.1:31415/v1", modelId: "auto" };

describe("custom OpenAI-compatible endpoints", () => {
	it("allows HTTP only on loopback and rejects embedded credentials", () => {
		for (const url of [endpoint.baseUrl, "http://localhost:1234/v1", "http://[::1]:1234/v1", "https://example.com/v1"]) {
			assert.equal(safeEndpointUrl(url), url);
		}
		for (const url of ["http://192.168.1.2/v1", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "not a URL"]) {
			assert.equal(safeEndpointUrl(url), undefined);
		}
	});

	it("preserves the configured output limit through settings and model construction", () => {
		const settings = sanitizeUserSettings({ version: 1, customEndpoint: { ...endpoint, maxTokens: 2048 } });
		assert.deepEqual(settings?.customEndpoint, { ...endpoint, maxTokens: 2048 });
		assert.equal(customEndpointModel(settings!.customEndpoint!).maxTokens, 2048);
		assert.equal(customEndpointModel(endpoint).maxTokens, 0);
	});

	it("drops invalid limits without discarding a valid endpoint", () => {
		for (const maxTokens of [-1, 1.5, NaN, Infinity, "2048", Number.MAX_SAFE_INTEGER + 1]) {
			assert.deepEqual(sanitizeUserSettings({ customEndpoint: { ...endpoint, maxTokens } })?.customEndpoint, endpoint);
		}
		assert.equal(sanitizeUserSettings({ customEndpoint: { ...endpoint, baseUrl: "http://remote.example/v1" } })?.customEndpoint, undefined);
	});

	it("sends the configured limit through the real pi-ai streaming adapter", async () => {
		const originalFetch = globalThis.fetch;
		let payload: Record<string, unknown> | undefined;
		globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			assert.equal(request.url, `${endpoint.baseUrl}/chat/completions`);
			assert.equal(request.headers.get("authorization"), "Bearer synthetic-test-key");
			payload = await request.json() as Record<string, unknown>;
			const chunks = [
				{ id: "test", choices: [{ index: 0, delta: { role: "assistant", content: "A complete " }, finish_reason: null }] },
				{ id: "test", choices: [{ index: 0, delta: { content: "response." }, finish_reason: null }] },
				{ id: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			];
			return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
		};
		try {
			const config = sanitizeUserSettings({ customEndpoint: { ...endpoint, maxTokens: 2048 } })!.customEndpoint!;
			const engine = piEngineForSpec({ provider: "custom-endpoint", id: endpoint.modelId }, true, undefined, { ...config, apiKey: "synthetic-test-key" });
			const stream = engine.streamFn(engine.model, normalizeContext({ messages: [{ role: "user", content: "Teach me math", timestamp: Date.now() }] }));
			const result = await stream.result();
			assert.equal(result.stopReason, "stop", JSON.stringify(result));
			assert.deepEqual(result.content, [{ type: "text", text: "A complete response." }]);
			assert.equal(payload?.max_tokens ?? payload?.max_completion_tokens, 2048);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

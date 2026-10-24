import { safeEndpointUrl } from "@/src/core";
import { readSettingsRecord, writeSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ endpoint: readSettingsRecord()?.customEndpoint ?? null });
}

export async function PUT(request: Request) {
	const body = await request.json().catch(() => null) as { baseUrl?: unknown; modelId?: unknown } | null;
	const baseUrl = typeof body?.baseUrl === "string" ? safeEndpointUrl(body.baseUrl) : undefined;
	if (!baseUrl || typeof body?.modelId !== "string" || !body.modelId.trim() || body.modelId.length > 200) {
		return Response.json({ error: "Provide an HTTPS endpoint URL (HTTP is allowed only on loopback) and a model ID up to 200 characters." }, { status: 400 });
	}
	const current = readSettingsRecord() ?? { version: 1 };
	const settings = writeSettingsRecord({ ...current, customEndpoint: { ...current.customEndpoint, baseUrl, modelId: body.modelId.trim() } });
	return Response.json({ endpoint: settings.customEndpoint });
}

export async function DELETE() {
	const current = readSettingsRecord() ?? { version: 1 };
	const settings: Record<string, unknown> = { ...current };
	delete settings.customEndpoint;
	writeSettingsRecord(settings);
	return Response.json({ endpoint: null });
}

interface LLMResponse {
  text: string;
}

interface APIErrorResponse {
  detail?: unknown;
}

export type ExtractionPhase = "entities" | "relations" | "data_time";

export async function requestLLM(
  input: string,
  phase?: ExtractionPhase,
): Promise<string> {
  const response = await fetch("/api/documents-to-dcr/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, phase }),
  });

  if (!response.ok) {
    let message = `Model extraction request failed (${response.status}).`;
    try {
      const body = (await response.json()) as APIErrorResponse;
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the status-based fallback for non-JSON responses.
    }
    throw new Error(message);
  }

  const result = (await response.json()) as LLMResponse;
  return result.text;
}

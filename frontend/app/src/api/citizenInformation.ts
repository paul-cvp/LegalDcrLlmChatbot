export type CitizenLanguage = "source" | "da" | "en" | "no";

export interface CitizenInformationRequest {
  text: string;
  language: CitizenLanguage;
}

export async function generateCitizenInformation(
  request: CitizenInformationRequest,
): Promise<string> {
  const response = await fetch("/api/documents-to-dcr/citizen-information", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    let message = `Citizen Information generation failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Retain the status-based error for non-JSON responses.
    }
    throw new Error(message);
  }
  return ((await response.json()) as { text: string }).text;
}

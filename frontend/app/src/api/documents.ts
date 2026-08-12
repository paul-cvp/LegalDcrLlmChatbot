export interface SourceDocument {
  filename: string;
  title: string;
}

interface APIErrorResponse {
  detail?: unknown;
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as APIErrorResponse;
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }
  return `${fallback} (${response.status}).`;
}

export async function listSourceDocuments(): Promise<SourceDocument[]> {
  const response = await fetch("/api/documents-to-dcr/documents");
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Unable to list PDF documents"));
  }
  return (await response.json()) as SourceDocument[];
}

export async function loadSourceDocument(filename: string): Promise<Blob> {
  const query = new URLSearchParams({ filename });
  const response = await fetch(`/api/documents-to-dcr/document?${query}`);
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Unable to open PDF document"));
  }
  return await response.blob();
}

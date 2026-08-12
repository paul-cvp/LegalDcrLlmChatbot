export interface DCRGraphResource {
  name: string;
  xml: string;
}

type ErrorResponse = {
  detail?: string;
};

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const API_URL = `${configuredBaseUrl ?? "/api"}/dcr-graphs`;

export class DCRGraphApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DCRGraphApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `DCR graph request failed (${response.status}).`;
    try {
      const body = (await response.json()) as ErrorResponse;
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the status-based fallback for non-JSON responses.
    }
    throw new DCRGraphApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function graphUrl(name: string): string {
  return `${API_URL}/${encodeURIComponent(name)}`;
}

export function listDCRGraphs(): Promise<DCRGraphResource[]> {
  return request<DCRGraphResource[]>(API_URL);
}

export function createDCRGraph(
  name: string,
  xml: string,
): Promise<DCRGraphResource> {
  return request<DCRGraphResource>(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, xml }),
  });
}

export function updateDCRGraph(
  name: string,
  xml: string,
  updatedName?: string,
): Promise<DCRGraphResource> {
  return request<DCRGraphResource>(graphUrl(name), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml, name: updatedName }),
  });
}

export function deleteDCRGraph(name: string): Promise<void> {
  return request<void>(graphUrl(name), { method: "DELETE" });
}

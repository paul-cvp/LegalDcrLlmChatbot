const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const API_URL = `${configuredBaseUrl ?? "/api"}/tool-calls`;

export interface ToolCallOption {
  value: string;
  label: string;
}

export async function listToolCalls(): Promise<ToolCallOption[]> {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`Tool call request failed (${response.status}).`);
  }
  return (await response.json()) as ToolCallOption[];
}

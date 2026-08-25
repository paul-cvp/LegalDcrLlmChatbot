export const CHAT_TYPE = {
  DCR_CHAT: 1,
  DCR_CONTROLLER_CHAT: 2,
  RAG_CHAT: 3,
} as const;

export type ChatType = (typeof CHAT_TYPE)[keyof typeof CHAT_TYPE];
export type ChatInput = string | number | boolean;
export type RagSearchIndex = "find_relevant_laws" | "find_similar_cases";

export interface RagChatMetadata {
  search_indexes: RagSearchIndex[];
  generate_followups: boolean;
  use_citizen_data: boolean;
}

export interface DcrChatStartRequest {
  text: ChatInput;
  chat_type: typeof CHAT_TYPE.DCR_CHAT;
  graph_xml: string;
  dcr_role: string;
  robot_auto_limit: number;
  activity_repeat_limit: number;
  citizen_information?: string;
  metadata?: DcrChatMetadata;
}

export interface DcrControllerChatStartRequest {
  text: string;
  chat_type: typeof CHAT_TYPE.DCR_CONTROLLER_CHAT;
  citizen_information?: string;
  metadata?: DcrChatMetadata;
}

export interface RagChatStartRequest {
  text: string;
  chat_type: typeof CHAT_TYPE.RAG_CHAT;
  metadata: RagChatMetadata;
  citizen_information?: string;
}

export interface DcrChatMetadata {
  use_citizen_data: boolean;
}

export interface ChatContinuationRequest {
  text: ChatInput;
  session_id: string;
  act_id?: string;
  dcr_role?: string;
  robot_auto_limit?: number;
  activity_repeat_limit?: number;
  citizen_information?: string;
  metadata?: RagChatMetadata | DcrChatMetadata;
}

export type ChatResponseRequest =
  | DcrChatStartRequest
  | DcrControllerChatStartRequest
  | RagChatStartRequest
  | ChatContinuationRequest;

export interface ChatSessionResponse {
  text: string;
  session_id: string;
}

export interface DcrChatResponse extends ChatSessionResponse {
  graph_xml: string | null;
  act_id: string | null;
  dcr_role: string | null;
}

export interface DcrGraphCandidate {
  graph_id: string;
  source: string;
  format: "xml" | "json";
  score: number;
  excerpt: string;
}

export interface DcrControllerChatResponse extends ChatSessionResponse {
  graphs: DcrGraphCandidate[];
}

export interface RagEvidence {
  index: RagSearchIndex;
  source: string;
  page: number;
  citation: string;
  excerpt: string;
  score: number;
  outcome: string | null;
}

export interface RagChatResponse extends ChatSessionResponse {
  follow_up_questions: string[];
  evidence: RagEvidence[];
}

export type ChatResponse =
  | ChatSessionResponse
  | DcrChatResponse
  | DcrControllerChatResponse
  | RagChatResponse;

export interface ChatHistoryEntry {
  item: string;
  chat_role: string;
  dcr_role: string | null;
  metadata: Record<string, unknown> | null;
}

export class ChatApiError extends Error {
  readonly status: number;
  readonly detail?: unknown;

  constructor(
    message: string,
    status: number,
    detail?: unknown,
  ) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.detail = detail;
  }
}

type Fetcher = typeof globalThis.fetch;

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
export const CHAT_API_URL = `${configuredBaseUrl ?? "/api"}/chat`;

/** Owns all HTTP communication with the backend chat API. */
export class ChatApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(
    baseUrl = CHAT_API_URL,
    fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  createResponse(
    request: ChatResponseRequest,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    return this.request<ChatResponse>("/response", {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    });
  }

  getHistory(sessionId: string, signal?: AbortSignal): Promise<ChatHistoryEntry[]> {
    return this.request<ChatHistoryEntry[]>("/history", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    });
  }

  deleteSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>("/session", {
      method: "DELETE",
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    });
  }

  // Short aliases keep controller call sites readable.
  respond(request: ChatResponseRequest, signal?: AbortSignal): Promise<ChatResponse> {
    return this.createResponse(request, signal);
  }

  history(sessionId: string, signal?: AbortSignal): Promise<ChatHistoryEntry[]> {
    return this.getHistory(sessionId, signal);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async toError(response: Response): Promise<ChatApiError> {
    let detail: unknown;
    try {
      detail = ((await response.json()) as { detail?: unknown }).detail;
    } catch {
      // A status-based message still explains non-JSON failures.
    }
    return new ChatApiError(
      formatFastApiDetail(detail) ?? `Chat request failed (${response.status}).`,
      response.status,
      detail,
    );
  }
}

export function formatFastApiDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return undefined;

  const messages = detail.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as { loc?: unknown; msg?: unknown };
    if (typeof value.msg !== "string") return [];
    const location = Array.isArray(value.loc)
      ? value.loc.filter((part) => part !== "body").join(".")
      : "";
    return [location ? `${location}: ${value.msg}` : value.msg];
  });
  return messages.length ? messages.join("; ") : undefined;
}

export function isDcrChatResponse(response: ChatResponse): response is DcrChatResponse {
  return "graph_xml" in response;
}

export function isDcrControllerChatResponse(
  response: ChatResponse,
): response is DcrControllerChatResponse {
  return "graphs" in response;
}

export function isRagChatResponse(response: ChatResponse): response is RagChatResponse {
  return "evidence" in response;
}

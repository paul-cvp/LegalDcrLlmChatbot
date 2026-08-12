import {
  DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  type ChatSettings,
} from "@dcr-js/chat";

import {
  CHAT_TYPE,
  ChatApiClient,
  ChatApiError,
  type ChatHistoryEntry,
  type ChatResponse,
  type ChatResponseRequest,
  type RagChatMetadata,
} from "../api/chat";
import type { ChatSessionRecord } from "./models";
import { ChatSessionRepository } from "./sessionRepository";

type RagSettings = Pick<
  ChatSettings,
  "searchIndex" | "suggestFollowupQuestions"
>;

export interface ChatRequestOptions {
  citizenInformation?: string;
  useCitizenData?: boolean;
  signal?: AbortSignal;
}

function withOptionalContext<Request extends ChatResponseRequest>(
  request: Request,
  options: ChatRequestOptions,
): Request {
  const citizenInformation = options.citizenInformation?.trim();
  if (!citizenInformation) return request;
  return {
    ...request,
    citizen_information: citizenInformation,
  };
}

function dcrMetadata(options: ChatRequestOptions) {
  return options.useCitizenData
    ? { metadata: { use_citizen_data: true } as const }
    : {};
}

/** Coordinates backend sessions and their locally enriched snapshots. */
export class ChatWorkspaceController {
  private readonly memory = new Map<string, ChatSessionRecord>();
  private readonly api: ChatApiClient;
  private readonly sessions: ChatSessionRepository;

  constructor(
    api = new ChatApiClient(),
    sessions = new ChatSessionRepository(),
  ) {
    this.api = api;
    this.sessions = sessions;
  }

  startController(
    text: string,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext(
        {
          text,
          chat_type: CHAT_TYPE.DCR_CONTROLLER_CHAT,
          ...dcrMetadata(options),
        },
        options,
      ),
      options.signal,
    );
  }

  startRag(
    text: string,
    settings: RagSettings,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext(
        { text, chat_type: CHAT_TYPE.RAG_CHAT, metadata: ragMetadata(settings) },
        options,
      ),
      options.signal,
    );
  }

  startDcr(
    graphXml: string,
    dcrRole: string,
    robotAutoLimit: number,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext({
        text: "",
        chat_type: CHAT_TYPE.DCR_CHAT,
        graph_xml: graphXml,
        dcr_role: dcrRole,
        robot_auto_limit: robotAutoLimit,
        ...dcrMetadata(options),
      }, options),
      options.signal,
    );
  }

  continueController(
    sessionId: string,
    text: string,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext({
        text,
        session_id: sessionId,
        ...dcrMetadata(options),
      }, options),
      options.signal,
    );
  }

  selectControllerGraph(
    sessionId: string,
    source: string,
    dcrRole: string,
    robotAutoLimit: number,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext({
        text: source,
        session_id: sessionId,
        dcr_role: dcrRole,
        robot_auto_limit: robotAutoLimit,
        ...dcrMetadata(options),
      }, options),
      options.signal,
    );
  }

  continueRag(
    sessionId: string,
    text: string,
    settings: RagSettings,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext(
        { text, session_id: sessionId, metadata: ragMetadata(settings) },
        options,
      ),
      options.signal,
    );
  }

  continueDcr(
    sessionId: string,
    text: string,
    dcrRole: string,
    robotAutoLimit: number,
    actId?: string,
    options: ChatRequestOptions = {},
  ): Promise<ChatResponse> {
    return this.api.createResponse(
      withOptionalContext({
        text,
        session_id: sessionId,
        act_id: actId,
        dcr_role: dcrRole,
        robot_auto_limit: robotAutoLimit,
        ...dcrMetadata(options),
      }, options),
      options.signal,
    );
  }

  history(sessionId: string, signal?: AbortSignal): Promise<ChatHistoryEntry[]> {
    return this.api.getHistory(sessionId, signal);
  }

  async listSessions(): Promise<ChatSessionRecord[]> {
    try {
      for (const record of await this.sessions.list()) {
        this.memory.set(record.id, withSessionDefaults(record));
      }
    } catch {
      // Chat remains usable when browser storage is blocked.
    }
    return [...this.memory.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }

  async getSession(id: string): Promise<ChatSessionRecord | undefined> {
    const cached = this.memory.get(id);
    if (cached) return cached;
    try {
      const record = await this.sessions.get(id);
      if (!record) return undefined;
      const normalized = withSessionDefaults(record);
      this.memory.set(id, normalized);
      return normalized;
    } catch {
      return undefined;
    }
  }

  async saveSession(record: ChatSessionRecord): Promise<void> {
    this.memory.set(record.id, record);
    try {
      await this.sessions.save(record);
    } catch {
      // The in-memory copy still supports the current browser visit.
    }
  }

  async removeLocalSession(id: string): Promise<void> {
    this.memory.delete(id);
    try {
      await this.sessions.remove(id);
    } catch {
      // The in-memory copy is already removed.
    }
  }

  async deleteSession(id: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.api.deleteSession(id, signal);
    } catch (error) {
      if (!(error instanceof ChatApiError) || error.status !== 404) throw error;
    }
    await this.removeLocalSession(id);
  }

  close(): void {
    this.sessions.close();
  }
}

function withSessionDefaults(record: ChatSessionRecord): ChatSessionRecord {
  return {
    ...record,
    robotAutoExecutionsPerActivity:
      record.robotAutoExecutionsPerActivity
      ?? DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  };
}

export function ragMetadata(settings: RagSettings): RagChatMetadata {
  const search_indexes = settings.searchIndex === "All"
    ? ["find_relevant_laws", "find_similar_cases"] as const
    : settings.searchIndex === "Relevant laws"
      ? ["find_relevant_laws"] as const
      : ["find_similar_cases"] as const;
  return {
    search_indexes: [...search_indexes],
    generate_followups: settings.suggestFollowupQuestions,
  };
}

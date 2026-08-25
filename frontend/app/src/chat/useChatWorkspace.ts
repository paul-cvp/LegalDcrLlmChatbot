import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  DEFAULT_ACTIVITY_REPETITIONS,
  type ChatCitation,
  type ChatInput,
  type ChatMessage,
  type ChatSessionSummary,
  type ChatSettings,
  type GraphCandidate,
  type ExpectedAnswerType,
} from "@dcr-js/chat";

import type { ChatLaunchConfig } from "../App";
import {
  ChatApiError,
  isDcrChatResponse,
  isDcrControllerChatResponse,
  isRagChatResponse,
  type ChatHistoryEntry,
  type ChatResponse,
} from "../api/chat";
import {
  ChatWorkspaceController,
  type ChatRequestOptions,
} from "./ChatWorkspaceController";
import type {
  ChatMessageEnrichment,
  ChatSessionRecord,
  StoredChatMessage,
} from "./models";
import {
  canonicalizeDcrRole,
  extractAutomaticRobotExecutions,
  extractDcrToolEvidence,
  expectedDcrAnswerType,
  type DcrToolEvidence,
  isRobotActivity,
  mergeChatHistory,
  normalizeRagEvidence,
  resolveGraphDcrRole,
} from "./normalization";

type ActiveSession = Omit<ChatSessionRecord, "id"> & { id?: string };

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  dcrRole: "Citizen",
  robotAutoExecutionsPerActivity: DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  activityRepetitions: DEFAULT_ACTIVITY_REPETITIONS,
  useCitizenInformation: false,
  searchIndex: "All",
  suggestFollowupQuestions: true,
  retrieveCount: 5,
  minimumSearchScore: 0,
};

export interface ChatWorkspace {
  mode: ActiveSession["mode"];
  title: string;
  messages: readonly ChatMessage[];
  settings: ChatSettings;
  sessions: readonly ChatSessionSummary[];
  activeSessionId?: string;
  graphXml?: string;
  selectedCitation?: ChatCitation;
  loading: boolean;
  error: string | null;
  notice: string | null;
  inputDisabled: boolean;
  inputDisabledReason?: string;
  expectedAnswerType?: ExpectedAnswerType;
  send: (input: ChatInput) => Promise<void>;
  editAnswer: (messageId: string, input: ChatInput) => Promise<void>;
  clear: () => Promise<void>;
  updateSettings: (settings: ChatSettings) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  selectCandidate: (candidate: GraphCandidate) => Promise<void>;
  selectCitation: (citation: ChatCitation) => void;
  stop: () => void;
}

interface RequestContext {
  signal: AbortSignal;
}

let localMessageSequence = 0;

export function useChatWorkspace(
  launch: ChatLaunchConfig,
  controller: ChatWorkspaceController,
  citizenInformation = "",
): ChatWorkspace {
  const [active, setActiveState] = useState<ActiveSession>(() =>
    createDraftSession(launch, DEFAULT_CHAT_SETTINGS.dcrRole),
  );
  const [settings, setSettings] = useState(DEFAULT_CHAT_SETTINGS);
  const [storedSessions, setStoredSessions] = useState<ChatSessionRecord[]>([]);
  const [selectedCitation, setSelectedCitation] = useState<ChatCitation>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRef = useRef(active);
  const historyRef = useRef<ChatHistoryEntry[]>([]);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(true);
  const directBootstrapStarted = useRef(false);

  const replaceActive = useCallback((session: ActiveSession) => {
    activeRef.current = session;
    if (mountedRef.current) setActiveState(session);
  }, []);

  const refreshSessionList = useCallback(async () => {
    const records = await controller.listSessions();
    if (mountedRef.current) setStoredSessions(records);
  }, [controller]);

  const persist = useCallback(async (session: ActiveSession) => {
    if (!session.id) return;
    await controller.saveSession(asRecord(session));
    await refreshSessionList();
  }, [controller, refreshSessionList]);

  const runRequest = useCallback(async (
    operation: (context: RequestContext) => Promise<void>,
  ) => {
    requestRef.current?.abort();
    const abortController = new AbortController();
    requestRef.current = abortController;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await operation({ signal: abortController.signal });
    } catch (reason) {
      if (reason instanceof ChatApiError && reason.status === 404) {
        const expired = activeRef.current;
        if (expired.id) await controller.removeLocalSession(expired.id);
        historyRef.current = [];
        setSelectedCitation(undefined);
        replaceActive(draftAfterExpiry(expired));
        await refreshSessionList();
        if (mountedRef.current) {
          setError("This chat session expired and was removed from history. Start a new chat to continue.");
        }
      } else if (!isAbortError(reason) && mountedRef.current) {
        setError(errorText(reason));
      }
    } finally {
      if (requestRef.current === abortController) {
        requestRef.current = undefined;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [controller, refreshSessionList, replaceActive]);

  const finalizeResponse = useCallback(async (
    response: ChatResponse,
    working: ActiveSession,
    previousHistory: readonly ChatHistoryEntry[],
    signal: AbortSignal,
  ) => {
    const sessionId = response.session_id;
    if (!sessionId) throw new Error("The backend did not return a chat session ID.");

    let next: ActiveSession = {
      ...working,
      id: sessionId,
      selectedRole: activeRef.current.selectedRole,
      updatedAt: Date.now(),
    };

    if (isDcrControllerChatResponse(response)) {
      const candidates = response.graphs.map<GraphCandidate>((candidate, index) => ({
        id: candidate.graph_id || `candidate-${index}`,
        description: `Option ${index + 1}`,
        source: candidate.source,
      }));
      const assistantId = messageId("controller-answer");
      const assistant: StoredChatMessage = {
        id: assistantId,
        role: "assistant",
        content: response.text,
        contentOverride: true,
        candidates,
      };
      const candidateDescriptions = {
        ...working.candidateDescriptions,
        ...Object.fromEntries(candidates.map((candidate) => [
          candidate.source,
          candidate.description,
        ])),
      };
      const provisional = [...working.messages, assistant];
      const history = await controller.history(sessionId, signal);
      next = {
        ...next,
        messages: mergeChatHistory(
          history,
          provisional,
          candidateDescriptions,
          working.enrichment,
        ),
        candidates,
        candidateDescriptions,
      };
      historyRef.current = history;
    } else if (isRagChatResponse(response)) {
      const normalized = normalizeRagEvidence(response.evidence);
      const assistantId = messageId("rag-answer");
      const enrichment: ChatMessageEnrichment = {
        supportingContent: normalized.supportingContent,
        citations: normalized.citations,
        followups: response.follow_up_questions,
      };
      const provisional: StoredChatMessage[] = [
        ...working.messages,
        {
          id: assistantId,
          role: "assistant",
          content: response.text,
          ...enrichment,
        },
      ];
      const enrichments = { ...working.enrichment, [assistantId]: enrichment };
      const history = await controller.history(sessionId, signal);
      next = {
        ...next,
        messages: mergeChatHistory(
          history,
          provisional,
          working.candidateDescriptions,
          enrichments,
        ),
        enrichment: enrichments,
      };
      historyRef.current = history;
    } else if (isDcrChatResponse(response)) {
      const graphXml = response.graph_xml ?? working.graphXml;
      if (!graphXml) throw new Error("The backend did not return the DCR graph state.");
      const history = await controller.history(sessionId, signal);
      const automaticExecutions = extractAutomaticRobotExecutions(previousHistory, history);
      const toolEvidence = extractDcrToolEvidence(previousHistory, history, graphXml);
      let messages = mergeChatHistory(
        history,
        working.messages,
        working.candidateDescriptions,
        working.enrichment,
      );
      const enriched = applyDcrToolEvidence(messages, toolEvidence, working.enrichment);
      messages = enriched.messages;
      next = {
        ...next,
        graphXml,
        pendingActivityId: response.act_id ?? undefined,
        pendingActivityRole: canonicalizeDcrRole(response.dcr_role),
        messages,
        enrichment: enriched.enrichment,
        candidates: [],
      };
      historyRef.current = history;
      if (automaticExecutions.length && mountedRef.current) {
        setNotice(automaticRobotNotice(
          automaticExecutions.map(({ activityLabel }) => activityLabel),
        ));
      }
    } else {
      const assistant: StoredChatMessage = {
        id: messageId("answer"),
        role: "assistant",
        content: response.text,
      };
      const provisional = [...working.messages, assistant];
      const history = await controller.history(sessionId, signal);
      next = {
        ...next,
        messages: mergeChatHistory(
          history,
          provisional,
          working.candidateDescriptions,
          working.enrichment,
        ),
      };
      historyRef.current = history;
    }

    replaceActive(next);
    await persist(next);
  }, [controller, persist, replaceActive]);

  const bootstrapDirect = useCallback(async (draft: ActiveSession) => {
    if (!draft.graphXml) return;
    await runRequest(async ({ signal }) => {
      const graphRole = resolveGraphDcrRole(draft.selectedRole, draft.graphXml);
      const response = await controller.startDcr(
        draft.graphXml!,
        graphRole,
        draft.robotAutoExecutionsPerActivity,
        draft.activityRepetitions,
        requestOptions(settings, citizenInformation, signal),
      );
      await finalizeResponse(response, draft, [], signal);
    });
  }, [citizenInformation, controller, finalizeResponse, runRequest, settings]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshSessionList();
    if (launch.mode === "dcr" && !directBootstrapStarted.current) {
      directBootstrapStarted.current = true;
      void bootstrapDirect(activeRef.current);
    }
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) requestRef.current?.abort();
      });
    };
  }, [bootstrapDirect, launch.mode, refreshSessionList]);

  const send = useCallback(async (input: ChatInput) => {
    const value = typeof input === "string" ? input.trim() : input;
    if (value === "") return;
    const disabledReason = inputLockReason(activeRef.current);
    if (disabledReason) {
      setError(disabledReason);
      return;
    }

    await runRequest(async ({ signal }) => {
      const current = discardUncommitted(activeRef.current);
      const runtime = Boolean(current.graphXml && current.id);
      const previousHistory = historyRef.current;
      const answerType = runtime
        ? expectedDcrAnswerType(current.graphXml, current.pendingActivityId)
        : undefined;
      const content = typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
      const userMessage: StoredChatMessage = {
        id: messageId("user"),
        role: "user",
        content,
        dcrRole: runtime ? current.selectedRole : undefined,
        editable: Boolean(runtime && current.pendingActivityId),
        answerType,
        submittedValue: typeof value === "string" ? undefined : value,
        contentOverride: typeof value !== "string",
        checkpoint: runtime && current.pendingActivityId ? {
          graphXml: current.graphXml!,
          pendingActivityId: current.pendingActivityId,
          selectedRole: current.selectedRole,
        } : undefined,
      };
      const cleared = clearCandidateChoices(current);
      const working: ActiveSession = {
        ...cleared,
        title: titleFromFirstQuestion(current, content),
        messages: [...cleared.messages, userMessage],
        updatedAt: Date.now(),
      };
      replaceActive(working);

      let response: ChatResponse;
      if (!current.id && current.mode === "dcr-controller") {
        response = await controller.startController(
          content,
          requestOptions(settings, citizenInformation, signal),
        );
      } else if (!current.id && current.mode === "rag") {
        response = await controller.startRag(
          content,
          settings,
          requestOptions(settings, citizenInformation, signal),
        );
      } else if (current.id && runtime) {
        const role = resolveGraphDcrRole(current.selectedRole, current.graphXml);
        response = await controller.continueDcr(
          current.id,
          value,
          role,
          current.robotAutoExecutionsPerActivity,
          current.activityRepetitions,
          current.pendingActivityId,
          requestOptions(settings, citizenInformation, signal),
        );
      } else if (current.id && current.mode === "rag") {
        response = await controller.continueRag(
          current.id,
          content,
          settings,
          requestOptions(settings, citizenInformation, signal),
        );
      } else if (current.id) {
        response = await controller.continueController(
          current.id,
          content,
          requestOptions(settings, citizenInformation, signal),
        );
      } else {
        throw new Error("The DCR chat has not finished initializing.");
      }
      await finalizeResponse(response, working, previousHistory, signal);
    });
  }, [citizenInformation, controller, finalizeResponse, replaceActive, runRequest, settings]);

  const editAnswer = useCallback(async (messageId: string, input: ChatInput) => {
    const value = typeof input === "string" ? input.trim() : input;
    if (value === "") return;

    await runRequest(async ({ signal }) => {
      const current = activeRef.current;
      const answerIndex = current.messages.findIndex(({ id }) => id === messageId);
      const answer = current.messages[answerIndex];
      const checkpoint = answer?.checkpoint;
      if (!current.id || answerIndex < 0 || !checkpoint) {
        throw new Error("This answer cannot be edited because its DCR checkpoint is unavailable.");
      }

      const oldSessionId = current.id;
      const content = typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
      const graphRole = resolveGraphDcrRole(checkpoint.selectedRole, checkpoint.graphXml);
      const startResponse = await controller.startDcr(
        checkpoint.graphXml,
        graphRole,
        current.robotAutoExecutionsPerActivity,
        current.activityRepetitions,
        requestOptions(settings, citizenInformation, signal),
      );
      if (!isDcrChatResponse(startResponse) || !startResponse.session_id) {
        throw new Error("The DCR session could not be restored.");
      }

      const startHistory = await controller.history(startResponse.session_id, signal);
      const questionIndex = answerIndex > 0 ? answerIndex - 1 : 0;
      const archived = current.messages.slice(0, questionIndex).map((message) => ({
        ...message,
        historyIndex: undefined,
        archived: true,
      }));
      const restored: ActiveSession = {
        ...current,
        id: startResponse.session_id,
        graphXml: startResponse.graph_xml ?? checkpoint.graphXml,
        pendingActivityId: startResponse.act_id ?? checkpoint.pendingActivityId,
        pendingActivityRole: canonicalizeDcrRole(startResponse.dcr_role),
        messages: [...archived, ...mergeChatHistory(startHistory)],
        updatedAt: Date.now(),
      };
      const revisedAnswer: StoredChatMessage = {
        id: answer.id,
        role: "user",
        content,
        dcrRole: checkpoint.selectedRole,
        editable: true,
        answerType: answer.answerType,
        submittedValue: typeof value === "string" ? undefined : value,
        contentOverride: typeof value !== "string",
        checkpoint,
      };
      const working: ActiveSession = {
        ...restored,
        messages: [...restored.messages, revisedAnswer],
      };
      try {
        const response = await controller.continueDcr(
          startResponse.session_id,
          value,
          graphRole,
          current.robotAutoExecutionsPerActivity,
          current.activityRepetitions,
          restored.pendingActivityId,
          requestOptions(settings, citizenInformation, signal),
        );
        await finalizeResponse(response, working, startHistory, signal);
      } catch (reason) {
        await controller.deleteSession(startResponse.session_id).catch(() => undefined);
        throw reason;
      }
      if (oldSessionId !== startResponse.session_id) {
        await controller.deleteSession(oldSessionId, signal);
        await refreshSessionList();
      }
    });
  }, [citizenInformation, controller, finalizeResponse, refreshSessionList, runRequest, settings]);

  const selectCandidate = useCallback(async (candidate: GraphCandidate) => {
    await runRequest(async ({ signal }) => {
      const current = activeRef.current;
      if (!current.id || !current.candidates.some(({ source }) => source === candidate.source)) {
        throw new Error("This DCR Graph is no longer available. Run the search again.");
      }
      const previousHistory = historyRef.current;
      const cleared = clearCandidateChoices(discardUncommitted(current));
      const working: ActiveSession = {
        ...cleared,
        messages: [
          ...cleared.messages,
          {
            id: messageId("graph-selection"),
            role: "user",
            content: candidate.description,
            dcrRole: current.selectedRole,
          },
        ],
        candidates: [],
        updatedAt: Date.now(),
      };
      replaceActive(working);
      const response = await controller.selectControllerGraph(
        current.id,
        candidate.source,
        resolveGraphDcrRole(current.selectedRole, current.graphXml),
        current.robotAutoExecutionsPerActivity,
        current.activityRepetitions,
        requestOptions(settings, citizenInformation, signal),
      );
      await finalizeResponse(response, working, previousHistory, signal);
    });
  }, [citizenInformation, controller, finalizeResponse, replaceActive, runRequest, settings]);

  const updateSettings = useCallback(async (nextSettings: ChatSettings) => {
    const previous = activeRef.current;
    const roleChanged = nextSettings.dcrRole !== previous.selectedRole;
    const robotLimitChanged = nextSettings.robotAutoExecutionsPerActivity
      !== previous.robotAutoExecutionsPerActivity;
    const activityLimitChanged = nextSettings.activityRepetitions
      !== previous.activityRepetitions;
    setSettings(nextSettings);
    if (previous.mode === "rag" || (!roleChanged && !robotLimitChanged && !activityLimitChanged)) return;

    const current: ActiveSession = {
      ...discardUncommitted(previous),
      selectedRole: nextSettings.dcrRole,
      robotAutoExecutionsPerActivity: nextSettings.robotAutoExecutionsPerActivity,
      activityRepetitions: nextSettings.activityRepetitions,
      updatedAt: Date.now(),
    };
    replaceActive(current);
    await persist(current);

    if (!current.id || !current.graphXml) return;
    if (!roleChanged && (!activityLimitChanged || current.pendingActivityId)) return;
    if (roleChanged && isRobotActivity(current.graphXml, current.pendingActivityId)) return;
    if (isComplete(current.messages)) return;

    await runRequest(async ({ signal }) => {
      const response = await controller.continueDcr(
        current.id!,
        "",
        resolveGraphDcrRole(current.selectedRole, current.graphXml),
        current.robotAutoExecutionsPerActivity,
        current.activityRepetitions,
        undefined,
        requestOptions(nextSettings, citizenInformation, signal),
      );
      await finalizeResponse(response, current, historyRef.current, signal);
    });
  }, [citizenInformation, controller, finalizeResponse, persist, replaceActive, runRequest]);

  const resetToFreshSession = useCallback(async (source: ActiveSession) => {
    requestRef.current?.abort();
    const graphXml = source.mode === "dcr"
      ? freshDirectGraph(source, launch)
      : undefined;
    const draft = createDraftSession(
      source.mode === "dcr"
        ? { mode: "dcr", graphName: source.graphName ?? "DCR Graph", graphXml: graphXml! }
        : { mode: source.mode },
      source.selectedRole,
      source.robotAutoExecutionsPerActivity,
      source.activityRepetitions,
    );
    historyRef.current = [];
    setSelectedCitation(undefined);
    setError(null);
    setNotice(null);
    replaceActive(draft);
    if (draft.mode === "dcr") await bootstrapDirect(draft);
  }, [bootstrapDirect, launch, replaceActive]);

  const clear = useCallback(async () => {
    await resetToFreshSession(activeRef.current);
  }, [resetToFreshSession]);

  const selectSession = useCallback(async (id: string) => {
    await runRequest(async ({ signal }) => {
      const record = await controller.getSession(id);
      if (!record) throw new Error("This chat is no longer available.");
      try {
        const history = await controller.history(id, signal);
        const merged = mergeChatHistory(
          history,
          record.messages,
          record.candidateDescriptions,
          record.enrichment,
        );
        const enriched = record.graphXml
          ? applyDcrToolEvidence(
              merged,
              extractDcrToolEvidence([], history, record.graphXml),
              record.enrichment,
            )
          : { messages: merged, enrichment: record.enrichment };
        const restored: ActiveSession = {
          ...record,
          messages: enriched.messages,
          enrichment: enriched.enrichment,
        };
        historyRef.current = history;
        setSettings((current: ChatSettings) => ({
          ...current,
          dcrRole: record.selectedRole,
          robotAutoExecutionsPerActivity: record.robotAutoExecutionsPerActivity,
          activityRepetitions: record.activityRepetitions,
        }));
        setSelectedCitation(undefined);
        replaceActive(restored);
      } catch (reason) {
        if (reason instanceof ChatApiError && reason.status === 404) {
          await controller.removeLocalSession(id);
          await refreshSessionList();
          throw new Error("This chat session expired and was removed from history.");
        }
        throw reason;
      }
    });
  }, [controller, refreshSessionList, replaceActive, runRequest]);

  const deleteSession = useCallback(async (id: string) => {
    const deletingActive = activeRef.current.id === id;
    const source = activeRef.current;
    let deleted = false;
    await runRequest(async ({ signal }) => {
      await controller.deleteSession(id, signal);
      await refreshSessionList();
      deleted = true;
    });
    if (deleted && deletingActive) await resetToFreshSession(source);
  }, [controller, refreshSessionList, resetToFreshSession, runRequest]);

  const deleteAllSessions = useCallback(async () => {
    const source = activeRef.current;
    let deleted = false;
    await runRequest(async ({ signal }) => {
      for (const session of storedSessions) {
        await controller.deleteSession(session.id, signal);
      }
      await refreshSessionList();
      deleted = true;
    });
    if (deleted && source.id) await resetToFreshSession(source);
  }, [controller, refreshSessionList, resetToFreshSession, runRequest, storedSessions]);

  const stop = useCallback(() => requestRef.current?.abort(), []);
  const inputDisabledReason = inputLockReason(active);
  const expectedAnswerType = useMemo(
    () => expectedDcrAnswerType(active.graphXml, active.pendingActivityId),
    [active.graphXml, active.pendingActivityId],
  );
  const sessions = useMemo(
    () => storedSessions.map<ChatSessionSummary>((record) => ({
      id: record.id,
      title: record.title,
      mode: record.mode,
      updatedAt: new Date(record.updatedAt).toISOString(),
      preview: [...record.messages].reverse().find(({ content }) => content.trim())?.content,
      graphName: record.graphName,
    })),
    [storedSessions],
  );

  return {
    mode: active.mode,
    title: active.title,
    messages: active.messages,
    settings,
    sessions,
    activeSessionId: active.id,
    graphXml: active.graphXml,
    selectedCitation,
    loading,
    error,
    notice,
    inputDisabled: Boolean(inputDisabledReason),
    inputDisabledReason,
    expectedAnswerType,
    send,
    editAnswer,
    clear,
    updateSettings,
    selectSession,
    deleteSession,
    deleteAllSessions,
    selectCandidate,
    selectCitation: setSelectedCitation,
    stop,
  };
}

function createDraftSession(
  launch: ChatLaunchConfig,
  selectedRole: ChatSessionRecord["selectedRole"],
  robotAutoExecutionsPerActivity = DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  activityRepetitions = DEFAULT_ACTIVITY_REPETITIONS,
): ActiveSession {
  return {
    mode: launch.mode,
    title: launch.mode === "dcr"
      ? launch.graphName
      : launch.mode === "rag" ? "Pure RAG Chat" : "DCR Chat",
    updatedAt: Date.now(),
    selectedRole,
    robotAutoExecutionsPerActivity,
    activityRepetitions,
    graphName: launch.mode === "dcr" ? launch.graphName : undefined,
    graphXml: launch.mode === "dcr" ? launch.graphXml : undefined,
    messages: [],
    enrichment: {},
    candidates: [],
    candidateDescriptions: {},
  };
}

function requestOptions(
  settings: ChatSettings,
  citizenInformation: string,
  signal: AbortSignal,
): ChatRequestOptions {
  return {
    citizenInformation: settings.useCitizenInformation
      ? citizenInformation
      : undefined,
    useCitizenInformation: settings.useCitizenInformation,
    signal,
  };
}

function asRecord(session: ActiveSession): ChatSessionRecord {
  if (!session.id) throw new Error("Cannot persist a chat without a session ID.");
  return { ...session, id: session.id };
}

function applyDcrToolEvidence(
  messages: readonly StoredChatMessage[],
  evidenceItems: readonly DcrToolEvidence[],
  existing: Readonly<Record<string, ChatMessageEnrichment>>,
): { messages: StoredChatMessage[]; enrichment: Record<string, ChatMessageEnrichment> } {
  const nextMessages = [...messages];
  const enrichment = { ...existing };

  for (const evidence of evidenceItems) {
    const index = nextMessages.findIndex(
      ({ historyIndex }) => historyIndex === evidence.historyIndex,
    );
    if (index < 0) continue;
    const message = nextMessages[index]!;
    const update: ChatMessageEnrichment = {
      ...enrichment[message.id],
      supportingContent: evidence.supportingContent,
      citations: evidence.citations,
    };
    nextMessages[index] = { ...message, ...update };
    enrichment[message.id] = update;
  }

  return { messages: nextMessages, enrichment };
}

function messageId(prefix: string): string {
  localMessageSequence += 1;
  return `${prefix}-${Date.now()}-${localMessageSequence}`;
}

function clearCandidateChoices(session: ActiveSession): ActiveSession {
  return {
    ...session,
    messages: session.messages.map((message) =>
      message.candidates?.length ? { ...message, candidates: undefined } : message,
    ),
    candidates: [],
  };
}

function discardUncommitted(session: ActiveSession): ActiveSession {
  return {
    ...session,
    messages: session.messages.filter(({ archived, historyIndex }) =>
      archived || historyIndex !== undefined),
  };
}

function titleFromFirstQuestion(session: ActiveSession, text: string): string {
  if (session.messages.some(({ role }) => role === "user")) return session.title;
  const shortened = text.length > 64 ? `${text.slice(0, 61)}…` : text;
  return shortened || session.title;
}

function inputLockReason(session: ActiveSession): string | undefined {
  if (session.mode === "dcr" && !session.id) return "Initializing the DCR process…";
  if (!session.id || !session.graphXml) return undefined;

  if (isRobotActivity(session.graphXml, session.pendingActivityId)) {
    return session.selectedRole === "Caseworker"
      ? undefined
      : "A Robot activity is awaiting confirmation. Switch DCR Role to Caseworker to continue.";
  }

  const requiredRole = canonicalizeDcrRole(session.pendingActivityRole);
  if (session.pendingActivityId && requiredRole && requiredRole !== session.selectedRole) {
    return `Switch DCR Role to ${requiredRole} to continue this activity.`;
  }
  if (session.pendingActivityId) return undefined;
  if (isComplete(session.messages)) return "The process is complete.";
  return `No activities are enabled for ${session.selectedRole}. You must wait or switch DCR Role.`;
}

function isComplete(messages: readonly StoredChatMessage[]): boolean {
  return [...messages].reverse().some(({ role, content }) =>
    role !== "user" && /the process is complete!?\s*$/i.test(content.trim()),
  );
}

function freshDirectGraph(
  session: ActiveSession,
  launch: ChatLaunchConfig,
): string | undefined {
  if (
    launch.mode === "dcr"
    && launch.graphName === session.graphName
  ) return launch.graphXml;
  return session.graphXml;
}

function draftAfterExpiry(session: ActiveSession): ActiveSession {
  const isDirect = session.mode === "dcr";
  return {
    mode: session.mode,
    title: isDirect
      ? session.graphName ?? "DCR Graph Chat"
      : session.mode === "rag" ? "Pure RAG Chat" : "DCR Chat",
    updatedAt: Date.now(),
    selectedRole: session.selectedRole,
    robotAutoExecutionsPerActivity: session.robotAutoExecutionsPerActivity,
    activityRepetitions: session.activityRepetitions,
    graphName: isDirect ? session.graphName : undefined,
    graphXml: isDirect ? session.graphXml : undefined,
    messages: [],
    enrichment: {},
    candidates: [],
    candidateDescriptions: {},
  };
}

function automaticRobotNotice(labels: readonly string[]): string {
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length === 1) {
    const count = labels.length === 1 ? "" : ` ${labels.length} times`;
    return `Robot activity “${uniqueLabels[0]}” was executed automatically${count}.`;
  }
  return `${labels.length} Robot activities were executed automatically: ${uniqueLabels
    .map((label) => `“${label}”`)
    .join(", ")}.`;
}

function isAbortError(reason: unknown): boolean {
  return (
    reason instanceof DOMException && reason.name === "AbortError"
  ) || (
    typeof reason === "object"
    && reason !== null
    && "name" in reason
    && reason.name === "AbortError"
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The chat request failed.";
}

import type { ReactNode } from "react";

export type ChatMode = "dcr-controller" | "rag" | "dcr";
export type ChatMessageRole = "user" | "assistant" | "robot" | "system";
export type DcrRole = "Citizen" | "Caseworker";
export type SearchIndex = "All" | "Relevant laws" | "Similar cases";
export type ChatInput = string | number | boolean;
export type ExpectedAnswerType = "int" | "bool";

export const DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY = 1;
export const DEFAULT_ACTIVITY_REPETITIONS = 0;

export interface GraphCandidate {
  id: string;
  description: string;
  source: string;
}

export interface ChatCitation {
  id: string;
  title: string;
  source: string;
  page?: number;
  url?: string;
  kind?: "law" | "case" | "web" | "other";
  excerpt?: string;
}

export interface SupportingContentItem {
  id: string;
  title: string;
  content: string;
  source?: string;
  url?: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

/** A flat message model keeps backend history ordering intact. */
export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  interpretedValue?: string;
  dcrRole?: string;
  createdAt?: string;
  supportingContent?: readonly SupportingContentItem[];
  citations?: readonly ChatCitation[];
  followups?: readonly string[];
  candidates?: readonly GraphCandidate[];
  editable?: boolean;
  answerType?: ExpectedAnswerType;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  mode: ChatMode;
  updatedAt?: string;
  preview?: string;
  graphName?: string;
}

export interface ChatSettings {
  dcrRole: DcrRole;
  robotAutoExecutionsPerActivity: number;
  activityRepetitions: number;
  useCitizenInformation: boolean;
  searchIndex: SearchIndex;
  suggestFollowupQuestions: boolean;
  retrieveCount: number;
  minimumSearchScore: number;
}

export type ChatCallbackResult = void | Promise<void>;

export interface ChatAppProps {
  mode: ChatMode;
  messages: readonly ChatMessage[];
  settings: ChatSettings;
  sessions?: readonly ChatSessionSummary[];
  activeSessionId?: string;
  title?: string;
  loading?: boolean;
  error?: string | null;
  notice?: string | null;
  inputDisabled?: boolean;
  inputDisabledReason?: string;
  placeholder?: string;
  graphPanel?: ReactNode;
  citationPanel?: ReactNode;
  hasCachedCitizenInformation?: boolean;
  expectedAnswerType?: ExpectedAnswerType;
  onSend: (input: ChatInput) => ChatCallbackResult;
  onEditAnswer?: (messageId: string, input: ChatInput) => ChatCallbackResult;
  onClear: () => ChatCallbackResult;
  onSettingsChange: (settings: ChatSettings) => ChatCallbackResult;
  onSelectSession: (sessionId: string) => ChatCallbackResult;
  onDeleteSession: (sessionId: string) => ChatCallbackResult;
  onDeleteAllSessions: () => ChatCallbackResult;
  onSelectCandidate: (candidate: GraphCandidate, message: ChatMessage) => ChatCallbackResult;
  onFollowup: (question: string, message: ChatMessage) => ChatCallbackResult;
  onCitationSelect: (citation: ChatCitation, message: ChatMessage) => ChatCallbackResult;
  onBack?: () => ChatCallbackResult;
  onStop?: () => ChatCallbackResult;
}

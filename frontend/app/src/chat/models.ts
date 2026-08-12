export type ChatSessionMode = "dcr-controller" | "rag" | "dcr";
export type DcrUserRole = "Citizen" | "Caseworker";

export interface StoredChatCitation {
  id: string;
  title: string;
  source: string;
  page?: number;
  url?: string;
  kind?: "law" | "case" | "web" | "other";
  excerpt?: string;
}

export interface StoredSupportingContent {
  id: string;
  title: string;
  content: string;
  source?: string;
  url?: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface StoredGraphCandidate {
  id: string;
  description: string;
  source: string;
}

/** Serializable counterpart of the presentation package's ChatMessage. */
export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant" | "robot" | "system";
  content: string;
  interpretedValue?: string;
  dcrRole?: string;
  createdAt?: string;
  historyIndex?: number;
  /** Keeps deliberately sanitized controller answers authoritative in the UI. */
  contentOverride?: boolean;
  supportingContent?: readonly StoredSupportingContent[];
  citations?: readonly StoredChatCitation[];
  followups?: readonly string[];
  candidates?: readonly StoredGraphCandidate[];
}

export interface ChatMessageEnrichment {
  supportingContent?: readonly StoredSupportingContent[];
  citations?: readonly StoredChatCitation[];
  followups?: readonly string[];
  candidates?: readonly StoredGraphCandidate[];
}

export interface ChatSessionRecord {
  id: string;
  mode: ChatSessionMode;
  title: string;
  updatedAt: number;
  selectedRole: DcrUserRole;
  robotAutoExecutionsPerActivity: number;
  graphName?: string;
  graphXml?: string;
  pendingActivityId?: string;
  pendingActivityRole?: string;
  messages: readonly StoredChatMessage[];
  enrichment: Readonly<Record<string, ChatMessageEnrichment>>;
  candidates: readonly StoredGraphCandidate[];
  /** Keeps backend graph filenames out of restored user-facing messages. */
  candidateDescriptions: Readonly<Record<string, string>>;
}

export type ChatMessageSnapshot = StoredChatMessage;

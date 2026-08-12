import type { ChatHistoryEntry, RagEvidence, RagSearchIndex } from "../api/chat";
import type {
  ChatMessageEnrichment,
  StoredChatCitation,
  StoredChatMessage,
  StoredSupportingContent,
} from "./models";

export type DcrToolCall = "find_relevant_laws" | "find_similar_cases";

export interface DcrActivityMetadata {
  id: string;
  label: string;
  role?: string;
  toolCall?: string;
  included: boolean;
  pending: boolean;
  executed: boolean;
}

export interface NormalizedEvidence {
  supportingContent: StoredSupportingContent[];
  citations: StoredChatCitation[];
}

export interface DcrToolEvidence extends NormalizedEvidence {
  activityId: string;
  historyIndex: number;
  toolCall: DcrToolCall;
  text: string;
}

export interface AutomaticRobotExecution {
  activityId?: string;
  activityLabel: string;
  historyIndex: number;
  message: string;
}

export interface ParsedCitation {
  citation: string;
  source: string;
  page?: number;
}

export function canonicalizeDcrRole(role: string | null | undefined): string | undefined {
  const trimmed = role?.trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLocaleLowerCase().replace(/[\s_-]+/g, "");
  if (key === "caseworker") return "Caseworker";
  if (key === "citizen") return "Citizen";
  if (key === "robot") return "Robot";
  return trimmed;
}

/** Returns the graph's spelling so the backend's exact role comparison succeeds. */
export function resolveGraphDcrRole(role: string, graphXml?: string): string {
  const canonical = canonicalizeDcrRole(role) ?? role;
  if (!graphXml) return canonical;

  const graphRole = parseDcrActivities(graphXml)
    .flatMap((activity) => activity.role?.split(",") ?? [])
    .map((value) => value.trim())
    .find((value) => canonicalizeDcrRole(value) === canonical);
  return graphRole ?? canonical;
}

export function parseDcrActivities(graphXml: string): DcrActivityMetadata[] {
  if (!graphXml.trim() || typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(graphXml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) return [];

  return Array.from(document.getElementsByTagName("*"))
    .filter((element) => ["event", "subProcess", "nesting"].includes(element.localName))
    .flatMap((element) => {
      const id = element.getAttribute("id");
      if (!id) return [];
      return [{
        id,
        label: element.getAttribute("label") ?? element.getAttribute("description") ?? id,
        role: element.getAttribute("role") ?? undefined,
        toolCall: element.getAttribute("toolCall") ?? undefined,
        included: xmlBoolean(element.getAttribute("included"), true),
        pending: xmlBoolean(element.getAttribute("pending"), false),
        executed: xmlBoolean(element.getAttribute("executed"), false),
      }];
    });
}

export function isRobotActivity(graphXml: string | undefined, activityId: string | undefined): boolean {
  if (!graphXml || !activityId) return false;
  const activity = parseDcrActivities(graphXml).find((item) => item.id === activityId);
  return canonicalizeDcrRole(activity?.role) === "Robot";
}

export function normalizeRagEvidence(evidence: readonly RagEvidence[]): NormalizedEvidence {
  return evidence.reduce<NormalizedEvidence>((result, item, index) => {
    const id = `rag-${index}-${encodeURIComponent(item.source)}-${item.page}`;
    const kind = evidenceKind(item.index);
    const metadata: Record<string, string | number | boolean | null> = {
      index: item.index,
      page: item.page,
      score: item.score,
      outcome: item.outcome,
    };
    result.supportingContent.push({
      id: `support-${id}`,
      title: sourceTitle(item.source),
      content: item.excerpt,
      source: item.source,
      metadata,
    });
    result.citations.push({
      id: `citation-${id}`,
      title: sourceTitle(item.source),
      source: item.source,
      page: item.page,
      kind,
      excerpt: item.excerpt,
    });
    return result;
  }, { supportingContent: [], citations: [] });
}

export function ragEvidenceToSupportingContent(
  evidence: readonly RagEvidence[],
): StoredSupportingContent[] {
  return normalizeRagEvidence(evidence).supportingContent;
}

export function ragEvidenceToCitations(evidence: readonly RagEvidence[]): StoredChatCitation[] {
  return normalizeRagEvidence(evidence).citations;
}

export function extractBracketCitations(text: string): ParsedCitation[] {
  const citations: ParsedCitation[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]\r\n]+)\]/g)) {
    const value = match[1]?.trim();
    const citation = match[0];
    const pageMatch = value?.match(/^(.*)#page=(\d+)$/);
    const source = (pageMatch?.[1] ?? value)?.trim();
    if (!source || seen.has(citation)) continue;
    seen.add(citation);
    citations.push({
      citation,
      source,
      page: pageMatch?.[2] ? Number(pageMatch[2]) : undefined,
    });
  }
  return citations;
}

/** Extracts newly executed legal-search Robot results from backend history. */
export function extractDcrToolEvidence(
  previousHistory: readonly ChatHistoryEntry[],
  currentHistory: readonly ChatHistoryEntry[],
  graphXml: string,
): DcrToolEvidence[] {
  const startIndex = commonHistoryPrefix(previousHistory, currentHistory);
  const tools = parseDcrActivities(graphXml).filter(isSupportedToolActivity);

  return currentHistory.slice(startIndex).flatMap((entry, offset) => {
    if (
      entry.chat_role !== "assistant"
      || canonicalizeDcrRole(entry.dcr_role) !== "Robot"
    ) return [];

    const activity = tools.find((item) => robotHistoryMatches(entry.item, item.label));
    if (!activity || !isDcrToolCall(activity.toolCall)) return [];
    const historyIndex = startIndex + offset;
    const text = robotResult(entry.item);
    const kind = evidenceKind(activity.toolCall);
    const citations = extractBracketCitations(text).map((citation, index) => ({
      id: `dcr-${historyIndex}-${index}-${encodeURIComponent(citation.source)}`,
      title: sourceTitle(citation.source),
      source: citation.source,
      page: citation.page,
      kind,
      excerpt: text,
    }));
    return [{
      activityId: activity.id,
      historyIndex,
      toolCall: activity.toolCall,
      text,
      supportingContent: [{
        id: `dcr-support-${historyIndex}-${activity.id}`,
        title: activity.label,
        content: text,
        metadata: { toolCall: activity.toolCall, activityId: activity.id },
      }],
      citations,
    }];
  });
}

/** Returns only Robot executions the backend performed without confirmation. */
export function extractAutomaticRobotExecutions(
  previousHistory: readonly ChatHistoryEntry[],
  currentHistory: readonly ChatHistoryEntry[],
): AutomaticRobotExecution[] {
  const startIndex = commonHistoryPrefix(previousHistory, currentHistory);

  return currentHistory.slice(startIndex).flatMap((entry, offset) => {
    const metadata = entry.metadata;
    const executionType = metadata?.robot_execution;
    const isRobotExecution = executionType === true || executionType === "automatic";
    const isAutomatic = metadata?.automatic === true || executionType === "automatic";
    if (
      canonicalizeDcrRole(entry.dcr_role) !== "Robot"
      || !isRobotExecution
      || !isAutomatic
    ) return [];

    const activityId = stringMetadata(metadata?.activity_id);
    const activityLabel = stringMetadata(metadata?.activity_label)
      ?? robotActivityLabel(entry.item)
      ?? activityId
      ?? "Robot activity";
    return [{
      activityId,
      activityLabel,
      historyIndex: startIndex + offset,
      message: entry.item,
    }];
  });
}

/** Merges authoritative backend text with locally persisted rich response data. */
export function mergeChatHistory(
  history: readonly ChatHistoryEntry[],
  storedMessages: readonly StoredChatMessage[] = [],
  candidateDescriptions: Readonly<Record<string, string>> = {},
  enrichment: Readonly<Record<string, ChatMessageEnrichment>> = {},
): StoredChatMessage[] {
  const messages = history.map((entry, historyIndex) => {
    const stored = storedMessages.find((message) => message.historyIndex === historyIndex)
      ?? storedMessages[historyIndex];
    const id = stored?.id ?? `history-${historyIndex}`;
    const localEnrichment = enrichment[id];
    const role = historyRole(entry);
    const hiddenCandidate = role === "user" ? candidateDescriptions[entry.item] : undefined;
    const locallySanitized = stored?.contentOverride ? stored.content : undefined;

    return {
      ...stored,
      ...localEnrichment,
      id,
      historyIndex,
      role,
      content: hiddenCandidate ?? locallySanitized ?? entry.item,
      dcrRole: canonicalizeDcrRole(entry.dcr_role),
    };
  });

  return messages.reduce<StoredChatMessage[]>((visible, message, historyIndex) => {
    if (history[historyIndex]?.metadata?.interpreted !== true) {
      visible.push(message);
      return visible;
    }

    const userIndex = visible.findLastIndex(({ role }) => role === "user");
    if (userIndex < 0) return visible;
    const userMessage = visible[userIndex]!;
    visible[userIndex] = {
      ...userMessage,
      interpretedValue: interpretedValue(message.content),
    };
    return visible;
  }, []);
}

function interpretedValue(content: string): string {
  return content.replace(/^Interpreted as\s*/i, "").trim() || content;
}

function historyRole(entry: ChatHistoryEntry): StoredChatMessage["role"] {
  if (canonicalizeDcrRole(entry.dcr_role) === "Robot") return "robot";
  if (entry.chat_role === "user") return "user";
  if (entry.chat_role === "system") return "system";
  return "assistant";
}

function commonHistoryPrefix(
  previous: readonly ChatHistoryEntry[],
  current: readonly ChatHistoryEntry[],
): number {
  let index = 0;
  while (index < previous.length && index < current.length) {
    const left = previous[index];
    const right = current[index];
    if (
      left.item !== right.item
      || left.chat_role !== right.chat_role
      || left.dcr_role !== right.dcr_role
    ) break;
    index += 1;
  }
  return index;
}

function robotHistoryMatches(historyItem: string, label: string): boolean {
  return historyItem.startsWith(`Robot activity ${label} answering `);
}

function robotResult(historyItem: string): string {
  const marker = " executed with ";
  const markerIndex = historyItem.indexOf(marker);
  return markerIndex < 0 ? historyItem : historyItem.slice(markerIndex + marker.length);
}

function robotActivityLabel(historyItem: string): string | undefined {
  return historyItem.match(/^Robot activity (.*?) (?:answering|executed)/)?.[1]?.trim()
    || undefined;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSupportedToolActivity(
  activity: DcrActivityMetadata,
): activity is DcrActivityMetadata & { toolCall: DcrToolCall } {
  return canonicalizeDcrRole(activity.role) === "Robot" && isDcrToolCall(activity.toolCall);
}

function isDcrToolCall(value: string | undefined): value is DcrToolCall {
  return value === "find_relevant_laws" || value === "find_similar_cases";
}

function evidenceKind(index: RagSearchIndex | DcrToolCall): "law" | "case" {
  return index === "find_relevant_laws" ? "law" : "case";
}

function xmlBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value.toLocaleLowerCase() === "true";
}

function sourceTitle(source: string): string {
  const filename = source.split(/[\\/]/).pop() || source;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

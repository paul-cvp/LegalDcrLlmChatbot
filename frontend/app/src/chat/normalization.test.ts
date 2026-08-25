import { describe, expect, it } from "vitest";

import type { ChatHistoryEntry, RagEvidence } from "../api/chat";
import {
  canonicalizeDcrRole,
  extractAutomaticRobotExecutions,
  extractBracketCitations,
  extractDcrToolEvidence,
  expectedDcrAnswerType,
  isRobotActivity,
  mergeChatHistory,
  normalizeRagEvidence,
  parseDcrActivities,
  resolveGraphDcrRole,
} from "./normalization";

const GRAPH_XML = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
  <dcr:dcrGraph id="graph">
    <dcr:event id="case" label="Review" role="Case worker" included="true" />
    <dcr:event id="law" label="Relevant laws" role="Robot"
      toolCall="find_relevant_laws" included="true" pending="true" />
  </dcr:dcrGraph>
</dcr:definitions>`;

const ALL_TOOLS_GRAPH_XML = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
  <dcr:dcrGraph id="graph">
    <dcr:event id="Event_law" label="Relevant laws" role="Robot"
      toolCall="find_relevant_laws" included="true" />
    <dcr:event id="Event_cases" label="Similar cases" role="Citizen"
      toolCall="find_similar_cases" included="true" />
    <dcr:event id="Event_summary" label="Case summary" role="Case worker"
      toolCall="summarize_case_history" included="true" />
    <dcr:event id="Event_review" label="Review" role="Case worker" included="true" />
  </dcr:dcrGraph>
</dcr:definitions>`;

function history(
  item: string,
  chatRole = "assistant",
  dcrRole: string | null = null,
): ChatHistoryEntry {
  return { item, chat_role: chatRole, dcr_role: dcrRole, metadata: null };
}

describe("DCR normalization", () => {
  it("canonicalizes frontend roles but sends the graph's spelling", () => {
    expect(canonicalizeDcrRole(" Case worker ")).toBe("Caseworker");
    expect(resolveGraphDcrRole("Caseworker", GRAPH_XML)).toBe("Case worker");
    expect(isRobotActivity(GRAPH_XML, "law")).toBe(true);
    expect(isRobotActivity(GRAPH_XML, "case")).toBe(false);
  });

  it("detects typed answers and Robot permission answers", () => {
    const graph = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr"><dcr:dcrGraph id="typed">
      <dcr:event id="age" role="Citizen"><dcr:eventData name="age" type="Int" /></dcr:event>
      <dcr:event id="eligible" role="Citizen"><dcr:eventData name="eligible" type="Bool" /></dcr:event>
      <dcr:event id="robot" role="Robot"><dcr:eventData name="result" type="String" /></dcr:event>
    </dcr:dcrGraph></dcr:definitions>`;

    expect(expectedDcrAnswerType(graph, "age")).toBe("int");
    expect(expectedDcrAnswerType(graph, "eligible")).toBe("bool");
    expect(expectedDcrAnswerType(graph, "robot")).toBe("bool");
    expect(parseDcrActivities(graph).every(({ trusted }) => trusted)).toBe(true);
  });

  it("normalizes RAG evidence for both analysis panels", () => {
    const evidence: RagEvidence[] = [{
      index: "find_relevant_laws",
      source: "laws/support.pdf",
      page: 2,
      citation: "[laws/support.pdf#page=2]",
      excerpt: "Legal excerpt",
      score: 0.9,
      outcome: null,
    }];

    expect(normalizeRagEvidence(evidence)).toEqual({
      supportingContent: [{
        id: "support-rag-0-laws%2Fsupport.pdf-2",
        title: "support.pdf",
        content: "Legal excerpt",
        source: "laws/support.pdf",
        metadata: {
          index: "find_relevant_laws",
          page: 2,
          score: 0.9,
          outcome: null,
        },
      }],
      citations: [{
        id: "citation-rag-0-laws%2Fsupport.pdf-2",
        title: "support.pdf",
        source: "laws/support.pdf",
        page: 2,
        kind: "law",
        excerpt: "Legal excerpt",
      }],
    });
  });

  it("diffs Robot tool history and parses its citations", () => {
    const previous = [history("Question", "user", "Citizen")];
    const result = "The rule applies [laws/support.pdf#page=4].";
    const current = [
      ...previous,
      history(
        `Robot activity Relevant laws answering Find law executed with ${result}`,
        "assistant",
        "Robot",
      ),
    ];

    expect(extractDcrToolEvidence(previous, current, GRAPH_XML)).toEqual([{
      activityId: "law",
      historyIndex: 1,
      toolCall: "find_relevant_laws",
      text: result,
      supportingContent: [{
        id: "dcr-support-1-law",
        title: "Relevant laws",
        content: result,
        metadata: { toolCall: "find_relevant_laws", activityId: "law" },
      }],
      citations: [{
        id: "dcr-1-0-laws%2Fsupport.pdf",
        title: "support.pdf",
        source: "laws/support.pdf",
        page: 4,
        kind: "law",
        excerpt: result,
      }],
    }]);
    expect(extractBracketCitations("[case.json] [case.json]")).toEqual([{
      citation: "[case.json]",
      source: "case.json",
      page: undefined,
    }]);
  });

  it("extracts every tool result by activity metadata and backend message shape", () => {
    const previous = [history("Start", "user", "Citizen")];
    const current: ChatHistoryEntry[] = [
      ...previous,
      toolHistory(
        "law",
        "Relevant laws",
        "Robot",
        "Robot activity Relevant laws answering query 'What applies?'executed with data 'Law result [laws/support.pdf#page=4]'.",
      ),
      toolHistory(
        "cases",
        "Similar cases",
        "Citizen",
        "Robot activity Similar cases executed with data 'Case result [cases/example.json]'.",
      ),
      toolHistory(
        "summary",
        "Case summary",
        "Case worker",
        "Robot activity Case summary answering query 'Summarize' toward completion executed with data 'Summary [laws/summary.pdf#page=2]'.",
      ),
      toolHistory(
        "review",
        "Review",
        "Case worker",
        "Robot activity Review executed with data 'Reviewed'.",
      ),
    ];

    const evidence = extractDcrToolEvidence(previous, current, ALL_TOOLS_GRAPH_XML);

    expect(evidence.map(({ activityId, toolCall, text }) => ({
      activityId,
      toolCall,
      text,
    }))).toEqual([
      {
        activityId: "Event_law",
        toolCall: "find_relevant_laws",
        text: "Law result [laws/support.pdf#page=4]",
      },
      {
        activityId: "Event_cases",
        toolCall: "find_similar_cases",
        text: "Case result [cases/example.json]",
      },
      {
        activityId: "Event_summary",
        toolCall: "summarize_case_history",
        text: "Summary [laws/summary.pdf#page=2]",
      },
    ]);
    expect(evidence.map(({ supportingContent }) => supportingContent[0]?.content))
      .toEqual(evidence.map(({ text }) => text));
    expect(evidence.map(({ citations }) => citations[0]?.kind))
      .toEqual(["law", "case", "other"]);
  });

  it("diffs automatic Robot executions but ignores Caseworker confirmations", () => {
    const previous = [history("Start", "user", "Citizen")];
    const automatic: ChatHistoryEntry = {
      item: "Robot activity Check law answering request executed with result",
      chat_role: "assistant",
      dcr_role: "Robot",
      metadata: {
        robot_execution: true,
        automatic: true,
        activity_id: "law",
        activity_label: "Check law",
      },
    };
    const confirmed: ChatHistoryEntry = {
      ...automatic,
      item: "Robot activity Check case answering request executed with result",
      metadata: {
        robot_execution: true,
        automatic: false,
        activity_id: "case",
        activity_label: "Check case",
      },
    };

    expect(extractAutomaticRobotExecutions(previous, [
      ...previous,
      automatic,
      confirmed,
    ])).toEqual([{
      activityId: "law",
      activityLabel: "Check law",
      historyIndex: 1,
      message: automatic.item,
    }]);
  });

  it("restores rich messages while hiding selected graph filenames", () => {
    const backendHistory = [
      history("private.xml", "user", "Citizen"),
      history("Robot result", "assistant", "Robot"),
      history("Next question", "assistant", "Citizen"),
    ];
    const stored = [{
      id: "selection",
      role: "user" as const,
      content: "Graph description",
      historyIndex: 0,
    }, {
      id: "robot",
      role: "robot" as const,
      content: "Robot result",
      historyIndex: 1,
      citations: [{ id: "c", title: "Law", source: "law.pdf" }],
    }];

    const merged = mergeChatHistory(
      backendHistory,
      stored,
      { "private.xml": "Graph description" },
    );

    expect(merged.map((message) => [message.role, message.content])).toEqual([
      ["user", "Graph description"],
      ["robot", "Robot result"],
      ["assistant", "Next question"],
    ]);
    expect(merged[1]?.citations).toHaveLength(1);
  });

  it("attaches interpreted history metadata to the preceding user answer", () => {
    const backendHistory: ChatHistoryEntry[] = [
      history("we shook hands", "user"),
      {
        item: "Interpreted as True",
        chat_role: "assistant",
        dcr_role: "Citizen",
        metadata: { interpreted: true },
      },
      history("When did this happen?", "assistant", "Citizen"),
    ];

    const merged = mergeChatHistory(backendHistory);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      role: "user",
      content: "we shook hands",
      interpretedValue: "True",
      historyIndex: 0,
    });
    expect(merged[1]).toMatchObject({
      role: "assistant",
      content: "When did this happen?",
      historyIndex: 2,
    });
  });

  it("preserves edit checkpoints after hidden interpretation entries", () => {
    const checkpoint = {
      graphXml: GRAPH_XML,
      pendingActivityId: "case",
      selectedRole: "Citizen" as const,
    };
    const stored = [
      { id: "first", role: "user" as const, content: "first", historyIndex: 0 },
      { id: "question", role: "assistant" as const, content: "Next?", historyIndex: 2 },
      { id: "second", role: "user" as const, content: "second", checkpoint, editable: true },
    ];
    const backendHistory: ChatHistoryEntry[] = [
      history("first", "user", "Citizen"),
      { item: "Interpreted as True", chat_role: "assistant", dcr_role: "Citizen", metadata: { interpreted: true } },
      history("Next?", "assistant", "Citizen"),
      history("second", "user", "Citizen"),
    ];

    const merged = mergeChatHistory(backendHistory, stored);

    expect(merged.at(-1)).toMatchObject({
      id: "second",
      editable: true,
      checkpoint,
      historyIndex: 3,
    });
  });
});

function toolHistory(
  activityId: string,
  activityLabel: string,
  dcrRole: string,
  item: string,
): ChatHistoryEntry {
  return {
    item,
    chat_role: "assistant",
    dcr_role: dcrRole,
    metadata: {
      activity_id: activityId,
      activity_label: activityLabel,
    },
  };
}

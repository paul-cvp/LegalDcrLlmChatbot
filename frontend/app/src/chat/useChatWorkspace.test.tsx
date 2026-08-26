import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatSettings } from "@dcr-js/chat";
import { ChatApiClient, type ChatHistoryEntry } from "../api/chat";
import { ChatWorkspaceController } from "./ChatWorkspaceController";
import { ChatSessionRepository } from "./sessionRepository";
import {
  type ChatWorkspace,
  useChatWorkspace,
} from "./useChatWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const GRAPH_XML = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
  <dcr:dcrGraph id="support">
    <dcr:event id="robot" label="Check law" role="Robot" toolCall="find_relevant_laws" included="true" />
    <dcr:event id="case" label="Review" role="Case worker" included="true" />
  </dcr:dcrGraph>
</dcr:definitions>`;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("useChatWorkspace", () => {
  it("hides controller filenames and preserves Robot confirmation for Caseworker", async () => {
    let history: ChatHistoryEntry[] = historyEntries([
      ["I need support", "user", null],
      ["Option 1 covers applications for financial support.", "assistant", null],
    ]);
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/history")) return Response.json(history);
      if (path.endsWith("/response")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push(body);
        if (body.chat_type === 2) {
          return Response.json({
            text: "Option 1 covers applications for financial support.",
            session_id: "controller-session",
            graphs: [{
              graph_id: "support",
              source: "private-support.xml",
              format: "xml",
              score: 0.99,
              excerpt: "event | id: Event_123 | role: Robot | included: true",
            }],
          });
        }
        if (body.text === "private-support.xml") {
          history = historyEntries([
            ["I need support", "user", null],
            ["Choose [private-support.xml]", "assistant", null],
            ["private-support.xml", "user", "Citizen"],
            ["May the Robot check the law?", "assistant", "Citizen"],
          ]);
          return Response.json({
            text: "May the Robot check the law?",
            session_id: "controller-session",
            graph_xml: GRAPH_XML,
            act_id: "robot",
            dcr_role: "Citizen",
          });
        }
        history = [
          ...history,
          ...historyEntries([
            ["Yes interpreted as Robot permission True", "user", "Case worker"],
          ]),
          {
            item: "Robot activity Check law answering request executed with result",
            chat_role: "assistant",
            dcr_role: "Robot",
            metadata: {
              robot_execution: true,
              automatic: false,
              activity_id: "robot",
              activity_label: "Check law",
            },
          },
          ...historyEntries([["The process is complete!", "assistant", "Case worker"]]),
        ];
        return Response.json({
          text: "The process is complete!",
          session_id: "controller-session",
          graph_xml: GRAPH_XML,
          act_id: null,
          dcr_role: null,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const controller = createController(fetcher);
    const workspace = await renderWorkspace(
      { mode: "dcr-controller" },
      controller,
      false,
      "Cached citizen profile",
    );

    await act(async () => workspace.current.updateSettings({
      ...workspace.current.settings,
      useCitizenInformation: true,
      useChatHistory: false,
      useChatData: false,
    }));
    await act(async () => workspace.current.send("I need support"));
    expect(requests[0]).toMatchObject({
      citizen_information: "Cached citizen profile",
      metadata: {
        use_chat_history: false,
        use_trace_data: false,
        use_citizen_data: true,
      },
    });
    const candidate = workspace.current.messages[1]?.candidates?.[0];
    expect(candidate?.description).toBe("Option 1");
    expect(workspace.current.messages[1]?.content).toBe(
      "Option 1 covers applications for financial support.",
    );
    expect(workspace.current.messages[1]?.content).not.toContain("Event_123");
    expect(workspace.current.messages[1]?.content).not.toContain("private-support.xml");

    await act(async () => workspace.current.selectCandidate(candidate!));
    expect(requests[1]).toMatchObject({
      robot_auto_limit: 1,
      activity_repeat_limit: 0,
      citizen_information: "Cached citizen profile",
      metadata: {
        use_chat_history: false,
        use_trace_data: false,
        use_citizen_data: true,
      },
    });
    expect(workspace.current.messages[2]?.content).toBe("Option 1");
    expect(workspace.current.inputDisabledReason).toContain("Caseworker");
    const responseCount = requests.length;

    await act(async () => workspace.current.updateSettings({
      ...workspace.current.settings,
      dcrRole: "Caseworker",
    }));
    expect(requests).toHaveLength(responseCount);
    expect(workspace.current.inputDisabled).toBe(false);

    await act(async () => workspace.current.send("Yes"));
    expect(requests.at(-1)).toEqual({
      text: "Yes",
      session_id: "controller-session",
      act_id: "robot",
      dcr_role: "Case worker",
      robot_auto_limit: 1,
      activity_repeat_limit: 0,
      citizen_information: "Cached citizen profile",
      metadata: {
        use_chat_history: false,
        use_trace_data: false,
        use_citizen_data: true,
      },
    });
    expect(workspace.current.notice).toBeNull();
    expect(workspace.current.inputDisabledReason).toBe("The process is complete.");
  });

  it("bootstraps a direct graph without a fake user message", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/history")) {
        return Response.json(historyEntries([
          ["Please review the case", "assistant", "Citizen"],
        ]));
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return Response.json({
        text: "Please review the case",
        session_id: "direct-session",
        graph_xml: GRAPH_XML,
        act_id: "case",
        dcr_role: "Case worker",
      });
    });
    const workspace = await renderWorkspace(
      { mode: "dcr", graphName: "Support", graphXml: GRAPH_XML },
      createController(fetcher),
      true,
    );

    expect(requests[0]).toEqual({
      text: "",
      chat_type: 1,
      graph_xml: GRAPH_XML,
      dcr_role: "Citizen",
      robot_auto_limit: 1,
      activity_repeat_limit: 0,
      metadata: {
        use_chat_history: true,
        use_trace_data: true,
        use_citizen_data: false,
      },
    });
    expect(workspace.current.messages).toHaveLength(1);
    expect(workspace.current.messages[0]?.role).toBe("assistant");
  });

  it("sends widget answers as native values without an interpreted message", async () => {
    const typedGraph = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr"><dcr:dcrGraph id="typed"><dcr:event id="eligible" role="Citizen" included="true"><dcr:eventData name="eligible" type="Bool" /></dcr:event></dcr:dcrGraph></dcr:definitions>`;
    let history = historyEntries([["Are you eligible?", "assistant", "Citizen"]]);
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/history")) return Response.json(history);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.session_id) {
        history = historyEntries([
          ["Are you eligible?", "assistant", "Citizen"],
          ["True", "user", "Citizen"],
          ["The process is complete!", "assistant", "Citizen"],
        ]);
        return Response.json({
          text: "The process is complete!",
          session_id: "typed-session",
          graph_xml: typedGraph,
          act_id: null,
          dcr_role: null,
        });
      }
      return Response.json({
        text: "Are you eligible?",
        session_id: "typed-session",
        graph_xml: typedGraph,
        act_id: "eligible",
        dcr_role: "Citizen",
      });
    });
    const workspace = await renderWorkspace(
      { mode: "dcr", graphName: "Typed", graphXml: typedGraph },
      createController(fetcher),
      true,
    );

    expect(workspace.current.expectedAnswerType).toBe("bool");
    await act(async () => workspace.current.send(true));

    expect(requests.at(-1)?.text).toBe(true);
    expect(workspace.current.messages[1]).toMatchObject({
      role: "user",
      content: "Yes",
      editable: true,
    });
    expect(workspace.current.messages[1]).not.toHaveProperty("interpretedValue");
  });

  it("restores the pre-answer graph and replaces the session when editing", async () => {
    const initialGraph = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr"><dcr:dcrGraph id="edit"><dcr:event id="answer" role="Citizen" included="true" /></dcr:dcrGraph></dcr:definitions>`;
    const oldGraph = initialGraph.replace("</dcr:dcrGraph>", '<dcr:event id="next" role="Citizen" included="true" /></dcr:dcrGraph>');
    const revisedGraph = oldGraph.replace('id="edit"', 'id="revised"');
    const requests: Record<string, unknown>[] = [];
    const histories: Record<string, ChatHistoryEntry[]> = {
      "old-session": historyEntries([["Original question", "assistant", "Citizen"]]),
      "new-session": historyEntries([["Original question", "assistant", "Citizen"]]),
    };
    let starts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path.endsWith("/history")) {
        return Response.json(histories[body.session_id as string]);
      }
      if (path.endsWith("/session")) return new Response(null, { status: 204 });

      requests.push(body);
      if (body.chat_type === 1) {
        starts += 1;
        return Response.json({
          text: "Original question",
          session_id: starts === 1 ? "old-session" : "new-session",
          graph_xml: initialGraph,
          act_id: "answer",
          dcr_role: "Citizen",
        });
      }
      const sessionId = body.session_id as string;
      const revised = sessionId === "new-session";
      histories[sessionId] = historyEntries([
        ["Original question", "assistant", "Citizen"],
        [body.text as string, "user", "Citizen"],
        [revised ? "Revised next question" : "Old next question", "assistant", "Citizen"],
      ]);
      return Response.json({
        text: revised ? "Revised next question" : "Old next question",
        session_id: sessionId,
        graph_xml: revised ? revisedGraph : oldGraph,
        act_id: "next",
        dcr_role: "Citizen",
      });
    });
    const workspace = await renderWorkspace(
      { mode: "dcr", graphName: "Editable", graphXml: initialGraph },
      createController(fetcher),
      true,
    );

    await act(async () => workspace.current.send("Old answer"));
    const answer = workspace.current.messages.find(({ content }) => content === "Old answer");
    expect(answer?.editable).toBe(true);

    await act(async () => workspace.current.editAnswer(answer!.id, "New answer"));

    expect(requests.at(-2)).toMatchObject({
      chat_type: 1,
      graph_xml: initialGraph,
    });
    expect(requests.at(-1)).toMatchObject({
      session_id: "new-session",
      act_id: "answer",
      text: "New answer",
    });
    expect(workspace.current.activeSessionId).toBe("new-session");
    expect(workspace.current.graphXml).toBe(revisedGraph);
    expect(workspace.current.messages.map(({ content }) => content)).toEqual([
      "Original question",
      "New answer",
      "Revised next question",
    ]);
  });

  it("changes a non-Robot DCR role without executing the old activity", async () => {
    const roleGraph = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="roles">
        <dcr:event id="citizen" role="Citizen" included="true" />
        <dcr:event id="case" role="Case worker" included="true" />
      </dcr:dcrGraph>
    </dcr:definitions>`;
    let history = historyEntries([["Citizen question", "assistant", "Citizen"]]);
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/history")) return Response.json(history);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.chat_type === 1) {
        return Response.json({
          text: "Citizen question",
          session_id: "role-session",
          graph_xml: roleGraph,
          act_id: "citizen",
          dcr_role: "Citizen",
        });
      }
      history = [
        ...history,
        ...historyEntries([["Caseworker question", "assistant", "Case worker"]]),
      ];
      return Response.json({
        text: "Caseworker question",
        session_id: "role-session",
        graph_xml: roleGraph,
        act_id: "case",
        dcr_role: "Case worker",
      });
    });
    const workspace = await renderWorkspace(
      { mode: "dcr", graphName: "Roles", graphXml: roleGraph },
      createController(fetcher),
      true,
    );

    await act(async () => workspace.current.updateSettings({
      ...workspace.current.settings,
      dcrRole: "Caseworker",
    }));

    expect(requests.at(-1)).toEqual({
      text: "",
      session_id: "role-session",
      dcr_role: "Case worker",
      robot_auto_limit: 1,
      activity_repeat_limit: 0,
      metadata: {
        use_chat_history: true,
        use_trace_data: true,
        use_citizen_data: false,
      },
    });
    expect(workspace.current.messages.at(-1)?.content).toBe("Caseworker question");
  });

  it("shows automatic Robot executions and adopts their updated graph for any role", async () => {
    const updatedGraph = GRAPH_XML.replace(
      'id="robot"',
      'id="robot" executed="true"',
    );
    const history = [{
      item: "Robot activity Check law answering request executed with result",
      chat_role: "assistant",
      dcr_role: "Robot",
      metadata: {
        robot_execution: true,
        automatic: true,
        activity_id: "robot",
        activity_label: "Check law",
      },
    }, {
      item: "Robot activity Notify system answering update executed with done",
      chat_role: "assistant",
      dcr_role: "Robot",
      metadata: {
        robot_execution: true,
        automatic: true,
        activity_id: "notify",
        activity_label: "Notify system",
      },
    }, ...historyEntries([["Please review the result", "assistant", "Case worker"]])];
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/history")) return Response.json(history);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return Response.json({
        text: "Please review the result",
        session_id: "automatic-session",
        graph_xml: updatedGraph,
        act_id: "case",
        dcr_role: "Case worker",
      });
    });

    const workspace = await renderWorkspace(
      { mode: "dcr", graphName: "Automatic", graphXml: GRAPH_XML },
      createController(fetcher),
      true,
    );

    expect(requests[0]).toMatchObject({
      dcr_role: "Citizen",
      robot_auto_limit: 1,
    });
    expect(workspace.current.messages[0]).toMatchObject({
      role: "robot",
      content: expect.stringContaining("executed with result"),
    });
    expect(workspace.current.messages.filter(({ role }) => role === "robot"))
      .toHaveLength(2);
    expect(workspace.current.notice).toBe(
      "2 Robot activities were executed automatically: “Check law”, “Notify system”.",
    );
    expect(workspace.current.graphXml).toBe(updatedGraph);
  });

  it("persists and restores DCR execution limits", async () => {
    let history = historyEntries([["Find a graph", "user", null], ["Choose", "assistant", null]]);
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/history")) return Response.json(history);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.chat_type === 2) {
        return Response.json({
          text: "Choose",
          session_id: "limit-session",
          graphs: [{
            graph_id: "support",
            source: "support.xml",
            format: "xml",
            score: 1,
            excerpt: "Support process",
          }],
        });
      }
      history = [...history, ...historyEntries([
        ["support.xml", "user", "Citizen"],
        ["Continue", "assistant", "Citizen"],
      ])];
      return Response.json({
        text: "Continue",
        session_id: "limit-session",
        graph_xml: GRAPH_XML,
        act_id: "case",
        dcr_role: "Citizen",
      });
    });
    const controller = createController(fetcher);
    const workspace = await renderWorkspace({ mode: "dcr-controller" }, controller);

    await act(async () => workspace.current.updateSettings({
      ...workspace.current.settings,
      robotAutoExecutionsPerActivity: -1,
      activityRepetitions: 2,
    }));
    await act(async () => workspace.current.send("Find a graph"));
    await act(async () => workspace.current.selectCandidate(
      workspace.current.messages.at(-1)!.candidates![0]!,
    ));

    expect((await controller.getSession("limit-session"))?.robotAutoExecutionsPerActivity)
      .toBe(-1);
    expect(requests.at(-1)?.activity_repeat_limit).toBe(2);
    expect((await controller.getSession("limit-session"))?.activityRepetitions).toBe(2);
    await act(async () => workspace.current.selectSession("limit-session"));
    expect(workspace.current.settings.robotAutoExecutionsPerActivity).toBe(-1);
    expect(workspace.current.settings.activityRepetitions).toBe(2);
  });

  it("sends RAG metadata every turn and enriches the answer", async () => {
    let history = historyEntries([
      ["What applies?", "user", null],
      ["The law applies.", "assistant", null],
    ]);
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/history")) return Response.json(history);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.session_id) {
        history = [
          ...history,
          ...historyEntries([
            [body.text as string, "user", null],
            ["A follow-up answer.", "assistant", null],
          ]),
        ];
      }
      return Response.json({
        text: body.session_id ? "A follow-up answer." : "The law applies.",
        session_id: "rag-session",
        follow_up_questions: body.session_id
          ? []
          : ["I want to know what happens next."],
        evidence: [{
          index: "find_relevant_laws",
          source: "laws/support.pdf",
          page: 3,
          citation: "[laws/support.pdf#page=3]",
          excerpt: "Section 3 applies.",
          score: 0.91,
          outcome: "positive",
        }],
      });
    });
    const workspace = await renderWorkspace(
      { mode: "rag" },
      createController(fetcher),
      false,
      "Cached citizen profile",
    );

    await act(async () => workspace.current.updateSettings({
      ...workspace.current.settings,
      useCitizenInformation: true,
      useChatHistory: false,
      useChatData: false,
    }));
    await act(async () => workspace.current.send("What applies?"));
    const answer = workspace.current.messages.at(-1);
    expect(answer?.supportingContent?.[0]?.content).toBe("Section 3 applies.");
    expect(answer?.citations?.[0]).toMatchObject({
      source: "laws/support.pdf",
      page: 3,
      kind: "law",
    });
    expect(answer?.followups).toEqual(["I want to know what happens next."]);
    expect(requests[0]?.metadata).toEqual({
      search_indexes: ["find_relevant_laws", "find_similar_cases"],
      generate_followups: true,
      use_citizen_data: true,
      use_chat_history: false,
    });
    expect(requests[0]?.citizen_information).toBe("Cached citizen profile");

    const similarOnly: ChatSettings = {
      ...workspace.current.settings,
      searchIndex: "Similar cases",
      suggestFollowupQuestions: false,
    };
    await act(async () => workspace.current.updateSettings(similarOnly));
    await act(async () => workspace.current.send("And then?"));
    expect(requests.at(-1)?.metadata).toEqual({
      search_indexes: ["find_similar_cases"],
      generate_followups: false,
      use_citizen_data: true,
      use_chat_history: false,
    });
  });

  it("rebuilds every DCR tool result when restoring a session", async () => {
    const graphXml = `<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="tools">
        <dcr:event id="Event_law" label="Check law" role="Robot"
          toolCall="find_relevant_laws" included="true" />
        <dcr:event id="Event_summary" label="Case summary" role="Case worker"
          toolCall="summarize_case_history" trusted="false" included="true" />
      </dcr:dcrGraph>
    </dcr:definitions>`;
    const history: ChatHistoryEntry[] = [{
      item: "Robot activity Check law executed with data 'Rule [laws/rule.pdf#page=2]'.",
      chat_role: "assistant",
      dcr_role: "Robot",
      metadata: { activity_id: "law", activity_label: "Check law" },
    }, {
      item: "Robot activity Case summary executed with data 'Summary without sources'.",
      chat_role: "assistant",
      dcr_role: "Case worker",
      metadata: { activity_id: "summary", activity_label: "Case summary" },
    }];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/history")) return Response.json(history);
      throw new Error(`Unexpected request: ${input}`);
    });
    const controller = createController(fetcher);
    await controller.saveSession({
      id: "tools-session",
      mode: "dcr",
      title: "Tools",
      updatedAt: 1,
      selectedRole: "Citizen",
      robotAutoExecutionsPerActivity: 1,
      activityRepetitions: 0,
      graphXml,
      messages: [],
      enrichment: {},
      candidates: [],
      candidateDescriptions: {},
    });
    const workspace = await renderWorkspace({ mode: "rag" }, controller);

    await act(async () => workspace.current.selectSession("tools-session"));

    expect(workspace.current.messages[0]?.supportingContent?.[0]?.content)
      .toBe("Rule [laws/rule.pdf#page=2]");
    expect(workspace.current.messages[0]?.toolTrusted).toBe(true);
    expect(workspace.current.messages[0]?.citations?.[0]).toMatchObject({
      source: "laws/rule.pdf",
      page: 2,
      kind: "law",
    });
    expect(workspace.current.messages[1]?.supportingContent?.[0]?.content)
      .toBe("Summary without sources");
    expect(workspace.current.messages[1]?.toolTrusted).toBe(false);
    expect(workspace.current.messages[1]?.citations).toEqual([]);
  });

  it("deletes every stored chat session", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const controller = createController(fetcher);
    for (const id of ["session-1", "session-2"]) {
      await controller.saveSession({
        id,
        mode: "rag",
        title: id,
        updatedAt: 1,
        selectedRole: "Citizen",
        robotAutoExecutionsPerActivity: 1,
        activityRepetitions: 0,
        messages: [],
        enrichment: {},
        candidates: [],
        candidateDescriptions: {},
      });
    }
    const workspace = await renderWorkspace({ mode: "rag" }, controller);

    await act(async () => workspace.current.deleteAllSessions());

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await controller.listSessions()).toEqual([]);
    expect(workspace.current.sessions).toEqual([]);
  });

  it("reports and prunes backend sessions that have expired", async () => {
    const fetcher = vi.fn(async () => Response.json(
      { detail: "Chat session not found." },
      { status: 404 },
    ));
    const controller = createController(fetcher);
    await controller.saveSession({
      id: "expired",
      mode: "rag",
      title: "Expired chat",
      updatedAt: 1,
      selectedRole: "Citizen",
      robotAutoExecutionsPerActivity: 1,
      activityRepetitions: 0,
      messages: [],
      enrichment: {},
      candidates: [],
      candidateDescriptions: {},
    });
    const workspace = await renderWorkspace({ mode: "rag" }, controller);

    await act(async () => workspace.current.selectSession("expired"));

    expect(workspace.current.error).toContain("expired");
    expect(await controller.listSessions()).toEqual([]);
  });
});

function createController(fetcher: ReturnType<typeof vi.fn>): ChatWorkspaceController {
  return new ChatWorkspaceController(
    new ChatApiClient("/api/chat", fetcher as typeof fetch),
    new ChatSessionRepository(undefined),
  );
}

async function renderWorkspace(
  launch: Parameters<typeof useChatWorkspace>[0],
  controller: ChatWorkspaceController,
  waitForSession = false,
  citizenInformation = "",
): Promise<{ readonly current: ChatWorkspace }> {
  let current: ChatWorkspace | undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    current = useChatWorkspace(launch, controller, citizenInformation);
    return null;
  }

  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
  });
  if (waitForSession) {
    for (let attempt = 0; attempt < 20 && !current?.activeSessionId; attempt += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
  }
  if (!current) throw new Error("Workspace did not render.");
  return { get current() { return current!; } };
}

function historyEntries(
  entries: (readonly [string, string, string | null])[],
) {
  return entries.map(([item, chat_role, dcr_role]) => ({
    item,
    chat_role,
    dcr_role,
    metadata: null,
  }));
}

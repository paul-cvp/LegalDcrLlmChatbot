import { describe, expect, it, vi } from "vitest";

import {
  CHAT_TYPE,
  ChatApiClient,
  ChatApiError,
  type ChatResponseRequest,
} from "./chat";

describe("ChatApiClient", () => {
  it.each<ChatResponseRequest>([
    {
      text: "start",
      chat_type: CHAT_TYPE.DCR_CHAT,
      graph_xml: "<graph />",
      dcr_role: "Citizen",
      robot_auto_limit: 1,
      activity_repeat_limit: 0,
    },
    { text: "find a process", chat_type: CHAT_TYPE.DCR_CONTROLLER_CHAT },
    {
      text: "legal question",
      chat_type: CHAT_TYPE.RAG_CHAT,
      metadata: {
        search_indexes: ["find_relevant_laws", "find_similar_cases"],
        generate_followups: true,
        use_citizen_data: true,
        use_chat_history: true,
      },
    },
    {
      text: "selected-graph.xml",
      session_id: "session-1",
      dcr_role: "Citizen",
      robot_auto_limit: 0,
    },
    {
      text: "answer",
      session_id: "session-1",
      act_id: "activity-1",
      dcr_role: "Case worker",
      robot_auto_limit: -1,
    },
  ])("posts an exact backend response payload", async (request) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      text: "response",
      session_id: "session-1",
    }));
    const signal = new AbortController().signal;
    const client = new ChatApiClient("/api/chat", fetcher);

    await client.createResponse(request, signal);

    expect(fetcher).toHaveBeenCalledWith("/api/chat/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  });

  it("loads history and deletes a session with JSON bodies", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([{ item: "hello", chat_role: "user" }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ChatApiClient("/api/chat", fetcher);

    await expect(client.getHistory("session-1")).resolves.toHaveLength(1);
    await expect(client.deleteSession("session-1")).resolves.toBeUndefined();

    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ session_id: "session-1" }),
    });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ session_id: "session-1" }),
    });
  });

  it("exposes FastAPI validation details and status", async () => {
    const detail = [{ loc: ["body", "metadata"], msg: "Field required" }];
    const fetcher = vi.fn().mockResolvedValue(Response.json(
      { detail },
      { status: 422 },
    ));
    const client = new ChatApiClient("/api/chat", fetcher);

    const error = await client.createResponse({
      text: "question",
      chat_type: CHAT_TYPE.RAG_CHAT,
      metadata: {
        search_indexes: [],
        generate_followups: false,
        use_citizen_data: false,
        use_chat_history: true,
      },
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ChatApiError);
    expect(error).toMatchObject({
      message: "metadata: Field required",
      status: 422,
      detail,
    });
  });

  it("forwards abort failures without replacing them", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const fetcher = vi.fn().mockRejectedValue(abort);
    const client = new ChatApiClient("/api/chat", fetcher);

    await expect(client.getHistory("session-1")).rejects.toBe(abort);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyActivityQuestions,
  generateActivityQuestion,
  generateActivityQuestions,
} from "./activityQuestions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("activity question finalization", () => {
  it("generates one question using current metadata values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "What support do you need?" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateActivityQuestion({
      graphXml: "<process />",
      eventId: "Event_1",
      label: "Request support",
      role: "Citizen",
      description: "Describe needed support",
    })).resolves.toBe("What support do you need?");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents-to-dcr/activity-question",
      expect.objectContaining({
        body: JSON.stringify({
          graph_xml: "<process />",
          event_id: "Event_1",
          label: "Request support",
          role: "Citizen",
          description: "Describe needed support",
        }),
      }),
    );
  });

  it("sends the generated process to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ questions: { Event_1: "Your age?" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateActivityQuestions("<process />")).resolves.toEqual({
      Event_1: "Your age?",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents-to-dcr/activity-questions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ graph_xml: "<process />" }),
      }),
    );
  });

  it("patches only returned event descriptions", () => {
    const xml = `<?xml version="1.0"?>
      <dcr:definitions xmlns:dcr="http://tk/schema/dcr">
        <dcr:dcrGraph id="graph">
          <dcr:event id="Event_1" role="Citizen" description="Original citizen" />
          <dcr:event id="Event_2" role="Robot" description="Original robot" />
        </dcr:dcrGraph>
      </dcr:definitions>`;

    const result = applyActivityQuestions(xml, { Event_1: "What is your age?" });
    const document = new DOMParser().parseFromString(result, "application/xml");

    expect(document.querySelector('[id="Event_1"]')?.getAttribute("description"))
      .toBe("What is your age?");
    expect(document.querySelector('[id="Event_2"]')?.getAttribute("description"))
      .toBe("Original robot");
  });

  it("reports finalization failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Citizen activity requires input." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateActivityQuestions("<process />")).rejects.toThrow(
      "Citizen activity requires input.",
    );
  });
});

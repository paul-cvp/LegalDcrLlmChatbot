import { describe, expect, it } from "vitest";
import {
  createExtractionResult,
  createProcessTitle,
  layoutGraph,
  normalizeRole,
  type ProcessDescription,
} from "dcr-engine";

const document = (overrides: Partial<ProcessDescription>): ProcessDescription => ({
  text: "A process",
  sentences: [],
  mentions: [],
  entities: [],
  relations: [],
  variables: [],
  expressions: [],
  ...overrides,
});

describe("From Text process constraints", () => {
  it("creates a concise process name from the selected text", () => {
    expect(createProcessTitle(
      "Applications for disability-related child expenses are reviewed by the municipality. More details follow.",
    )).toBe("Applications for disability-related child expenses are reviewed by the municipality");
    expect(createProcessTitle(
      "The citizen submits a detailed application for extraordinary expenses and supporting documentation to the municipality.",
    )).toBe("The citizen submits a detailed application for extraordinary expenses and…");
    expect(createProcessTitle("   ")).toBe("Generated Process");
  });

  it("normalizes actors to the three supported roles", () => {
    expect(normalizeRole({ text: "the applicant" })).toBe("Citizen");
    expect(normalizeRole({ text: "the automated system" })).toBe("Robot");
    expect(normalizeRole({ text: "municipal officer" })).toBe("Caseworker");
  });

  it("uses the first explicit executor and gives every Citizen input", async () => {
    const { graph } = createExtractionResult(document({
      sentences: [
        "The applicant provides age.",
        "The resident explains their needs.",
        "The clerk checks the request.",
      ],
      mentions: [
        { text: "the applicant", type: "Actor", sentence: 0, role: "Citizen" },
        { text: "provides age", type: "Event", sentence: 0 },
        { text: "the clerk", type: "Actor", sentence: 2, role: "Caseworker" },
        { text: "The resident", type: "Actor", sentence: 1, role: "Citizen" },
        { text: "explains their needs", type: "Event", sentence: 1 },
        { text: "checks the request", type: "Event", sentence: 2 },
        { text: "the system", type: "Actor", sentence: 2, role: "Robot" },
      ],
      relations: [
        { type: "executes", headMentionIndex: 2, tailMentionIndex: 5 },
        { type: "executes", headMentionIndex: 6, tailMentionIndex: 5 },
      ],
      variables: [
        { name: "age", type: "Int" },
        { name: "unmatched_flag", type: "Bool" },
      ],
    }));

    expect(graph.eventMetadata?.["checks the request"].role).toBe("Caseworker");
    expect(graph.data["provides age"]).toEqual({ name: "age", type: "Int" });
    expect(graph.data["explains their needs"].type).toBe("String");
    expect(graph.eventMetadata?.unmatched_flag.role).toBe("Robot");
    expect(new Set(Object.values(graph.eventMetadata ?? {}).map(({ role }) => role)))
      .toEqual(new Set(["Citizen", "Caseworker", "Robot"]));

    const xml = await layoutGraph(graph);
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    expect([...parsed.getElementsByTagName("*")]
      .find((element) => element.localName === "dcrGraph")
      ?.getAttribute("title")).toBe("A process");
    const citizenEvents = [...parsed.getElementsByTagName("*")]
      .filter((event) => event.localName === "event")
      .filter((event) => event.getAttribute("role") === "Citizen");
    expect(citizenEvents).toHaveLength(2);
    for (const event of citizenEvents) {
      expect(event.getAttribute("takesInput")).toBe("true");
      expect([...event.getElementsByTagName("*")]
        .filter((child) => child.localName === "eventData")).toHaveLength(1);
    }
  });
});

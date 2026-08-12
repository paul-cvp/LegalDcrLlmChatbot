import { describe, expect, it } from "vitest";
import { extractGraph, layoutGraph } from "dcr-engine";

import Modeler from "/lib/Modeler";


describe("extracted model compatibility", () => {
  it("imports labels, descriptions, actors, and calendar durations", async () => {
    const draftText = "The Citizen must submit information.\n\nThe authority must issue a decision within three months.";
    const responses = [
      "Citizen\tActor\t0\nsubmit information\tEvent\t0\nauthority\tActor\t2\nissue a decision\tEvent\t2",
      "executes\t0\t1\nexecutes\t2\t3\ncondition\t1\t3",
      "\n\n2\tP3M",
    ];
    const result = await extractGraph({
      text: draftText,
      mentionDescription: "",
      relationDescription: "",
      dataDescription: "",
    }, async () => responses.shift());

    expect(result.graph.eventMetadata["submit information"]).toEqual({
      label: "submit information",
      role: "Citizen",
      description: "The Citizen must submit information.",
    });
    expect(result.graph.eventMetadata["issue a decision"].role).toBe("Caseworker");

    const xml = await layoutGraph(result.graph);
    expect(xml).toContain('label="submit information" role="Citizen"');
    expect(xml).toContain('time="P3M"');
    expect(xml).not.toContain('guard="P3M"');

    const modeler = new Modeler({ container: document.createElement("div") });
    const imported = await modeler.importXML(xml);
    expect(imported.warnings).toEqual([]);
    expect(modeler.validateGuards()).toEqual([]);
    expect(modeler.get("canvas").getRootElement().businessObject.description)
      .toBe(draftText);
    modeler.destroy();
  });
});

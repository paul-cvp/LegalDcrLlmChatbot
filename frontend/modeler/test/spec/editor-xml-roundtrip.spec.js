import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import Modeler from "/lib/Modeler";
import createModdle from "/lib/moddle";
import { moddleToDCR } from "dcr-engine";


const socialServiceXML = readFileSync(
  resolve(
    process.cwd(),
    "../../backend/data/models/Social Service Law 86 Data EN.xml",
  ),
  "utf8",
);
const pulaXML = readFileSync(
  resolve(process.cwd(), "../../backend/data/models/Pula.xml"),
  "utf8",
);


describe("DCR editor XML compatibility", () => {
  it("parses the shared Social Service model without warnings", async () => {
    const result = await createModdle().fromXML(
      socialServiceXML,
      "dcr:Definitions",
    );

    expect(result.warnings).toEqual([]);
    expect(result.rootElement.rootElements[0].id).toBe("dcrGraph");
    expect(Object.keys(result.elementsById).length).toBeGreaterThan(0);

    const age = result.elementsById.Event_07k41iu;
    expect(age.label).toBe("Age");
    expect(age.role).toBe("Citizen");
    expect(age.eventData).toMatchObject({ name: "age", type: "Int" });

    const subprocessRelation = result.elementsById[
      "SubProcess_0paoug4Event_155iiqhcondition"
    ];
    expect(subprocessRelation.sourceRef.id).toBe("SubProcess_0paoug4");
    expect(subprocessRelation.targetRef.id).toBe("Event_155iiqh");
  });

  it("renders the shared model in the editor", async () => {
    const modeler = new Modeler({ container: document.createElement("div") });

    const result = await modeler.importXML(socialServiceXML);

    expect(result.warnings).toEqual([]);
    expect(modeler.getElementRegistry().get("Event_07k41iu")).toBeDefined();
    expect(modeler.getElementRegistry().get("SubProcess_0paoug4")).toBeDefined();
    modeler.destroy();
  });

  it("converts the Pula model for simulation", async () => {
    const modeler = new Modeler({ container: document.createElement("div") });

    const result = await modeler.importXML(pulaXML);
    const graph = moddleToDCR(modeler.getElementRegistry());

    expect(result.warnings).toEqual([]);
    expect(graph.events).toEqual(new Set(["Event_119d007", "Event_1xax2gs"]));
    modeler.destroy();
  });

  it("converts graphs whose root uses a custom ID", async () => {
    const customRootXML = pulaXML
      .replace('id="dcrGraph"', 'id="PulaGraph"')
      .replace('boardElement="dcrGraph"', 'boardElement="PulaGraph"');
    const modeler = new Modeler({ container: document.createElement("div") });

    await modeler.importXML(customRootXML);
    const graph = moddleToDCR(modeler.getElementRegistry());

    expect(graph.events).toEqual(new Set(["Event_119d007", "Event_1xax2gs"]));
    modeler.destroy();
  });
});

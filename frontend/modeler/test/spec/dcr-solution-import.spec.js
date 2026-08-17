import { describe, expect, it } from "vitest";
import { moddleToDCR } from "dcr-engine";
import { parseStringPromise } from "xml2js";

import convertDCRSolutionForStorage from "/lib/DCRSolutionImport";
import Modeler from "/lib/Modeler";

const solutionXML = `<?xml version="1.0" encoding="UTF-8"?>
<dcrgraph>
  <specification>
    <resources>
      <events>
        <event id="Group" type="subprocess">
          <custom><visualization><location xLoc="0" yLoc="0"/><size width="300" height="250"/></visualization><eventData><dataType format="bool">choice</dataType></eventData></custom>
        <event id="Amount" computation="Amount-computation">
            <custom><roles><role>Citizen</role></roles><visualization><location xLoc="20" yLoc="20"/><size width="130" height="150"/></visualization><eventData name="Amount" type="number"/></custom>
          </event>
        </event>
        <event id="Decision" computation="Decision-computation">
          <custom><visualization><location xLoc="400" yLoc="20"/><size width="130" height="150"/></visualization><eventData><dataType>int</dataType></eventData></custom>
        </event>
        <event id="Section" type="nesting">
          <custom><visualization><location xLoc="600" yLoc="20"/><size width="180" height="210"/></visualization><eventData/></custom>
          <event id="Nested"><custom><visualization><location xLoc="625" yLoc="50"/><size width="130" height="150"/></visualization><eventData/></custom></event>
        </event>
      </events>
      <subProcesses/>
      <labels><label id="Case handling"/><label id="Expense amount"/><label id="Eligibility decision"/><label id="Section"/><label id="Nested event"/></labels>
      <labelMappings>
        <labelMapping eventId="Group" labelId="Case handling"/>
        <labelMapping eventId="Amount" labelId="Expense amount"/>
        <labelMapping eventId="Decision" labelId="Eligibility decision"/>
        <labelMapping eventId="Section" labelId="Section"/>
        <labelMapping eventId="Nested" labelId="Nested event"/>
      </labelMappings>
      <expressions>
        <expression id="Amount-computation" value="Amount + 1"/>
        <expression id="Decision-computation" value="If (Amount &gt;= 18) THEN (Decision) ELSE (false)" type="DMN"/>
        <expression id="Amount-Decision-guard" value="Amount = Decision and Group = true"/>
        <expression id="Amount-Decision-value" value="Decision + Amount"/>
      </expressions>
    </resources>
    <constraints>
      <conditions><condition sourceId="Amount" targetId="Decision" expressionId="Amount-Decision-guard"><custom><waypoints><waypoint x="150" y="95"/><waypoint x="400" y="95"/></waypoints></custom></condition></conditions>
      <responses/><coresponces/><excludes/><includes/><milestones/>
      <updates><update sourceId="Amount" targetId="Decision" expressionId="Amount-Decision-value"/></updates><spawns/>
    </constraints>
  </specification>
  <runtime><marking><executed/><included><event id="Group"/><event id="Amount"/><event id="Decision"/><event id="Section"/><event id="Nested"/></included><pendingResponses><event id="Decision"/></pendingResponses></marking></runtime>
</dcrgraph>`;

describe("DCR Solutions storage conversion", () => {
  it("preserves graph structure and carries named event data", async () => {
    const converted = await convertDCRSolutionForStorage(solutionXML);
    const parsed = await parseStringPromise(converted);
    const graph = parsed["dcr:definitions"]["dcr:dcrGraph"][0];
    const group = graph["dcr:subProcess"][0];
    const amount = group["dcr:event"][0];
    const decision = graph["dcr:event"][0];
    const section = graph["dcr:nesting"][0];

    expect(amount.$).toMatchObject({
      id: "Event_Amount",
      label: "Expense amount",
      description: "",
      role: "Citizen",
      included: "true",
    });
    expect(JSON.parse(amount.$.computation)).toEqual([
      { tuple: ["source", "data"] },
      "+",
      1,
    ]);
    expect(amount["dcr:eventData"][0].$).toEqual({
      name: "Amount",
      type: "Int",
    });
    expect(decision["dcr:eventData"][0].$).toEqual({
      name: "Decision",
      type: "Int",
    });
    expect(group["dcr:eventData"][0].$).toEqual({
      name: "Group",
      type: "Bool",
    });
    expect(decision.$).toMatchObject({
      id: "Event_Decision",
      label: "Eligibility decision",
      description: "",
      pending: "true",
    });
    expect(JSON.parse(decision.$.computation)).toEqual([
      "[", "(", false, ")", ",", "(",
      { tuple: ["source", "data"] }, ")", "]", "[", "(",
      { tuple: ["Event_Amount", "data"] }, ">=", 18, ")", "]",
    ]);
    expect(group.$).toMatchObject({
      id: "SubProcess_Group",
      label: "Case handling",
      description: "",
    });
    expect(section.$.id).toBe("Nesting_Section");
    expect(section["dcr:event"][0].$.id).toBe("Event_Nested");
    expect(group["dcr:relation"][0].$).toMatchObject({
      id: "Relation_AmountDecisioncondition",
      type: "condition",
      sourceRef: "Event_Amount",
      targetRef: "Event_Decision",
      guard: "Amount = Decision and Group = true",
    });
    expect(JSON.parse(group["dcr:relation"][0].$.guardComputation)).toEqual([
      { tuple: ["source", "data"] },
      "==",
      { tuple: ["target", "data"] },
      "and",
      { tuple: ["SubProcess_Group", "data"] },
      "==",
      true,
    ]);
    const update = group["dcr:relation"].find(
      (relation) => relation.$.type === "setValue",
    );
    expect(update.$.value).toBe("Decision + Amount");
    expect(JSON.parse(update.$.valueComputation)).toEqual([
      { tuple: ["target", "data"] },
      "+",
      { tuple: ["source", "data"] },
    ]);
    expect(parsed["dcr:definitions"]["dcrDi:dcrRootBoard"]).toBeDefined();
    const plane = parsed["dcr:definitions"]["dcrDi:dcrRootBoard"][0]["dcrDi:dcrPlane"][0];
    expect(plane["dcrDi:dcrShape"].every(
      (shape) => shape.$.id === `${shape.$.boardElement}_di`,
    )).toBe(true);
    const groupShape = plane["dcrDi:dcrShape"].find(
      (shape) => shape.$.boardElement === "SubProcess_Group",
    );
    expect(groupShape["dc:Bounds"][0].$).toEqual({
      x: "0",
      y: "0",
      width: "300",
      height: "250",
    });
    const relationShape = plane["dcrDi:relation"].find(
      (relation) => relation.$.boardElement === "Relation_AmountDecisioncondition",
    );
    expect(relationShape["dcrDi:waypoint"].map(({ $ }) => $)).toEqual([
      { x: "150", y: "95" },
      { x: "400", y: "95" },
    ]);
  });

  it("loads expression guards into the frontend model and backend computation", async () => {
    const converted = await convertDCRSolutionForStorage(solutionXML);
    const modeler = new Modeler({ container: document.createElement("div") });

    await expect(modeler.importXML(converted)).resolves.toMatchObject({
      warnings: [],
    });
    const relation = modeler.getElementRegistry()
      .get("Relation_AmountDecisioncondition").businessObject;
    expect(relation.guard).toBe("Amount = Decision and Group = true");
    expect(JSON.parse(relation.guardComputation)).toEqual([
      { tuple: ["source", "data"] },
      "==",
      { tuple: ["target", "data"] },
      "and",
      { tuple: ["SubProcess_Group", "data"] },
      "==",
      true,
    ]);

    const graph = moddleToDCR(modeler.getElementRegistry());
    expect(graph.guardMap?.Event_Amount?.Event_Decision?.condition)
      .toBe("Amount = Decision and Group = true");
    expect(modeler.validateGuards()).toEqual([]);
    modeler.updateRendering(graph);
    expect(modeler.getElementRegistry().get("Event_Amount").businessObject.enabled)
      .toBe(true);
    modeler.destroy();
  });

  it("rejects malformed and non-DCR XML", async () => {
    await expect(convertDCRSolutionForStorage("<broken>"))
      .rejects.toThrow("not well-formed XML");
    await expect(convertDCRSolutionForStorage("<graph />"))
      .rejects.toThrow("not a DCR Solutions XML graph");
  });

  it("rejects invalid named event data", async () => {
    const invalid = solutionXML.replace(
      'name="Amount" type="number"',
      'name="expense amount" type="number"',
    );
    await expect(convertDCRSolutionForStorage(invalid))
      .rejects.toThrow("must be a valid identifier");
  });

  it("rejects missing expressions and unknown event identifiers", async () => {
    const missing = solutionXML.replace(
      'expressionId="Amount-Decision-guard"',
      'expressionId="Missing-expression"',
    );
    await expect(convertDCRSolutionForStorage(missing))
      .rejects.toThrow('Expression “Missing-expression” is not defined');

    const unknown = solutionXML.replace(
      'value="Amount = Decision and Group = true"',
      'value="Amount = UnknownEvent"',
    );
    await expect(convertDCRSolutionForStorage(unknown))
      .rejects.toThrow('unknown event “UnknownEvent”');
  });
});

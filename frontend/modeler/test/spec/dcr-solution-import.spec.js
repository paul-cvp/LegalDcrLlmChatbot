import { describe, expect, it } from "vitest";
import { parseStringPromise } from "xml2js";

import convertDCRSolutionForStorage from "/lib/DCRSolutionImport";

const solutionXML = `<?xml version="1.0" encoding="UTF-8"?>
<dcrgraph>
  <specification>
    <resources>
      <events>
        <event id="Group" type="subprocess">
          <custom><visualization><location xLoc="0" yLoc="0"/><size width="300" height="250"/></visualization><eventData/></custom>
        <event id="Amount" computation="Amount-computation">
            <custom><roles><role>Citizen</role></roles><visualization><location xLoc="20" yLoc="20"/><size width="130" height="150"/></visualization><eventData name="expenseAmount" type="number"/></custom>
          </event>
        </event>
        <event id="Decision" computation="Decision-computation">
          <custom><visualization><location xLoc="400" yLoc="20"/><size width="130" height="150"/></visualization></custom>
        </event>
      </events>
      <subProcesses/>
      <labels><label id="Case handling"/><label id="Expense amount"/><label id="Eligibility decision"/></labels>
      <labelMappings>
        <labelMapping eventId="Group" labelId="Case handling"/>
        <labelMapping eventId="Amount" labelId="Expense amount"/>
        <labelMapping eventId="Decision" labelId="Eligibility decision"/>
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
  <runtime><marking><executed/><included><event id="Group"/><event id="Amount"/><event id="Decision"/></included><pendingResponses><event id="Decision"/></pendingResponses></marking></runtime>
</dcrgraph>`;

describe("DCR Solutions storage conversion", () => {
  it("preserves graph structure and carries named event data", async () => {
    const converted = await convertDCRSolutionForStorage(solutionXML);
    const parsed = await parseStringPromise(converted);
    const graph = parsed["dcr:definitions"]["dcr:dcrGraph"][0];
    const group = graph["dcr:subProcess"][0];
    const amount = group["dcr:event"][0];
    const decision = graph["dcr:event"][0];

    expect(amount.$).toMatchObject({
      id: "Amount",
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
      name: "expenseAmount",
      type: "Int",
    });
    expect(decision.$).toMatchObject({
      id: "Decision",
      label: "Eligibility decision",
      description: "",
      pending: "true",
    });
    expect(JSON.parse(decision.$.computation)).toEqual([
      "[", "(", false, ")", ",", "(",
      { tuple: ["source", "data"] }, ")", "]", "[", "(",
      { tuple: ["Amount", "data"] }, ">=", 18, ")", "]",
    ]);
    expect(group.$).toMatchObject({
      label: "Case handling",
      description: "",
    });
    expect(group["dcr:relation"][0].$).toMatchObject({
      type: "condition",
      sourceRef: "Amount",
      targetRef: "Decision",
    });
    expect(JSON.parse(group["dcr:relation"][0].$.guardComputation)).toEqual([
      { tuple: ["source", "data"] },
      "==",
      { tuple: ["target", "data"] },
      "and",
      { tuple: ["Group", "data"] },
      "==",
      true,
    ]);
    const update = group["dcr:relation"].find(
      (relation) => relation.$.type === "setValue",
    );
    expect(JSON.parse(update.$.valueComputation)).toEqual([
      { tuple: ["target", "data"] },
      "+",
      { tuple: ["source", "data"] },
    ]);
    expect(parsed["dcr:definitions"]["dcrDi:dcrRootBoard"]).toBeDefined();
    const plane = parsed["dcr:definitions"]["dcrDi:dcrRootBoard"][0]["dcrDi:dcrPlane"][0];
    const groupShape = plane["dcrDi:dcrShape"].find(
      (shape) => shape.$.boardElement === "Group",
    );
    expect(groupShape["dc:Bounds"][0].$).toEqual({
      x: "0",
      y: "0",
      width: "300",
      height: "250",
    });
    const relationShape = plane["dcrDi:relation"].find(
      (relation) => relation.$.boardElement === "AmountDecisioncondition",
    );
    expect(relationShape["dcrDi:waypoint"].map(({ $ }) => $)).toEqual([
      { x: "150", y: "95" },
      { x: "400", y: "95" },
    ]);
  });

  it("rejects malformed and non-DCR XML", async () => {
    await expect(convertDCRSolutionForStorage("<broken>"))
      .rejects.toThrow("not well-formed XML");
    await expect(convertDCRSolutionForStorage("<graph />"))
      .rejects.toThrow("not a DCR Solutions XML graph");
  });

  it("rejects invalid named event data", async () => {
    const invalid = solutionXML.replace(
      'name="expenseAmount" type="number"',
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

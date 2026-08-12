import { describe, expect, it, vi } from "vitest";
import { moddleToDCR } from "dcr-engine";

import Modeler from "/lib/Modeler";
import createModdle from "/lib/moddle";


const computation = JSON.stringify([
  "and",
  2,
  true,
  { tuple: ["target", "data"] },
  { tuple: ["target", "tool", "graph", "executions"] },
]);
const xmlComputation = computation.replaceAll('"', "&quot;");
const activityXML = `<?xml version="1.0" encoding="UTF-8"?>
<dcr:definitions xmlns:dcr="http://tk/schema/dcr" xmlns:dcrDi="http://tk/schema/dcrDi" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
  <dcr:dcrGraph id="Graph">
    <dcr:event id="Source" label="Source" included="true" executed="false" pending="false" takesInput="false" computation="${xmlComputation}">
      <dcr:eventData name="threshold" type="Bool" />
    </dcr:event>
    <dcr:subProcess id="Flow" label="Flow" role="Robot" priority="2" included="true" executed="false" pending="false" takesInput="false" computation="[]" toolCall="find_similar_cases">
      <dcr:event id="Child" label="Child" included="true" executed="false" pending="false" takesInput="false" />
    </dcr:subProcess>
    <dcr:relation id="SetValue" type="setValue" sourceRef="Source" targetRef="Child" value="1" guard="threshold == true" guardComputation="[{&quot;tuple&quot;:[&quot;source&quot;,&quot;data&quot;]},&quot;==&quot;,true]" valueComputation="[{&quot;tuple&quot;:[&quot;source&quot;,&quot;data&quot;]},&quot;&gt;=&quot;,18]" />
  </dcr:dcrGraph>
  <dcrDi:dcrRootBoard id="root"><dcrDi:dcrPlane id="plane" boardElement="Graph">
    <dcrDi:dcrShape id="Source_di" boardElement="Source"><dc:Bounds x="20" y="20" width="130" height="150" /></dcrDi:dcrShape>
    <dcrDi:dcrShape id="Flow_di" boardElement="Flow"><dc:Bounds x="250" y="20" width="190" height="210" /></dcrDi:dcrShape>
    <dcrDi:dcrShape id="Child_di" boardElement="Child"><dc:Bounds x="280" y="50" width="130" height="150" /></dcrDi:dcrShape>
    <dcrDi:relation id="SetValue_di" boardElement="SetValue"><dcrDi:waypoint x="150" y="95" /><dcrDi:waypoint x="280" y="95" /></dcrDi:relation>
  </dcrDi:dcrPlane></dcrDi:dcrRootBoard>
</dcr:definitions>`;

const tools = [
  { value: "find_relevant_laws", label: "Find relevant laws" },
  { value: "find_similar_cases", label: "Find similar cases" },
];

async function createModeler() {
  const modeler = new Modeler({ container: document.createElement("div") });
  const result = await modeler.importXML(activityXML);
  expect(result.warnings).toEqual([]);
  return modeler;
}

describe("activity computations and tool calls", () => {
  it("allows non-modeling views to disable metadata editing", async () => {
    const modeler = new Modeler({
      container: document.createElement("div"),
      additionalModules: [{ guardsAndTimeProvider: ["value", null] }],
    });

    await expect(modeler.importXML(activityXML)).resolves.toBeDefined();
    modeler.destroy();
  });

  it("round-trips native Event, SubProcess, and Relation attributes", async () => {
    const modeler = await createModeler();
    const source = modeler.getElementRegistry().get("Source").businessObject;
    const flow = modeler.getElementRegistry().get("Flow").businessObject;
    const relation = modeler.getElementRegistry().get("SetValue").businessObject;

    expect(source.computation).toBe(computation);
    expect(source.takesInput).toBe(false);
    expect(flow).toMatchObject({
      role: "Robot",
      priority: 2,
      computation: "[]",
      toolCall: "find_similar_cases",
    });
    expect(relation).toMatchObject({
      guard: "threshold == true",
      guardComputation: '[{"tuple":["source","data"]},"==",true]',
      valueComputation: '[{"tuple":["source","data"]},">=",18]',
    });
    expect(modeler.validateGuards()).toEqual([]);

    const saved = await modeler.saveXML({ format: true });
    const reparsed = await createModdle().fromXML(saved.xml, "dcr:Definitions");
    expect(reparsed.elementsById.Source.computation).toBe(computation);
    expect(reparsed.elementsById.Flow.toolCall).toBe("find_similar_cases");
    expect(reparsed.elementsById.SetValue.guardComputation)
      .toBe('[{"tuple":["source","data"]},"==",true]');
    expect(reparsed.elementsById.SetValue.valueComputation)
      .toBe('[{"tuple":["source","data"]},">=",18]');

    const graph = moddleToDCR(modeler.getElementRegistry());
    expect(graph).not.toHaveProperty("toolCall");
    expect(graph).not.toHaveProperty("computation");
    modeler.destroy();
  });

  it("edits structured tokens and adds a tool invocation once", async () => {
    const modeler = await createModeler();
    const source = modeler.getElementRegistry().get("Source");
    const provider = modeler.get("guardsAndTimeProvider");
    provider.setToolCalls(tools);
    provider.openMetadataPanel(source);

    expect(Array.from(document.querySelectorAll("._metadata_token_type"))
      .map((field) => field.value))
      .toEqual(["string", "number", "boolean", "tuple2", "tuple4"]);
    const tool = document.querySelector("#_metadata_tool");
    tool.value = "find_relevant_laws";
    tool.dispatchEvent(new Event("change"));
    tool.dispatchEvent(new Event("change"));
    document.querySelector("#_metadata_add_token").click();
    const types = document.querySelectorAll("._metadata_token_type");
    const addedType = types[types.length - 1];
    addedType.value = "number";
    addedType.dispatchEvent(new Event("change"));
    const values = document.querySelectorAll("._metadata_token_value");
    const addedValue = values[values.length - 1];
    addedValue.value = "4.5";
    addedValue.dispatchEvent(new Event("input"));
    document.querySelector("#_metadata_save").click();

    const tokens = JSON.parse(source.businessObject.computation);
    expect(source.businessObject.toolCall).toBe("find_relevant_laws");
    expect(tokens.filter((token) => token.tuple?.[0] === "source" && token.tuple?.[1] === "tool"))
      .toHaveLength(1);
    expect(tokens.at(-1)).toBe(4.5);
    modeler.get("commandStack").undo();
    expect(source.businessObject.toolCall).toBeUndefined();
    expect(source.businessObject.computation).toBe(computation);
    modeler.destroy();
  });

  it("generates an activity question into the description field", async () => {
    const modeler = await createModeler();
    const source = modeler.getElementRegistry().get("Source");
    const provider = modeler.get("guardsAndTimeProvider");
    const generator = vi.fn().mockResolvedValue("What is the threshold?");
    provider.setActivityQuestionGenerator(generator);
    provider.openMetadataPanel(source);

    document.querySelector("#_metadata_label").value = "Current label";
    document.querySelector("#_metadata_role").value = "Citizen";
    document.querySelector("#_metadata_description").value = "Current description";
    document.querySelector("#_metadata_generate_question").click();

    await vi.waitFor(() => {
      expect(document.querySelector("#_metadata_description").value)
        .toBe("What is the threshold?");
    });
    expect(generator).toHaveBeenCalledWith({
      id: "Source",
      label: "Current label",
      role: "Citizen",
      description: "Current description",
    });
    document.querySelector("#_metadata_save").click();
    expect(source.businessObject.description).toBe("What is the threshold?");
    modeler.destroy();
  });

  it("offers metadata editing for subprocesses and preserves unavailable tools", async () => {
    const modeler = await createModeler();
    const flow = modeler.getElementRegistry().get("Flow");
    const provider = modeler.get("guardsAndTimeProvider");
    expect(provider.getContextPadEntries(flow)["edit-metadata"]).toBeDefined();

    provider.openMetadataPanel(flow);
    expect(document.querySelector("#_metadata_tool").disabled).toBe(true);
    document.querySelector("#_metadata_description").value = "Updated";
    document.querySelector("#_metadata_save").click();
    expect(flow.businessObject.toolCall).toBe("find_similar_cases");
    expect(flow.businessObject.description).toBe("Updated");

    provider.setToolCalls(tools);
    provider.openMetadataPanel(flow);
    const tool = document.querySelector("#_metadata_tool");
    tool.value = "find_relevant_laws";
    tool.dispatchEvent(new Event("change"));
    document.querySelector("#_metadata_save").click();
    expect(flow.businessObject.toolCall).toBe("find_relevant_laws");
    expect(JSON.parse(flow.businessObject.computation)).toEqual([
      { tuple: ["source", "tool"] },
    ]);
    modeler.destroy();
  });

  it("reorders and removes computation tokens", async () => {
    const modeler = await createModeler();
    const source = modeler.getElementRegistry().get("Source");
    const provider = modeler.get("guardsAndTimeProvider");
    provider.setToolCalls(tools);
    provider.openMetadataPanel(source);

    let rows = document.querySelector("#_metadata_computation_rows");
    rows.children[1].querySelectorAll("button")[0].click();
    rows = document.querySelector("#_metadata_computation_rows");
    rows.children[0].querySelectorAll("button")[2].click();
    document.querySelector("#_metadata_save").click();

    const tokens = JSON.parse(source.businessObject.computation);
    expect(tokens).not.toContain(2);
    expect(tokens[0]).toBe("and");
    modeler.destroy();
  });
});

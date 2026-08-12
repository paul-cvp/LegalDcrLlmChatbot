import { describe, expect, it } from "vitest";
import { parseStringPromise } from "xml2js";
import { moddleToDCR } from "dcr-engine";

import Modeler from "/lib/Modeler";
import createModdle from "/lib/moddle";


const relationXML = `<?xml version="1.0" encoding="UTF-8"?>
<dcr:definitions xmlns:dcr="http://tk/schema/dcr" xmlns:dcrDi="http://tk/schema/dcrDi" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
  <dcr:dcrGraph id="dcrGraph">
    <dcr:event id="Source" description="Source" included="true" executed="false" pending="false">
      <dcr:eventData name="amount" type="Int" default="1" />
    </dcr:event>
    <dcr:event id="Target" description="Target" included="true" executed="false" pending="true">
      <dcr:eventData name="result" type="Int" default="0" />
    </dcr:event>
    <dcr:relation id="NoResponse" type="noresponse" sourceRef="Source" targetRef="Target" guard="amount &gt; 0" forAll="true" />
    <dcr:relation id="SetValue" type="setValue" sourceRef="Source" targetRef="Target" guard="amount &gt; 0" value="amount + 1" forAll="false" />
  </dcr:dcrGraph>
  <dcrDi:dcrRootBoard id="root"><dcrDi:dcrPlane id="plane" boardElement="dcrGraph">
    <dcrDi:dcrShape id="Source_di" boardElement="Source"><dc:Bounds x="100" y="100" width="130" height="150" /></dcrDi:dcrShape>
    <dcrDi:dcrShape id="Target_di" boardElement="Target"><dc:Bounds x="400" y="100" width="130" height="150" /></dcrDi:dcrShape>
    <dcrDi:relation id="NoResponse_di" boardElement="NoResponse"><dcrDi:waypoint x="230" y="160" /><dcrDi:waypoint x="400" y="160" /></dcrDi:relation>
    <dcrDi:relation id="SetValue_di" boardElement="SetValue"><dcrDi:waypoint x="230" y="190" /><dcrDi:waypoint x="400" y="190" /></dcrDi:relation>
  </dcrDi:dcrPlane></dcrDi:dcrRootBoard>
</dcr:definitions>`;

const missingTargetDataXML = relationXML
  .replace(/\s*<dcr:eventData name="result"[^>]*\/>/, "")
  .replace('id="SetValue" type="setValue"', 'id="SetValue" type="condition"')
  .replace(' value="amount + 1"', "");

const labelDisplayXML = relationXML.replace(
  'id="Source" description="Source"',
  'id="Source" label="Visible label" description="Hidden description"',
);

const comparisonValueXML = relationXML.replace(
  'value="amount + 1"',
  'value="amount &gt;= 1"',
);

async function createModeler(xml = relationXML) {
  const modeler = new Modeler({ container: document.createElement("div") });
  const result = await modeler.importXML(xml);
  expect(result.warnings).toEqual([]);
  return modeler;
}

describe("no-response and set-value modeler support", () => {
  it("updates and serializes DCR graph metadata", async () => {
    const modeler = await createModeler();
    const root = modeler.get("canvas").getRootElement();
    modeler.get("modeling").updateProperties(root, {
      title: "Expense process",
      description: "Graph-level metadata",
    });
    const saved = await modeler.saveXML({ format: true });
    const reparsed = await createModdle().fromXML(saved.xml, "dcr:Definitions");
    expect(reparsed.rootElement.rootElements[0]).toMatchObject({
      title: "Expense process",
      description: "Graph-level metadata",
    });
    modeler.get("commandStack").undo();
    expect(root.businessObject.title).toBeUndefined();
    expect(root.businessObject.description).toBeUndefined();
    modeler.destroy();
  });

  it("renders and edits labels instead of descriptions", async () => {
    const modeler = await createModeler(labelDisplayXML);
    const source = modeler.getElementRegistry().get("Source");
    expect(modeler.getElementRegistry().getGraphics("Source").textContent)
      .toContain("Visible label");
    expect(modeler.getElementRegistry().getGraphics("Source").textContent)
      .not.toContain("Hidden description");
    expect(modeler.getElementRegistry().getGraphics("Target").textContent)
      .not.toContain("Target");

    source.businessObject.labelAttribute = "label";
    modeler.get("modeling").updateLabel(source, "Edited label");
    expect(source.businessObject.label).toBe("Edited label");
    expect(source.businessObject.description).toBe("Hidden description");
    modeler.destroy();
  });

  it("edits event metadata from the context pad without changing its label", async () => {
    const modeler = await createModeler(labelDisplayXML);
    const source = modeler.getElementRegistry().get("Source");
    const provider = modeler.get("guardsAndTimeProvider");
    const entries = provider.getContextPadEntries(source);
    expect(Object.keys(entries)).toEqual(["edit-metadata"]);
    expect(entries["edit-metadata"]).toMatchObject({
      className: "bpmn-icon-text-annotation",
      title: "Edit metadata",
    });

    entries["edit-metadata"].action.click({ stopPropagation() {} }, source);
    const description = document.querySelector("#_metadata_description");
    const label = document.querySelector("#_metadata_label");
    const role = document.querySelector("#_metadata_role");
    const priority = document.querySelector("#_metadata_priority");
    expect(description.value).toBe("Hidden description");
    expect(priority.value).toBe("");
    expect(document.querySelector("#_metadata_var_name").value).toBe("amount");
    label.value = "Updated label";
    role.value = "Citizen";
    description.value = "Updated metadata";
    priority.value = "-1.5";
    document.querySelector("#_metadata_save").click();
    expect(source.businessObject.description).toBe("Updated metadata");
    expect(source.businessObject.label).toBe("Updated label");
    expect(source.businessObject.role).toBe("Citizen");
    expect(source.businessObject.priority).toBe(-1.5);

    const saved = await modeler.saveXML({ format: true });
    const reparsed = await createModdle().fromXML(saved.xml, "dcr:Definitions");
    expect(reparsed.elementsById.Source).toMatchObject({
      label: "Updated label",
      role: "Citizen",
      description: "Updated metadata",
    });

    modeler.get("commandStack").undo();
    expect(source.businessObject.description).toBe("Hidden description");
    expect(source.businessObject.label).toBe("Visible label");
    expect(source.businessObject.role).toBeUndefined();
    expect(source.businessObject.priority).toBeUndefined();
    provider.openMetadataPanel(source);
    document.querySelector("#_metadata_description").value = "Cancelled metadata";
    document.querySelector("#_metadata_priority").value = "4";
    document.querySelector("#_metadata_cancel").click();
    expect(source.businessObject.description).toBe("Hidden description");
    expect(source.businessObject.priority).toBeUndefined();
    modeler.destroy();
  });

  it("edits an event data variable in the activity metadata panel", async () => {
    const modeler = await createModeler();
    const source = modeler.getElementRegistry().get("Source");
    const provider = modeler.get("guardsAndTimeProvider");

    provider.openMetadataPanel(source);
    document.querySelector("#_metadata_var_name").value = "approved";
    document.querySelector("#_metadata_var_name").dispatchEvent(new Event("input"));
    const type = document.querySelector("#_metadata_var_type");
    type.value = "Bool";
    type.dispatchEvent(new Event("change"));
    const defaultValue = document.querySelector("#_metadata_var_default");
    defaultValue.value = "false";
    defaultValue.dispatchEvent(new Event("change"));
    document.querySelector("#_metadata_save").click();

    expect(source.businessObject.eventData).toMatchObject({
      name: "approved",
      type: "Bool",
      default: "false",
    });
    modeler.get("commandStack").undo();
    expect(source.businessObject.eventData).toMatchObject({
      name: "amount",
      type: "Int",
      default: "1",
    });
    modeler.destroy();
  });

  it("rejects invalid event priority and clears an existing priority", async () => {
    const modeler = await createModeler(labelDisplayXML);
    const source = modeler.getElementRegistry().get("Source");
    const provider = modeler.get("guardsAndTimeProvider");

    provider.openMetadataPanel(source);
    document.querySelector("#_metadata_priority").value = "not-a-number";
    document.querySelector("#_metadata_save").click();
    expect(document.querySelector("#_metadata_err").textContent).toContain("finite number");
    expect(source.businessObject.priority).toBeUndefined();

    document.querySelector("#_metadata_priority").value = "2";
    document.querySelector("#_metadata_save").click();
    expect(source.businessObject.priority).toBe(2);
    provider.openMetadataPanel(source);
    document.querySelector("#_metadata_priority").value = "";
    document.querySelector("#_metadata_save").click();
    expect(source.businessObject.priority).toBeUndefined();
    modeler.destroy();
  });

  it.each(["&gt;", "&#62;"])(
    "normalizes %s in set-value expressions on export",
    async (entity) => {
      const xml = comparisonValueXML.replace("&gt;", entity);
      const modeler = await createModeler(xml);
      expect(modeler.getElementRegistry().get("SetValue").businessObject.value)
        .toBe("amount >= 1");

      const saved = await modeler.saveXML({ format: true });
      expect(saved.xml).toContain('value="amount &gt;= 1"');
      expect(saved.xml).not.toContain('value="amount &#62;= 1"');
      const reparsed = await createModdle().fromXML(saved.xml, "dcr:Definitions");
      expect(reparsed.elementsById.SetValue.value).toBe("amount >= 1");

      const legacy = await modeler.saveDCRXML();
      expect(legacy.xml).toContain('value="amount &gt;= 1"');
      expect(legacy.xml).not.toContain('value="amount &#62;= 1"');
      modeler.destroy();
    },
  );

  it("round-trips activity priority through editor and DCR Solutions XML", async () => {
    const modeler = await createModeler();
    const source = modeler.getElementRegistry().get("Source");
    modeler.get("modeling").updateProperties(source, { priority: 2.5 });

    const editor = await modeler.saveXML({ format: true });
    expect(editor.xml).toContain('priority="2.5"');
    const reparsed = await createModdle().fromXML(editor.xml, "dcr:Definitions");
    expect(reparsed.elementsById.Source.priority).toBe(2.5);

    const legacy = await modeler.saveDCRXML();
    const parsedLegacy = await parseStringPromise(legacy.xml);
    const sourceXml = parsedLegacy.dcrgraph.specification[0].resources[0]
      .events[0].event.find(({ $ }) => $.id === "Source");
    expect(sourceXml.$.priority).toBe("2.5");

    const imported = new Modeler({ container: document.createElement("div") });
    await imported.importDCRPortalXML(legacy.xml);
    expect(imported.getElementRegistry().get("Source").businessObject.priority).toBe(2.5);
    imported.destroy();
    modeler.destroy();
  });

  it("round-trips native and legacy XML attributes", async () => {
    const modeler = await createModeler();
    const saved = await modeler.saveXML({ format: true });
    const reparsed = await createModdle().fromXML(saved.xml, "dcr:Definitions");
    expect(reparsed.warnings).toEqual([]);
    expect(reparsed.elementsById.NoResponse).toMatchObject({
      type: "noresponse",
      guard: "amount > 0",
      forAll: true,
    });
    expect(reparsed.elementsById.SetValue).toMatchObject({
      type: "setValue",
      value: "amount + 1",
      guard: "amount > 0",
      forAll: false,
    });
    const setValueDi = reparsed.rootElement.rootBoards[0].plane.planeElement
      .find(({ boardElement }) => boardElement.id === "SetValue");
    expect(setValueDi.waypoint).toEqual([
      expect.objectContaining({ x: 230, y: 190 }),
      expect.objectContaining({ x: 400, y: 190 }),
    ]);

    const legacy = await modeler.saveDCRXML();
    const parsedLegacy = await parseStringPromise(legacy.xml);
    const constraints = parsedLegacy.dcrgraph.specification[0].constraints[0];
    expect(constraints.coresponces[0].coresponce[0].$).toMatchObject({
      guard: "amount > 0",
      forAll: "true",
    });
    expect(constraints.updates[0].update[0].$).toMatchObject({
      value: "amount + 1",
      guard: "amount > 0",
    });
    modeler.destroy();
  });

  it.each([
    ["HM2011", "default-noresponse", "default-setvalue"],
    ["DCR Solutions", "new-noresponse", "new-setvalue"],
    ["TAL2023", "proposed-noresponse", "proposed-setvalue"],
  ])("renders dedicated markers using %s notation", async (notation, noResponseId, setValueId) => {
    const modeler = await createModeler();
    modeler.setSetting("markerNotation", notation);
    const registry = modeler.getElementRegistry();
    const setValueGfx = registry.getGraphics("SetValue");
    const svg = setValueGfx.ownerSVGElement;
    const noResponseMarker = svg.querySelector(`marker[id*="${noResponseId}"]`);
    const setValueMarker = svg.querySelector(`marker[id*="${setValueId}"]`);
    expect(noResponseMarker).not.toBeNull();
    expect(noResponseMarker.querySelectorAll("path").length).toBeGreaterThanOrEqual(1);
    expect(setValueMarker).not.toBeNull();
    expect(setValueGfx.textContent).toContain(":= amount + 1");
    modeler.destroy();
  });

  it("creates missing target event data only after valid set-value configuration", async () => {
    const modeler = await createModeler(missingTargetDataXML);
    const relation = modeler.getElementRegistry().get("SetValue");
    const target = modeler.getElementRegistry().get("Target");
    const entry = modeler.get("relationPopupProvider").getEntries(relation)
      .find(({ flowType }) => flowType === "setValue");

    entry.action();
    expect(relation.businessObject.type).toBe("condition");
    document.querySelector("#_ann_value").value = "amount + 1";
    document.querySelector("#_ann_target_type").value = "Int";
    document.querySelector("#_ann_save").click();

    expect(relation.businessObject).toMatchObject({
      type: "setValue",
      value: "amount + 1",
    });
    expect(target.businessObject.eventData).toMatchObject({
      name: "Target",
      type: "Int",
    });

    modeler.get("commandStack").undo();
    modeler.get("commandStack").undo();
    expect(relation.businessObject.type).toBe("condition");
    expect(target.businessObject.eventData).toBeUndefined();
    modeler.get("commandStack").redo();
    modeler.get("commandStack").redo();
    expect(relation.businessObject.type).toBe("setValue");
    expect(target.businessObject.eventData.name).toBe("Target");
    modeler.destroy();
  });

  it("does not mutate the relation when set-value editing is cancelled", async () => {
    const modeler = await createModeler(missingTargetDataXML);
    const relation = modeler.getElementRegistry().get("SetValue");
    modeler.get("guardsAndTimeProvider").openRelationPanel(relation, "setValue");
    document.querySelector("#_ann_cancel").click();
    expect(relation.businessObject.type).toBe("condition");
    expect(relation.target.businessObject.eventData).toBeUndefined();
    modeler.destroy();
  });

  it("rejects invalid values and preserves existing target event data", async () => {
    const modeler = await createModeler();
    const relation = modeler.getElementRegistry().get("SetValue");
    const targetData = relation.target.businessObject.eventData;
    modeler.get("guardsAndTimeProvider").openRelationPanel(relation);
    document.querySelector("#_ann_value").value = "missing + 1";
    document.querySelector("#_ann_save").click();
    expect(document.querySelector("#_ann_err").textContent).toContain(
      'Variable "missing" is not defined',
    );
    expect(relation.businessObject.value).toBe("amount + 1");

    document.querySelector("#_ann_value").value = "2";
    document.querySelector("#_ann_save").click();
    expect(relation.businessObject.value).toBe("2");
    expect(relation.target.businessObject.eventData).toBe(targetData);
    modeler.destroy();
  });

  it("converts both relation types to the simulator graph", async () => {
    const modeler = await createModeler();
    const graph = moddleToDCR(modeler.getElementRegistry());
    expect(graph.noResponseTo.Source).toContain("Target");
    expect(graph.setValueTo.Source.Target).toBe("amount + 1");
    expect(graph.guardMap.Source.Target).toMatchObject({
      noresponse: "amount > 0",
      setValue: "amount > 0",
    });
    modeler.destroy();
  });

  it("clears incompatible attributes while preserving guard and forAll", async () => {
    const modeler = await createModeler();
    const relation = modeler.getElementRegistry().get("SetValue");
    const entry = modeler.get("relationPopupProvider").getEntries(relation)
      .find(({ flowType }) => flowType === "noresponse");
    entry.action(null, entry);
    expect(relation.businessObject).toMatchObject({
      type: "noresponse",
      guard: "amount > 0",
      forAll: false,
    });
    expect(relation.businessObject.value).toBeUndefined();
    modeler.get("commandStack").undo();
    expect(relation.businessObject).toMatchObject({
      type: "setValue",
      value: "amount + 1",
    });
    modeler.destroy();
  });
});

import xml2js, { parseStringPromise } from "xml2js";

function generateBaseLayout() {
  return {
    "dcr:definitions": {
      "$": {
        "xmlns:dcr": "http://tk/schema/dcr",
        "xmlns:dcrDi": "http://tk/schema/dcrDi",
        "xmlns:dc": "http://www.omg.org/spec/DD/20100524/DC",
      },
      "dcr:dcrGraph": {
        "$": {
          "id": "dcrGraph",
        },
        "dcr:event": [],
        "dcr:nesting": [],
        "dcr:subProcess": [],
        "dcr:relation": [],
      },
      "dcrDi:dcrRootBoard": {
        "$": {
          "id": "dcrRootBoard",
        },
        "dcrDi:dcrPlane": {
          "$": {
            "id": "dcrPlane",
            "boardElement": "dcrGraph",
          },
          "dcrDi:dcrShape": [],
          "dcrDi:relation": [],
        }
      }
    }
  };
}

function getDescription(id, xml) {
  return xml.specification[0].resources[0].labelMappings[0].labelMapping?.find(label => label.$.eventId === id)?.$.labelId;
}

function getIncluded(id, xml) {
  return xml.runtime[0].marking[0].included[0]?.event?.find(event => event.$.id === id) !== undefined;
}

function getExecuted(id, xml) {
  return xml.runtime[0].marking[0].executed[0]?.event?.find(event => event.$.id === id) !== undefined;
}

function getPending(id, xml) {
  return xml.runtime[0].marking[0].pendingResponses[0]?.event?.find(event => event.$.id === id) !== undefined;
}

function handleEvent(event, xml, bpmn, parent, parentMap) {
  parentMap.set(event.$.id, parent);
  if (!event.$.type) {
    // Normal event
    parent["dcr:event"].push({
      $: {
        id: event.$.id,
        role: event.custom[0]?.roles?.[0]?.role[0],
        description: getDescription(event.$.id, xml),
        priority: event.$.priority,
        included: getIncluded(event.$.id, xml),
        executed: getExecuted(event.$.id, xml),
        pending: getPending(event.$.id, xml),
      }
    });
    bpmn["dcr:definitions"]["dcrDi:dcrRootBoard"]["dcrDi:dcrPlane"]["dcrDi:dcrShape"].push({
      $: {
        id: `${event.$.id}_di`,
        boardElement: event.$.id,
      },
      "dc:Bounds": {
        $: {
          x: event.custom[0]?.visualization[0]?.location[0]?.$?.xLoc,
          y: event.custom[0]?.visualization[0]?.location[0]?.$?.yLoc,
          width: event.custom[0]?.visualization[0]?.size[0]?.$?.width,
          height: event.custom[0]?.visualization[0]?.size[0]?.$?.height,
        }
      }
    });
  } else if (event.$.type === 'nesting') {
    // Nesting event
    parent["dcr:nesting"].push({
      $: {
        id: event.$.id,
        role: event.custom[0]?.roles?.[0]?.role[0],
        description: getDescription(event.$.id, xml),
      },
      "dcr:event": [],
      "dcr:nesting": [],
      "dcr:subProcess": [],
      "dcr:relation": [],
    });
    bpmn["dcr:definitions"]["dcrDi:dcrRootBoard"]["dcrDi:dcrPlane"]["dcrDi:dcrShape"].push({
      $: {
        id: `${event.$.id}_di`,
        boardElement: event.$.id,
      },
      "dc:Bounds": {
        $: {
          x: event.custom[0]?.visualization[0]?.location[0]?.$?.xLoc,
          y: event.custom[0]?.visualization[0]?.location[0]?.$?.yLoc,
          width: event.custom[0]?.visualization[0]?.size[0]?.$?.width,
          height: event.custom[0]?.visualization[0]?.size[0]?.$?.height,
        }
      }
    });
    if (event.event) {
      for (let subEvent of event.event) {
        handleEvent(subEvent, xml, bpmn, parent["dcr:nesting"][parent["dcr:nesting"].length - 1], parentMap);
      }
    }
  } else if (event.$.type === 'subprocess') {
    // Subprocess event
    parent["dcr:subProcess"].push({
      $: {
        id: event.$.id,
        description: getDescription(event.$.id, xml),
        included: getIncluded(event.$.id, xml),
        executed: getExecuted(event.$.id, xml),
        pending: getPending(event.$.id, xml),
      },
      "dcr:event": [],
      "dcr:nesting": [],
      "dcr:subProcess": [],
      "dcr:relation": [],
    });
    bpmn["dcr:definitions"]["dcrDi:dcrRootBoard"]["dcrDi:dcrPlane"]["dcrDi:dcrShape"].push({
      $: {
        id: `${event.$.id}_di`,
        boardElement: event.$.id,
      },
      "dc:Bounds": {
        $: {
          x: event.custom[0]?.visualization[0]?.location[0]?.$?.xLoc,
          y: event.custom[0]?.visualization[0]?.location[0]?.$?.yLoc,
          width: event.custom[0]?.visualization[0]?.size[0]?.$?.width,
          height: event.custom[0]?.visualization[0]?.size[0]?.$?.height,
        }
      }
    });
    if (event.event) {
      for (let subEvent of event.event) {
        handleEvent(subEvent, xml, bpmn, parent["dcr:subProcess"][parent["dcr:subProcess"].length - 1], parentMap);
      }
    }
  }
}

function handleSubProcesses(xml, bpmn, parentMap) {
  for (let subProcess of Object.values(xml.specification[0].resources[0].subProcesses[0].subProcess)) {
    bpmn["dcr:definitions"]["dcr:dcrGraph"]["dcr:subProcess"].push({
      $: {
        id: subProcess.$.id,
        description: subProcess.$.name,
        "multi-instance": true,
        included: true
      },
      "dcr:event": [],
      "dcr:nesting": [],
      "dcr:subProcess": [],
      "dcr:relation": [],
    });
    bpmn["dcr:definitions"]["dcrDi:dcrRootBoard"]["dcrDi:dcrPlane"]["dcrDi:dcrShape"].push({
      $: {
        id: `${subProcess.$.id}_di`,
        boardElement: subProcess.$.id,
      },
      "dc:Bounds": {
        $: {
          x: subProcess.custom[0]?.visualization[0]?.location[0]?.$?.xLoc,
          y: subProcess.custom[0]?.visualization[0]?.location[0]?.$?.yLoc,
          width: subProcess.custom[0]?.visualization[0]?.size[0]?.$?.width,
          height: subProcess.custom[0]?.visualization[0]?.size[0]?.$?.height,
        }
      }
    });
    for (let event of subProcess.dcrgraph[0].specification[0].resources[0].events[0].event) {
      handleEvent(event, subProcess.dcrgraph[0], bpmn, bpmn["dcr:definitions"]["dcr:dcrGraph"]["dcr:subProcess"][bpmn["dcr:definitions"]["dcr:dcrGraph"]["dcr:subProcess"].length - 1], parentMap);
    }
    handleRelations(subProcess.dcrgraph[0], bpmn, parentMap);
  }
}

function handleRelations(xml, bpmn, parentMap) {
  for (let relationGroup of Object.values(xml.specification[0].constraints[0])) {
    if (relationGroup[0] === '') continue;
    let type = Object.keys(relationGroup[0])[0];
    for (let relation of Object.values(relationGroup[0])[0]) {
      parentMap.get(relation.$.sourceId)["dcr:relation"].push({
        $: {
          id: relation.custom[0]?.id?.[0]?.$.id,
          type: type,
          sourceRef: relation.$.sourceId,
          targetRef: relation.$.targetId,
        }
      });
      bpmn["dcr:definitions"]["dcrDi:dcrRootBoard"]["dcrDi:dcrPlane"]["dcrDi:relation"].push({
        $: {
          id: `${relation.custom[0]?.id?.[0]?.$.id}_di`,
          boardElement: relation.custom[0]?.id?.[0]?.$.id,
        },
        "dcrDi:waypoint": relation.custom[0]?.waypoints[0].waypoint
      });
    }
  }
}

export default async function convertCustomToBPMN(xml) {
  try {
    const result = await parseStringPromise(xml);
    const bpmn = generateBaseLayout();
    const parentMap = new Map(); // Map of ids and their parents

    for (let event of result.dcrgraph.specification[0].resources[0].events[0].event) {
      handleEvent(event, result.dcrgraph, bpmn, bpmn["dcr:definitions"]["dcr:dcrGraph"], parentMap);
    }
    if (result.dcrgraph.specification[0].resources[0].subProcesses[0] !== '') handleSubProcesses(result.dcrgraph, bpmn, parentMap);
    handleRelations(result.dcrgraph, bpmn, parentMap);

    let builder = new xml2js.Builder();
    let finalXML = builder.buildObject(bpmn);
    return finalXML;
  } catch (error) {
    console.error('Failed to parse custom XML', error);
  }
}

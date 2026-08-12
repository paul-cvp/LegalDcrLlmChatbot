import { describe, expect, it } from "vitest";

import { executeS } from "../../../dcr-engine/src/executionEngine";
import type { DCRGraphS, EventMap, SubProcess } from "../../../dcr-engine/src/types";


const eventMap = (...events: string[]): EventMap =>
  Object.fromEntries(events.map((event) => [event, new Set<string>()]));

function graphWithEvents(...events: string[]): DCRGraphS {
  return {
    events: new Set(events),
    labels: new Set(events),
    labelMap: Object.fromEntries(events.map((event) => [event, event])),
    labelMapInv: Object.fromEntries(events.map((event) => [event, new Set([event])])),
    roles: new Set(),
    roleMap: Object.fromEntries(events.map((event) => [event, ""])),
    subProcesses: {},
    subProcessMap: {},
    conditionsFor: eventMap(...events),
    milestonesFor: eventMap(...events),
    responseTo: eventMap(...events),
    includesTo: eventMap(...events),
    excludesTo: eventMap(...events),
    noResponseTo: eventMap(...events),
    spawnTo: eventMap(...events),
    setValueTo: Object.fromEntries(events.map((event) => [event, {}])),
    eventData: {},
    marking: {
      executed: new Map(),
      included: new Set(events),
      pending: new Map(),
    },
  };
}

describe("extended DCR execution", () => {
  it("executes guarded no-response and set-value effects", () => {
    const graph = graphWithEvents("source", "target");
    graph.marking.pending.set("target", undefined);
    graph.noResponseTo!.source.add("target");
    graph.setValueTo!.source.target = "amount + 1";
    graph.eventData!.target = { name: "result", type: "Int" };
    graph.guardMap = {
      source: {
        target: { noresponse: "amount > 0", setValue: "amount > 0" },
      },
    };
    const variables = { amount: 4, result: 0 };

    executeS("source", graph, variables);

    expect(graph.marking.pending.has("target")).toBe(false);
    expect(variables.result).toBe(5);
  });

  it("creates a fresh numbered instance for every spawn", () => {
    const graph = graphWithEvents("source", "repeatable", "child");
    const template: SubProcess = {
      id: "repeatable",
      parent: graph,
      events: new Set(["child"]),
      multiInstance: true,
      spawnCount: 0,
    };
    graph.subProcesses.repeatable = template;
    graph.subProcessMap.child = template;
    graph.spawnTo!.source.add("repeatable");

    executeS("source", graph);
    executeS("source", graph);

    expect(graph.events).toContain("childSpawn1");
    expect(graph.events).toContain("childSpawn2");
    expect(graph.subProcesses.repeatableSpawn1.events).toContain("childSpawn1");
    expect(graph.subProcesses.repeatableSpawn2.events).toContain("childSpawn2");
  });
});

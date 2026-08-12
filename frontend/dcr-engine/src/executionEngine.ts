import type { DCRGraph, DCRGraphS, Event, SubProcess, VariableStore } from "./types";

import { isSubProcess } from "./types";
import { mutatingIntersect } from "./utility";
import { evaluateExpression, evaluateGuard, getGuard } from "./guardEval";

// Mutates graph's marking
export function execute(event: Event, graph: DCRGraph) {
  graph.marking.executed.set(event, {});
  graph.marking.pending.delete(event);

  for (const responseEvent of graph.responseTo[event]) {
    graph.marking.pending.set(responseEvent, undefined);
  }

  for (const excludeEvent of graph.excludesTo[event]) {
    graph.marking.included.delete(excludeEvent);
  }

  for (const includeEvent of graph.includesTo[event]) {
    graph.marking.included.add(includeEvent);
  }
}

export function isAccepting(graph: DCRGraph): boolean {
  return (
    mutatingIntersect(new Set(graph.marking.pending.keys()), graph.marking.included)
      .size === 0
  );
}

export function isEnabled(event: Event, graph: DCRGraph): boolean {
  if (!graph.marking.included.has(event)) {
    return false;
  }

  for (const conditionEvent of graph.conditionsFor[event]) {
    // If an event conditioning for event is included and not executed
    // return false
    if (
      graph.marking.included.has(conditionEvent) &&
      !graph.marking.executed.has(conditionEvent)
    ) {
      return false;
    }
  }

  for (const milestoneEvent of graph.milestonesFor[event]) {
    // If an event conditioning for event is included and not executed
    // return false
    if (
      graph.marking.included.has(milestoneEvent) &&
      graph.marking.pending.has(milestoneEvent)
    ) {
      return false;
    }
  }

  return true;
}

// Mutates graph's marking
export const executeS = (
  event: Event,
  graph: DCRGraphS,
  variableStore: VariableStore = {},
  currentTime?: Date
) => {
  graph.marking.executed.set(event, {
    time: currentTime,
    variableSnapshot: { ...variableStore },
  });
  graph.marking.pending.delete(event);

  for (const eEvent of graph.excludesTo[event]) {
    const guard = getGuard(graph.guardMap, event, eEvent, "exclude");
    if (evaluateGuard(guard, variableStore)) {
      graph.marking.included.delete(eEvent);
    }
  }
  for (const iEvent of graph.includesTo[event]) {
    const guard = getGuard(graph.guardMap, event, iEvent, "include");
    if (evaluateGuard(guard, variableStore)) {
      graph.marking.included.add(iEvent);
    }
  }
  for (const rEvent of graph.responseTo[event]) {
    const guard = getGuard(graph.guardMap, event, rEvent, "response");
    if (evaluateGuard(guard, variableStore)) {
      const deadlineMs = graph.timeConstraintMap?.[event]?.[rEvent]?.deadline;
      const deadline = deadlineMs !== undefined && currentTime !== undefined
        ? new Date(currentTime.getTime() + deadlineMs)
        : undefined;
      graph.marking.pending.set(rEvent, deadline);
    }
  }
  for (const nEvent of graph.noResponseTo?.[event] ?? []) {
    const guard = getGuard(graph.guardMap, event, nEvent, "noresponse");
    if (evaluateGuard(guard, variableStore)) {
      graph.marking.pending.delete(nEvent);
    }
  }
  for (const [target, value] of Object.entries(graph.setValueTo?.[event] ?? {})) {
    const guard = getGuard(graph.guardMap, event, target, "setValue");
    const variable = graph.eventData?.[target];
    if (variable && evaluateGuard(guard, variableStore)) {
      const evaluated = evaluateExpression(value, variableStore);
      if (evaluated !== undefined) variableStore[variable.name] = evaluated;
    }
  }
  for (const target of [...(graph.spawnTo?.[event] ?? [])]) {
    const guard = getGuard(graph.guardMap, event, target, "spawn");
    if (evaluateGuard(guard, variableStore)) spawnSubProcess(target, graph);
  }

  const group = graph.subProcessMap[event];
  if (group && isAcceptingS(group, graph)) {
    executeS(group.id, graph, variableStore, currentTime);
  }
};

/** Clone a multi-instance subprocess and its semantic relations. */
export function spawnSubProcess(target: Event, graph: DCRGraphS): Map<Event, Event> {
  const template = graph.subProcesses[target];
  if (!template?.multiInstance) return new Map();
  const count = (template.spawnCount ?? 0) + 1;
  template.spawnCount = count;

  const templateIds = new Set<Event>();
  const collect = (group: SubProcess) => {
    templateIds.add(group.id);
    group.events.forEach((event) => {
      templateIds.add(event);
      const child = graph.subProcesses[event];
      if (child) collect(child);
    });
  };
  collect(template);
  const ids = new Map<Event, Event>(
    [...templateIds].map((id) => [id, `${id}Spawn${count}`])
  );

  const copyEventMap = (relationMap: { [event: string]: Set<Event> } | undefined) => {
    if (!relationMap) return;
    const entries = Object.entries(relationMap).map(
      ([source, targets]) => [source, [...targets]] as const
    );
    ids.forEach((spawned) => { relationMap[spawned] = new Set(); });
    entries.forEach(([source, targets]) => targets.forEach((targetId) => {
      if (!ids.has(source) && !ids.has(targetId)) return;
      const spawnedSource = ids.get(source) ?? source;
      const spawnedTarget = ids.get(targetId) ?? targetId;
      relationMap[spawnedSource] ??= new Set();
      relationMap[spawnedSource].add(spawnedTarget);
    }));
  };

  [
    graph.conditionsFor,
    graph.milestonesFor,
    graph.responseTo,
    graph.includesTo,
    graph.excludesTo,
    graph.noResponseTo,
  ].forEach(copyEventMap);
  if (graph.spawnTo) {
    const spawnEntries = Object.entries(graph.spawnTo).map(
      ([source, targets]) => [source, [...targets]] as const
    );
    ids.forEach((spawned) => { graph.spawnTo![spawned] = new Set(); });
    spawnEntries.forEach(([source, targets]) => {
      if (!ids.has(source)) return;
      const spawnedSource = ids.get(source)!;
      targets.forEach((targetId) => {
        graph.spawnTo![spawnedSource].add(ids.get(targetId) ?? targetId);
      });
    });
  }

  ids.forEach((spawned, original) => {
    graph.events.add(spawned);
    graph.labelMap[spawned] = graph.labelMap[original];
    graph.roleMap[spawned] = graph.roleMap[original];
    graph.labelMapInv[graph.labelMap[original]]?.add(spawned);
    if (graph.marking.included.has(original)) graph.marking.included.add(spawned);
    if (graph.marking.pending.has(original)) graph.marking.pending.set(spawned, undefined);
    if (graph.eventData?.[original]) {
      graph.eventData[spawned] = { ...graph.eventData[original] };
    }
    graph.setValueTo![spawned] = {};
  });

  const groups = [...templateIds]
    .map((id) => graph.subProcesses[id])
    .filter((group): group is SubProcess => !!group);
  const spawnedGroups = new Map<string, SubProcess>();
  groups.forEach((group) => {
    const spawnedId = ids.get(group.id)!;
    spawnedGroups.set(group.id, {
      id: spawnedId,
      parent: graph,
      events: new Set([...group.events].map((event) => ids.get(event)!)),
      multiInstance: group.multiInstance,
      spawnCount: 0,
    });
  });
  groups.forEach((group) => {
    const spawned = spawnedGroups.get(group.id)!;
    spawned.parent = isSubProcess(group.parent)
      ? spawnedGroups.get(group.parent.id) ?? group.parent
      : group.parent;
    graph.subProcesses[spawned.id] = spawned;
    spawned.events.forEach((event) => { graph.subProcessMap[event] = spawned; });
  });

  const guardedEntries = Object.entries(graph.guardMap ?? {});
  guardedEntries.forEach(([source, targets]) => Object.entries(targets).forEach(
    ([targetId, guards]) => {
      if (!ids.has(source) && !ids.has(targetId)) return;
      const spawnedSource = ids.get(source) ?? source;
      const spawnedTarget = ids.get(targetId) ?? targetId;
      graph.guardMap ??= {};
      graph.guardMap[spawnedSource] ??= {};
      graph.guardMap[spawnedSource][spawnedTarget] = { ...guards };
    }
  ));
  const valueEntries = Object.entries(graph.setValueTo ?? {});
  valueEntries.forEach(([source, targets]) => Object.entries(targets).forEach(
    ([targetId, value]) => {
      if (!ids.has(source) && !ids.has(targetId)) return;
      const spawnedSource = ids.get(source) ?? source;
      const spawnedTarget = ids.get(targetId) ?? targetId;
      graph.setValueTo![spawnedSource] ??= {};
      graph.setValueTo![spawnedSource][spawnedTarget] = value;
    }
  ));
  return ids;
}

function hasExcludedElder(group: SubProcess, graph: DCRGraphS) {
  if (!graph.marking.included.has(group.id)) {
    return true;
  }

  if (!isSubProcess(group.parent)) {
    return false;
  }

  return hasExcludedElder(group.parent, graph);
}

export function isAcceptingS(
  group: SubProcess | DCRGraphS,
  graph: DCRGraphS
): boolean {
  // Group is accepting if the intersections between pending and included events is empty for the events in the group
  let pending = mutatingIntersect(
    new Set(graph.marking.pending.keys()),
    graph.marking.included
  );

  for (const blockingEvent of mutatingIntersect(pending, group.events)) {
    const group = graph.subProcessMap[blockingEvent];
    if (!group || !hasExcludedElder(group, graph)) {
      return false;
    }
  }

  return true;
}

function formatEmpty(label: string, title: string): string {
  return label === "" ? `Unnamed ${title}` : label;
}

export function isEnabledS(
  event: Event,
  graph: DCRGraphS,
  group: SubProcess | DCRGraph,
  variableStore: VariableStore = {},
  currentTime?: Date
): { enabled: boolean; msg: string } {
  if (!graph.marking.included.has(event)) {
    return {
      enabled: false,
      msg: `${formatEmpty(graph.labelMap[event], "Subprocess")} is not included...`,
    };
  }

  if (isSubProcess(group)) {
    const subProcessStatus = isEnabledS(group.id, graph, group.parent, variableStore, currentTime);
    if (!subProcessStatus.enabled) {
      return subProcessStatus;
    }
  }

  for (const cEvent of graph.conditionsFor[event]) {
    if (!graph.marking.included.has(cEvent)) continue;

    const guard = getGuard(graph.guardMap, cEvent, event, "condition");
    if (guard && !evaluateGuard(guard, variableStore)) continue;

    if (!graph.marking.executed.has(cEvent)) {
      return {
        enabled: false,
        msg: `At minimum, ${formatEmpty(graph.labelMap[cEvent], "Event")} is conditioning for ${formatEmpty(graph.labelMap[event], "Event")}...`,
      };
    }

    const delayMs = graph.timeConstraintMap?.[cEvent]?.[event]?.delay;
    if (delayMs !== undefined) {
      const executedAt = graph.marking.executed.get(cEvent)?.time;
      if (!executedAt || !currentTime || currentTime.getTime() - executedAt.getTime() < delayMs) {
        return {
          enabled: false,
          msg: `Delay from ${formatEmpty(graph.labelMap[cEvent], "Event")} to ${formatEmpty(graph.labelMap[event], "Event")} has not elapsed yet...`,
        };
      }
    }
  }

  for (const mEvent of graph.milestonesFor[event]) {
    if (!graph.marking.included.has(mEvent) || !graph.marking.pending.has(mEvent)) continue;

    const mGuard = getGuard(graph.guardMap, mEvent, event, "milestone");
    if (mGuard && !evaluateGuard(mGuard, variableStore)) continue;

    return {
      enabled: false,
      msg: `At minimum, ${formatEmpty(graph.labelMap[mEvent], "Event")} is a milestone for ${formatEmpty(graph.labelMap[event], "Event")}...`,
    };
  }
  return { enabled: true, msg: "" };
}

from typing import Set
from datetime import datetime
from keyword import iskeyword
import re
import asyncio
import inspect
from concurrent.futures import ThreadPoolExecutor

from pm4py.objects.dcr.ocdcr.obj import DcrGraph, DcrElement, DcrParentElement, DcrNesting, DcrSubprocess, DcrSubgraph, DcrSpawnContainer, DcrActivity, DcrRelation, DcrEffect, DcrSpawn, DcrConstraint, RelationType, DcrExpression, DcrComputation, DcrExecution
from tools.tool_call import ToolCall


class DcrSemantics:

    def __init__(self,user_context:str|None=None, use_citizen_data:bool = False) -> None:
        self.uc = user_context
        self.use_citizen_data = use_citizen_data

    def getRelations(self, element: DcrElement, graph: DcrGraph, yields: str=None) -> tuple[Set[DcrRelation], Set[DcrRelation]]:
        incoming = set()
        outgoing = set()
        for r in graph.relations:
            if r.target == element and (yields != "constraints" or isinstance(r, DcrConstraint)):
                incoming.add(r)
            if r.source == element and (yields != "effects" or isinstance(r, DcrEffect)):
                outgoing.add(r)
        parents = graph.getParents(element)
        for parent in parents:
            if isinstance(parent, DcrNesting):
                i, o = self.getRelations(parent, graph, yields)
                incoming.update(i)
                outgoing.update(o)
        return incoming, outgoing
    
    def getEffects(self, element: DcrElement, graph: DcrGraph) -> Set[DcrRelation]:
        _, effects = self.getRelations(element, graph, "effects")
        return effects
    
    def getConstraints(self, element: DcrElement, graph: DcrGraph) -> Set[DcrRelation]:
        constraints, _ = self.getRelations(element, graph, "constraints")
        for sub in graph.getSubprocessParents(element):
            constraints.update(self.getConstraints(sub, graph))
        return constraints
    
    def isEnabled(
        self,
        element: DcrActivity | DcrSubprocess,
        graph: DcrGraph,
        role: str = None,
    ) -> bool:
        if not isinstance(element, DcrActivity):
            return False
        if not self.isAuthorized(element, role):
            return False
        if not element.effectiveIncluded:
            return False
        if isinstance(element, DcrSubprocess) and element.childrenPending:
            return False
        constraints = self.getConstraints(element, graph)
        for r in constraints:
            if not self.constraintPasses(r.source, element, r, graph):
                return False
        return True

    @staticmethod
    def isAuthorized(element: DcrActivity, role: str = None) -> bool:
        """Check an explicit actor role; no role denotes trusted system execution."""
        if role is None or not element.role:
            return True
        assigned_roles = {
            assigned.strip()
            for assigned in element.role.split(",")
            if assigned.strip()
        }
        return role in assigned_roles

    def getEnabledActivities(
        self, graph: DcrGraph, role: str = None
    ) -> Set[DcrActivity]:
        """Return activities enabled for the supplied actor role."""
        return {
            element
            for element in graph.elements
            if isinstance(element, DcrActivity)
            and self.isEnabled(element, graph, role)
        }
    
    def constraintPasses(self, source: DcrElement, target: DcrElement, constraint: DcrConstraint, graph: DcrGraph) -> bool:
        if isinstance(source, DcrNesting):
            res = True
            for child in source.children:
                res = res and self.constraintPasses(child, target, constraint, graph)
            return res
        if source.effectiveIncluded and (constraint.guard is None or self.evaluateComputation(constraint.guard, graph, source, target)):
            if constraint.relationType == RelationType.C and not source.executed:
                return False
            if constraint.relationType == RelationType.M and source.effectivePending:
                return False
        return True
    
    def parseAttribute(self, element: str, attribute: str, e3:str = None, e4:str = None) -> any:
        match attribute:
            case "tool":
                summarizes_graph = e3 == "summary" or (e3 == "graph" and e4 == "executions")
                return f"self.resolveAsync(self.invoke_tool({element}, graph, {summarizes_graph}))"
            case "id":
                return element + ".ID"
            case "included":
                return element + ".effectiveIncluded"
            case "pending":
                return element + ".effectivePending and " + element + ".effectiveIncluded"  ### Should this care if included?
            case "executed":
                return element + ".executed"
            case "enabled":
                return "self.isEnabled(" + element + ", graph)"
            case "computation":
                return element + ".computation"
            case "data":
                return element + ".data"
            case "children":
                return element + ".children"
            case "instance":
                return "(self.getSpawnID(" + element + "))"
            case _:
                return None
    
    def parseExpression(self, expression: DcrExpression):
        operators = ["+", "-", "*", "/", "==", "<", ">", "<=", ">=", "and", "or", "not", "is", "in", "for", "(", ")", "[", "]", "len"]
        match expression:
            case (e1, e2, e3, e4):
                #here we allow for a more advanced tool call with graph.executions
                return self.parseAttribute(e1, e2, e3, e4)
            case (e1, e2, e3):
                return self.parseAttribute(e1, e2, e3)
            case (e1, e2):
                if e1 in ["source", "target"]:
                    return self.parseAttribute(e1, e2)
                else:
                    return self.parseAttribute("graph.getElementFromID('{}')".format(e1), e2)
            case str():
                if expression in operators:
                    return expression
                elif expression == "inInstance":
                    return ".startswith" #maybe .contains instead?
                # elif expression == ":=":
                    # return "="
                else:
                    for word in re.split(" |(|)|.", expression):
                        if iskeyword(word):
                            return None
                    return expression
            case int():
                return str(expression)
            case float():
                return str(expression)

    @staticmethod
    def resolveAsync(result):
        """Resolve an async tool call while keeping DCR semantics synchronous."""
        if not inspect.isawaitable(result):
            return result

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(result)

        # Run outside the already active event loop.
        with ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(asyncio.run, result).result()


    def invoke_tool(self, element: DcrActivity, graph: DcrGraph, summarizes_graph: bool = False):
        """Call a persisted tool with arguments matching its registered type."""
        tool = element.tool_call
        summarizes_graph = summarizes_graph or ToolCall.from_callable(tool) is ToolCall.SUMMARIZE_CASE_HISTORY
        user_data = []
        for execution in graph.executions:
            activity = graph.getActivity(execution.activityID)
            item = {
                "label": activity.label,
                "timestamp": str(execution.time),
            }
            if summarizes_graph:
                item["id"] = execution.activityID
            if self.use_citizen_data:
                item["data"] = activity.data
            user_data.append(item)

        kwargs = {}
        if summarizes_graph or self.use_citizen_data:
            kwargs["user_data"] = user_data
        if self.use_citizen_data:
            kwargs["user_info"] = self.uc
        argument = graph if summarizes_graph else element.description
        print(self.use_citizen_data, kwargs)
        return tool(argument, **kwargs)
    
    def evaluateComputation(self, computation: DcrComputation, graph: DcrGraph, source: DcrElement=None, target: DcrElement=None) -> any:
        # Compile a temporary expression so retained XML guard tokens stay intact. graph is never empty
        executable = " ".join(self.parseExpression(expression) for expression in computation)
        try:
            res = eval(executable)
        except SyntaxError:
            # Only statements need exec; runtime failures must retain their cause.
            res = exec(executable)
        return res
    
    def executeActivity(self, execution: DcrExecution, graph: DcrGraph):
        activity = graph.getActivity(execution.activityID)
        if not self.isAuthorized(activity, execution.role):
            raise PermissionError(
                "Role {!r} is not authorized to execute activity {}".format(
                    execution.role, activity.ID
                )
            )
        if self.isEnabled(activity, graph, execution.role):
            if execution.time is None:
                execution.time = datetime.now()
            graph.executions.append(execution)
            self.execute(activity, graph, execution.input, execution.time)
        else:
            raise Exception("Activity with ID {} is not enabled and cannot be executed".format(activity.ID))
    
    def execute(self, element: DcrActivity | DcrSubprocess, graph: DcrGraph, input=None, executionTime=None):
        if element.takesInput and input is not None:
            element.data = input
        elif element.computation is not None:
            try:
                element.data = self.evaluateComputation(element.computation, graph, source=element)
            except:
                element.data = "Tool call cannot be automatically resolved by Robot activity!"
        graph.updatePending(element, False)
        element.executed = datetime.now() if executionTime is None else executionTime

        effects = self.getEffects(element, graph)
        for r in sorted(effects, key=lambda r: r.relationType):
            self.relateToTarget(element, r.target, r, graph)

        self.executeSubprocessParent(element, graph)

    def executeSubprocessParent(self, element: DcrElement, graph: DcrGraph) -> int:
        parents = graph.getParents(element)
        sub = False
        for parent in parents:
            if isinstance(parent, DcrSubprocess):
                sub = True
                if self.isEnabled(parent, graph):
                    self.execute(parent, graph)
            elif isinstance(parent, DcrNesting | DcrSubgraph):
                sub = self.executeSubprocessParent(parent, graph)
            if sub:
                break
        return sub

    def relateToTarget(self, source: DcrElement, target: DcrElement, effect: DcrEffect, graph: DcrGraph):
        if target.isTemplate:
            return
        if isinstance(effect, DcrSpawn):
            if effect.guard is None or self.evaluateComputation(effect.guard, graph, source, target):
                effect.spawned += 1
                self.spawn(target, graph, effect.spawned)
        elif isinstance(target, DcrNesting | DcrSubgraph):
            for child in target.children:
                self.relateToTarget(source, child, effect, graph)
        else:
            if effect.guard is None or self.evaluateComputation(effect.guard, graph, source, target):
                match effect.relationType:
                    case RelationType.I:
                        graph.updateIncluded(target, True)
                        if target.pending:
                            graph.updatePending(target)
                    case RelationType.E:
                        graph.updateIncluded(target, False)
                        if target.pending:
                            graph.updatePending(target)
                    case RelationType.R:
                        if target.included:
                            graph.updatePending(target, True)
                        else:
                            target.pending = True
                    case RelationType.N:
                        if target.included:
                            graph.updatePending(target, False)
                        else:
                            target.pending = False
                    case RelationType.V:
                        target.data = self.evaluateComputation(effect.value, graph, source, target)

    def spawn(self, subgraph: DcrSubgraph, graph: DcrGraph, spawnNumber: int):
        spawnID = self.getSpawnID(subgraph)
        elementDict = {}
        for spawnContainer in subgraph.children:
            elementDict[spawnContainer] = spawnContainer
            for element in spawnContainer.children:
                elementDict.update(self.spawnElements(element, graph, spawnNumber, spawnID))

        for template in elementDict:
            if isinstance(template, DcrParentElement):
                children = set()
                for child in template.children:
                    if child in elementDict:
                        children.add(elementDict[child])
                elementDict[template].children.update(children)

            if template is not elementDict[template]:
                incoming, outgoing = self.getRelations(template, graph)
                for i in incoming:
                    if i.target == template:
                        if isinstance(i, DcrSpawn):
                            graph.relations.add(DcrSpawn(elementDict[i.source], elementDict[template], i.guard))
                        elif isinstance(i, DcrEffect):
                            graph.relations.add(DcrEffect(i.relationType, elementDict[i.source], elementDict[template], i.guard))
                        else:
                            graph.relations.add(DcrConstraint(i.relationType, elementDict[i.source], elementDict[template], i.guard))
                for o in outgoing:
                    if o.source == template:
                        if isinstance(o.target, DcrSpawnContainer):
                            if isinstance(o, DcrEffect):
                                graph.relations.add(DcrEffect(o.relationType, elementDict[template], elementDict[o.target], o.guard))
                            else:
                                graph.relations.add(DcrConstraint(o.relationType, elementDict[template], elementDict[o.target], o.guard))
        
        graph.elements.update(elementDict.values())
        for template in elementDict:
            if isinstance(template, DcrSubgraph):
                for container in elementDict[template].children:
                    self.makeTemplate(container, set(elementDict.values()))
                    self.spawnSubContainers(container, set(elementDict.values()), graph)

    def spawnElements(self, element: DcrElement, graph: DcrGraph, spawnNumber: int, spawnID: str) -> dict[DcrElement, DcrElement]:
        spawns = {}

        if isinstance(element, DcrNesting | DcrSubprocess | DcrSubgraph):
            for child in element.children:
                spawns.update(self.spawnElements(child, graph, spawnNumber, spawnID))
        
        if self.getSpawnID(element) == spawnID: # ensures that we only spawn template elements from the correct spawn level
            if type(element) is DcrSubgraph:
                spawns[element] = DcrSubgraph("{}Spawn{}".format(element.ID, spawnNumber))
            elif type(element) is DcrSpawnContainer:
                spawns[element] = element # maintains containers and also keeps subgraphs within subgraphs on the same containers across multiple instantiations of outer subgraph
            elif type(element) is DcrNesting:
                spawns[element] = DcrNesting("{}Spawn{}".format(element.ID, spawnNumber))
            elif type(element) is DcrSubprocess:
                spawns[element] = DcrSubprocess("{}Spawn{}".format(element.ID, spawnNumber), template=element)
            else:
                activityID = "{}Spawn{}".format(element.ID, spawnNumber)
                spawns[element] = DcrActivity(activityID, template=element)
                graph.activityMap[activityID] = spawns[element]

        return spawns
    
    def getSpawnID(self, element: DcrElement):
        return ''.join(re.findall('Spawn\d+', element.ID))
    
    def makeTemplate(self, element: DcrElement, spawned: Set[DcrElement]):
        if not isinstance(element, DcrSpawnContainer) and element in spawned:
            element.isTemplate = True
        if isinstance(element, DcrParentElement):
          for child in element.children:
              self.makeTemplate(child, spawned)

    def spawnSubContainers(self, container: DcrSpawnContainer, spawned: Set[DcrElement], graph: DcrGraph):
        for child in container.children:
            if child in spawned:
                newChild = child
                break
        subContainer = DcrSpawnContainer(newChild.ID + "Container", {newChild})
        graph.elements.add(subContainer)
        container.children.remove(newChild)
        container.children.add(subContainer)

        incoming, outgoing = self.getRelations(container, graph)
        for i in incoming:
            if not isinstance(i.source, DcrSpawnContainer) and self.getSpawnID(i.source) == self.getSpawnID(newChild):
                i.target = subContainer
        for o in outgoing:
            if not isinstance(o.target, DcrSpawnContainer) and self.getSpawnID(o.target) == self.getSpawnID(newChild):
                o.source = subContainer

        if isinstance(newChild, DcrNesting | DcrSubprocess):
            for child in newChild.children:
                if isinstance(child, DcrSpawnContainer):
                    self.spawnSubContainers(child, spawned, graph)


    def getTopSubgraph(self, element: DcrElement, graph: DcrGraph, topSub=None):
        parents = graph.getParents(element)
        for parent in parents:
            if isinstance(parent, DcrSubgraph):
                topSub = parent
                break
        if parents:
            return self.getTopSubgraph(list(parents)[0], graph, topSub)
        return topSub

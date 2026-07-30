from typing import Set
from datetime import datetime
from keyword import iskeyword
import re


from pm4py.objects.dcr.ocdcr.obj import DcrGraph, DcrElement, DcrParentElement, DcrNesting, DcrSubprocess, DcrSubgraph, DcrSpawnContainer, DcrActivity, DcrRelation, DcrEffect, DcrSpawn, DcrConstraint, RelationType, DcrExpression, DcrComputation, DcrExecution


class DcrSemantics:

    @classmethod
    def getRelations(cls, element: DcrElement, graph: DcrGraph, yields: str=None) -> tuple[Set[DcrRelation], Set[DcrRelation]]:
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
                i, o = cls.getRelations(parent, graph, yields)
                incoming.update(i)
                outgoing.update(o)
        return incoming, outgoing
    
    @classmethod
    def getEffects(cls, element: DcrElement, graph: DcrGraph) -> Set[DcrRelation]:
        _, effects = cls.getRelations(element, graph, "effects")
        return effects
    
    @classmethod
    def getConstraints(cls, element: DcrElement, graph: DcrGraph) -> Set[DcrRelation]:
        constraints, _ = cls.getRelations(element, graph, "constraints")
        for sub in graph.getSubprocessParents(element):
            constraints.update(cls.getConstraints(sub, graph))
        return constraints
    
    @classmethod
    def isEnabled(
        cls,
        element: DcrActivity | DcrSubprocess,
        graph: DcrGraph,
        role: str = None,
    ) -> bool:
        if not isinstance(element, DcrActivity):
            return False
        if not cls.isAuthorized(element, role):
            return False
        if not element.effectiveIncluded:
            return False
        if isinstance(element, DcrSubprocess) and element.childrenPending:
            return False
        constraints = cls.getConstraints(element, graph)
        for r in constraints:
            if not cls.constraintPasses(r.source, element, r, graph):
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

    @classmethod
    def getEnabledActivities(
        cls, graph: DcrGraph, role: str = None
    ) -> Set[DcrActivity]:
        """Return activities enabled for the supplied actor role."""
        return {
            element
            for element in graph.elements
            if isinstance(element, DcrActivity)
            and cls.isEnabled(element, graph, role)
        }
    
    @classmethod
    def constraintPasses(cls, source: DcrElement, target: DcrElement, constraint: DcrConstraint, graph: DcrGraph) -> bool:
        if isinstance(source, DcrNesting):
            res = True
            for child in source.children:
                res = res and cls.constraintPasses(child, target, constraint, graph)
            return res
        if source.effectiveIncluded and (constraint.guard is None or cls.evaluateComputation(constraint.guard, graph, source, target)):
            if constraint.relationType == RelationType.C and not source.executed:
                return False
            if constraint.relationType == RelationType.M and source.effectivePending:
                return False
        return True
    
    @classmethod
    def parseAttribute(cls, element: str, attribute: str) -> any:
        match attribute:
            case "id":
                return element + ".ID"
            case "included":
                return element + ".effectiveIncluded"
            case "pending":
                return element + ".effectivePending and " + element + ".effectiveIncluded"  ### Should this care if included?
            case "executed":
                return element + ".executed"
            case "enabled":
                return "cls.isEnabled(" + element + ", graph)"
            case "computation":
                return element + ".computation"
            case "data":
                return element + ".data"
            case "children":
                return element + ".children"
            case "instance":
                return "(cls.getSpawnID(" + element + "))"
            case _:
                return None
    
    @classmethod
    def parseExpression(cls, expression: DcrExpression):
        operators = ["+", "-", "*", "/", "==", "<", ">", "<=", ">=", "and", "or", "not", "is", "in", "for", "(", ")", "[", "]", "len"]
        match expression:
            case (e1, e2):
                if e1 in ["source", "target"]:
                    return cls.parseAttribute(e1, e2)
                else:
                    return cls.parseAttribute("graph.getElementFromID('{}')".format(e1), e2)
            case str():
                if expression in operators:
                    return expression
                elif expression == "inInstance":
                    return ".startswith"
                else:
                    for word in re.split(" |(|)|.", expression):
                        if iskeyword(word):
                            return None
                    return expression
            case int():
                return str(expression)
            case float():
                return str(expression)
    
    @classmethod
    def evaluateComputation(cls, computation: DcrComputation, graph: DcrGraph, source: DcrElement=None, target: DcrElement=None) -> any:
        # Compile a temporary expression so retained XML guard tokens stay intact.
        executable = " ".join(
            cls.parseExpression(expression) for expression in computation
        )
        try:
            res = eval(executable)
        except:
            res = None
        return res

    @classmethod
    def executeActivity(cls, execution: DcrExecution, graph: DcrGraph):
        activity = graph.getActivity(execution.activityID)
        if not cls.isAuthorized(activity, execution.role):
            raise PermissionError(
                "Role {!r} is not authorized to execute activity {}".format(
                    execution.role, activity.ID
                )
            )
        if cls.isEnabled(activity, graph, execution.role):
            if execution.time is None:
                execution.time = datetime.now()
            graph.executions.append(execution)
            cls.execute(activity, graph, execution.input, execution.time)
        else:
            raise Exception("Activity with ID {} is not enabled and cannot be executed".format(activity.ID))
    
    @classmethod
    def execute(cls, element: DcrActivity | DcrSubprocess, graph: DcrGraph, input=None, executionTime=None):
        if element.takesInput and input is not None:
            element.data = input
        elif element.computation is not None:
            element.data = cls.evaluateComputation(element.computation, graph)
        graph.updatePending(element, False)
        element.executed = datetime.now() if executionTime is None else executionTime

        effects = cls.getEffects(element, graph)
        for r in sorted(effects, key=lambda r: r.relationType):
            cls.relateToTarget(element, r.target, r, graph)

        cls.executeSubprocessParent(element, graph)

    @classmethod
    def executeSubprocessParent(cls, element: DcrElement, graph: DcrGraph) -> int:
        parents = graph.getParents(element)
        sub = False
        for parent in parents:
            if isinstance(parent, DcrSubprocess):
                sub = True
                if cls.isEnabled(parent, graph):
                    cls.execute(parent, graph)
            elif isinstance(parent, DcrNesting | DcrSubgraph):
                sub = cls.executeSubprocessParent(parent, graph)
            if sub:
                break
        return sub

    @classmethod
    def relateToTarget(cls, source: DcrElement, target: DcrElement, effect: DcrEffect, graph: DcrGraph):
        if target.isTemplate:
            return
        if isinstance(effect, DcrSpawn):
            if effect.guard is None or cls.evaluateComputation(effect.guard, graph, source, target):
                effect.spawned += 1
                cls.spawn(target, graph, effect.spawned)
        elif isinstance(target, DcrNesting | DcrSubgraph):
            for child in target.children:
                cls.relateToTarget(source, child, effect, graph)
        else:
            if effect.guard is None or cls.evaluateComputation(effect.guard, graph, source, target):
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
                        target.data = cls.evaluateComputation(effect.value, graph, source, target)

    @classmethod
    def spawn(cls, subgraph: DcrSubgraph, graph: DcrGraph, spawnNumber: int):
        spawnID = cls.getSpawnID(subgraph)
        elementDict = {}
        for spawnContainer in subgraph.children:
            elementDict[spawnContainer] = spawnContainer
            for element in spawnContainer.children:
                elementDict.update(cls.spawnElements(element, graph, spawnNumber, spawnID))

        for template in elementDict:
            if isinstance(template, DcrParentElement):
                children = set()
                for child in template.children:
                    if child in elementDict:
                        children.add(elementDict[child])
                elementDict[template].children.update(children)

            if template is not elementDict[template]:
                incoming, outgoing = cls.getRelations(template, graph)
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
                    cls.makeTemplate(container, set(elementDict.values()))
                    cls.spawnSubContainers(container, set(elementDict.values()), graph)

    @classmethod
    def spawnElements(cls, element: DcrElement, graph: DcrGraph, spawnNumber: int, spawnID: str) -> dict[DcrElement, DcrElement]:
        spawns = {}

        if isinstance(element, DcrNesting | DcrSubprocess | DcrSubgraph):
            for child in element.children:
                spawns.update(cls.spawnElements(child, graph, spawnNumber, spawnID))
        
        if cls.getSpawnID(element) == spawnID: # ensures that we only spawn template elements from the correct spawn level
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
    
    @classmethod
    def getSpawnID(cls, element: DcrElement):
        return ''.join(re.findall('Spawn\d+', element.ID))
    
    @classmethod
    def makeTemplate(cls, element: DcrElement, spawned: Set[DcrElement]):
        if not isinstance(element, DcrSpawnContainer) and element in spawned:
            element.isTemplate = True
        if isinstance(element, DcrParentElement):
          for child in element.children:
              cls.makeTemplate(child, spawned)

    @classmethod
    def spawnSubContainers(cls, container: DcrSpawnContainer, spawned: Set[DcrElement], graph: DcrGraph):
        for child in container.children:
            if child in spawned:
                newChild = child
                break
        subContainer = DcrSpawnContainer(newChild.ID + "Container", {newChild})
        graph.elements.add(subContainer)
        container.children.remove(newChild)
        container.children.add(subContainer)

        incoming, outgoing = cls.getRelations(container, graph)
        for i in incoming:
            if not isinstance(i.source, DcrSpawnContainer) and cls.getSpawnID(i.source) == cls.getSpawnID(newChild):
                i.target = subContainer
        for o in outgoing:
            if not isinstance(o.target, DcrSpawnContainer) and cls.getSpawnID(o.target) == cls.getSpawnID(newChild):
                o.source = subContainer

        if isinstance(newChild, DcrNesting | DcrSubprocess):
            for child in newChild.children:
                if isinstance(child, DcrSpawnContainer):
                    cls.spawnSubContainers(child, spawned, graph)


    @classmethod
    def getTopSubgraph(cls, element: DcrElement, graph: DcrGraph, topSub=None):
        parents = graph.getParents(element)
        for parent in parents:
            if isinstance(parent, DcrSubgraph):
                topSub = parent
                break
        if parents:
            return cls.getTopSubgraph(list(parents)[0], graph, topSub)
        return topSub

from enum import IntEnum, auto
from typing import ClassVar, Set, Dict, Callable
from datetime import datetime
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class DcrEventData:
    """Editor metadata for an activity's data variable."""

    name: str
    data_type: type[bool] | type[int] | type[str]
    default: object = None

    TYPE_ALIASES: ClassVar[dict[str, type]] = {
        "Bool": bool,
        "Int": int,
        "String": str,
    }

    def __post_init__(self) -> None:
        # Accept legacy XML type names while storing only canonical Python types.
        data_type = self.TYPE_ALIASES.get(self.data_type, self.data_type)
        if data_type not in {bool, int, str}:
            raise ValueError(f"Unsupported DCR event data type: {self.data_type!r}.")
        object.__setattr__(self, "data_type", data_type)
        object.__setattr__(self, "default", self.coerce(self.default))

    @property
    def value_type(self) -> type[bool] | type[int] | type[str]:
        """Backward-friendly name for the canonical Python value type."""
        return self.data_type

    def coerce(self, value):
        """Convert XML or request values to the declared Python type."""
        if value is None or type(value) is self.data_type:
            return value
        if self.data_type is bool and isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "false"}:
                return normalized == "true"
        elif self.data_type is int and isinstance(value, str):
            try:
                return int(value)
            except ValueError:
                pass
        raise ValueError(
            f"Value {value!r} is not valid for {self.data_type.__name__}."
        )


@dataclass(frozen=True)
class DcrBounds:
    """Diagram bounds retained during editor XML round trips."""

    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class DcrPoint:
    """A relation waypoint in the editor diagram."""

    x: float
    y: float


# Order of enum allows for easily sorting effects for correct order of execution
class RelationType(IntEnum):
    S = auto() # spawn
    E = auto() # exclude
    I = auto() # include
    N = auto() # no-response
    R = auto() # response
    V = auto() # set value
    C = auto() # condition
    M = auto() # milestone

class DcrExecution:
    
    def __init__(self, activityID, input=None, time=None, role=None):
        self.__activityID = activityID
        self.__input = input
        self.__time = time
        self.__role = role


    @property
    def activityID(self) -> str:
        return self.__activityID
    
    @property
    def input(self) -> any:
        return self.__input
    
    @property
    def time(self) -> datetime:
        return self.__time
    
    @time.setter
    def time(self, value: datetime):
        self.__time = value

    @property
    def role(self) -> str | None:
        return self.__role
    

type DcrExpression = str | int | float | tuple[str, str]
type DcrComputation = list[DcrExpression]

class DcrElement(ABC):
    
    def __init__(self, id, template=None):
        self.__id = id
        self.__parentsIncluded = True if template is None else template.parentsIncluded
        self.__isTemplate = False
        self.__bounds = None if template is None else template.bounds

    @property
    def ID(self) -> str:
        return self.__id
    
    @ID.setter
    def ID(self, value: str):
        self.__id = value

    @property
    def parentsIncluded(self) -> bool:
        return self.__parentsIncluded
    
    @parentsIncluded.setter
    def parentsIncluded(self, value: bool):
        self.__parentsIncluded = value

    @property
    @abstractmethod
    def effectiveIncluded(self) -> bool:
        pass

    @property
    @abstractmethod
    def effectivePending(self) -> bool:
        pass

    @property
    def isTemplate(self) -> bool:
        return self.__isTemplate
    
    @isTemplate.setter
    def isTemplate(self, value: bool):
        self.__isTemplate = value

    @property
    def bounds(self) -> DcrBounds | None:
        return self.__bounds

    @bounds.setter
    def bounds(self, value: DcrBounds | None):
        self.__bounds = value

    def __hash__(self) -> int:
        return hash(self.ID)
    
    def __eq__(self, value: object) -> bool:
        return hash(self) == hash(value)
    
    def __str__(self) -> str:
        return self.ID


class DcrActivity(DcrElement):
    
    def __init__(self, id, 
                 label=None,
                 role=None,
                 description=None,
                 priority=None, 
                 included=True, 
                 pending=False, 
                 computation: DcrComputation=None, 
                 takesInput=False, 
                 trusted: bool = True,
                 eventData: DcrEventData=None,
                 template=None, **kwargs):
        super().__init__(id, template=template, **kwargs)
        self.__label = (id if label is None else label) if template is None else template.label
        self.__description = description if template is None else template.description
        self.__role = role if template is None else template.role
        self.__included = included if template is None else template.included
        self.__pending = pending if template is None else template.pending
        self.__executed = None # set as None or a datetime denoting execution time. 
        # Not currently used but for compatability with timed graphs.
        self.__computation = computation if template is None else template.computation

        self.__takesInput = (takesInput or eventData is not None if template is None else template.takesInput)
        self.__eventData = eventData if template is None else template.eventData
        self.__data = self.__eventData.default if self.__eventData is not None else None
        # if self.__takesInput and not self.__eventData:
        #     self.__eventData = DcrEventData()
        # Trust only affects tool calls and defaults to true for compatibility.
        self.__trusted = trusted if template is None else template.trusted
        self.__tool_call = lambda x : x if template is None else template.tool_call
        self.__priority = priority if template is None else template.priority

    @property
    def trusted(self) -> bool:
        return self.__trusted

    @trusted.setter
    def trusted(self, value: bool):
        self.__trusted = value

    @property
    def tool_call(self) -> Callable:
        return self.__tool_call

    @tool_call.setter
    def tool_call(self, value: Callable):
        self.__tool_call = value

    @property
    def description(self) -> str:
        return self.__description
    
    @description.setter
    def description(self, value: str):
        self.__description = value

    @property
    def priority(self) -> float:
        return self.__priority
    
    @priority.setter
    def priority(self, value: float):
        self.__priority = value

    @property
    def role(self) -> str:
        return self.__role
    
    @role.setter
    def role(self, value: str):
        self.__role = value

    @property
    def label(self) -> str:
        return self.__label
    
    @label.setter
    def label(self, value: str):
        self.__label = value

    @property
    def included(self) -> bool:
        return self.__included
    
    @included.setter
    def included(self, value: bool):
        self.__included = value

    @property
    def effectiveIncluded(self) -> bool:
        return self.included and self.parentsIncluded and not self.isTemplate

    @property
    def pending(self) -> bool:
        return self.__pending
    
    @pending.setter
    def pending(self, value: bool):
        self.__pending = value
    
    @property
    def effectivePending(self) -> bool:
        return self.pending and not self.isTemplate

    @property
    def executed(self) -> datetime:
        return self.__executed
    
    @executed.setter
    def executed(self, value: datetime):
        self.__executed = value

    @property
    def computation(self) -> DcrComputation:
        return self.__computation
    
    @property
    def takesInput(self) -> bool:
        return self.__takesInput

    @takesInput.setter
    def takesInput(self, value: bool):
        self.__takesInput = value

    @property
    def eventData(self) -> DcrEventData | None:
        return self.__eventData

    @eventData.setter
    def eventData(self, value: DcrEventData | None):
        self.__eventData = value
        self.__takesInput = value is not None

    @property
    def data(self) -> any:
        return self.__data
    
    @data.setter
    def data(self, value: any):
        self.__data = (
            self.__eventData.coerce(value) if self.__eventData is not None else value
        )


class DcrParentElement(DcrElement):
    
    def __init__(self, id, children=None, template = None):
        if not (isinstance(self, DcrNesting) or isinstance(self, DcrSubgraph) or isinstance(self, DcrSubprocess)):
            raise Exception("Dcr elements with children must be instances of DcrNesting, DcrSubgraph, DcrSubprocess or DcrSpawnContainer, not DcrParentElement directly")
        super().__init__(id, template)
        self.__children = set() if children is None else children
        self.__childrenPending = False if template is None else template.childrenPending
        self.__label = id if template is None else template.label
        self.__description = None if template is None else template.description
        self.__role = None if template is None else template.role

    @property
    def children(self) -> Set[DcrElement]:
        return self.__children
    
    @children.setter
    def children(self, value: Set[DcrElement]):
        self.__children = value

    @property
    def childrenPending(self) -> bool:
        return self.__childrenPending
    
    @childrenPending.setter
    def childrenPending(self, value: bool):
        self.__childrenPending = value

    @property
    def label(self) -> str:
        return self.__label

    @label.setter
    def label(self, value: str):
        self.__label = value

    @property
    def description(self) -> str | None:
        return self.__description

    @description.setter
    def description(self, value: str | None):
        self.__description = value

    @property
    def role(self) -> str | None:
        return self.__role

    @role.setter
    def role(self, value: str | None):
        self.__role = value

    @property
    def effectivePending(self) -> bool:
        return self.childrenPending and not self.isTemplate
    
    @property
    def included(self) -> bool:
        return True

    @property
    def effectiveIncluded(self) -> bool:
        return self.parentsIncluded and not self.isTemplate
    

class DcrSubprocess(DcrActivity, DcrParentElement):
    
    def __init__(
        self, id, children=None, included=True, pending=False,
        computation=None, trusted=True, template=None
    ):
        super().__init__(
            id=id,
            included=included,
            pending=pending,
            computation=computation,
            takesInput=False,
            trusted=trusted,
            template=template,
            children=children,
        )
    

class DcrNesting(DcrParentElement):
    
    def __init__(self, id, children=None, template = None):
        super().__init__(id, children, template)


class DcrSubgraph(DcrParentElement):
    
    def __init__(self, id, children=None, template = None):
        super().__init__(id, children, template)


class DcrSpawnContainer(DcrNesting):
    
    def __init__(self, id, children=None, template = None):
        super().__init__(id, children, template)


class DcrRelation:
    
    def __init__(self, relationType: RelationType, source: DcrElement, target: DcrElement, guard: DcrComputation=None, forAll=False):
        if not (isinstance(self, DcrEffect) or isinstance(self, DcrConstraint,)):
            raise Exception("Relations must be instances of DcrConstraint, DcrEffect, DcrSetValue or DcrSpawn, not DcrRelation Directly")
        self.__relationType = relationType
        self.__source = source
        self.__target = target
        self.__guard = guard
        self.__forAll = forAll
        self.__id = None
        self.__waypoints = []

    @property
    def relationType(self) -> RelationType:
        return self.__relationType
    
    @relationType.setter
    def relationType(self, value: RelationType):
        self.__relationType = value

    @property
    def source(self) -> DcrElement:
        return self.__source
    
    @source.setter
    def source(self, value: DcrElement):
        self.__source = value

    @property
    def target(self) -> DcrElement:
        return self.__target
    
    @target.setter
    def target(self, value: DcrElement):
        self.__target = value

    @property
    def guard(self) -> DcrComputation:
        return self.__guard
    
    @guard.setter
    def guard(self, value: DcrComputation):
        self.__guard = value

    @property
    def forAll(self) -> bool:
        return self.__forAll
    
    @forAll.setter
    def forAll(self, value: bool):
        self.__forAll = value

    @property
    def ID(self) -> str | None:
        return self.__id

    @ID.setter
    def ID(self, value: str | None):
        self.__id = value

    @property
    def waypoints(self) -> list[DcrPoint]:
        return self.__waypoints

    @waypoints.setter
    def waypoints(self, value: list[DcrPoint]):
        self.__waypoints = value
    
    def __repr__(self):
        return "Relation type: " + str(self.relationType) + ", Source: " + str(self.source) + ", Target: " + str(self.target) + ", Guard: " + str(self.guard)

    def __hash__(self) -> int:
        return hash(repr(self))
    
    def __eq__(self, value: object) -> bool:
        return hash(self) == hash(value)


class DcrEffect(DcrRelation):
    
    def __init__(self, relationType, source, target, guard=None, forAll=False):
        if relationType not in [RelationType.I, RelationType.E, RelationType.R, RelationType.N, RelationType.V, RelationType.S]:
            raise Exception("Effects must be include, exclude, response, noresponse, setValue, or spawn")
        if relationType == RelationType.S and type(self) is not DcrSpawn:
            raise Exception("Spawn relations must be instances of DcrSpawn, not DcrEffect directly")
        if relationType == RelationType.V and type(self) is not DcrSetValue:
            raise Exception("Set value relations must be instances of DcrSetValue, not DcrEffect directly")
        super().__init__(relationType, source, target, guard, forAll)
    

class DcrSpawn(DcrEffect):
    
    def __init__(self, source, target, guard=None, forAll=False):
        super().__init__(RelationType.S, source, target, guard, forAll)
        self.__spawned = 0
    
    @property
    def spawned(self) -> int:
        return self.__spawned
    
    @spawned.setter
    def spawned(self, value: int):
        self.__spawned = value


class DcrSetValue(DcrEffect):
    
    def __init__(self, source, target, value, guard=None, forAll=False):
        super().__init__(RelationType.V, source, target, guard, forAll)
        self.__value = value

    @property
    def value(self) -> DcrComputation:
        return self.__value
    
    @value.setter
    def value(self, computation: DcrComputation):
        self.__value = computation


class DcrConstraint(DcrRelation):
    
    def __init__(self, relationType, source, target, guard=None, forAll=False):
        if relationType not in [RelationType.C, RelationType.M]:
            raise Exception("Constraints must be condition or milestone")
        super().__init__(relationType, source, target, guard, forAll)


class DcrGraph:
    
    def __init__(self, id,title="",description="", executions=[], elements=set(), relations=set(), template=None):
        self.__id = id
        self.__title = title
        self.__description = description
        self.__elements = elements if template is None else template.elements
        self.__relations = relations if template is None else template.relations
        self.__executions = executions if template is None else template.executions
        self.__activityMap = {}
        self.__labelMap = {}

        self.initialiseGraph()

    @property
    def ID(self) -> str:
        return self.__id
    
    @ID.setter
    def ID(self, value: str):
        self.__id = value

    @property
    def title(self) -> str:
        return self.__title
    
    @title.setter
    def title(self, value: str):
        self.__title = value

    @property
    def description(self) -> str:
        return self.__description
    
    @description.setter
    def description(self, value: str):
        self.__description = value

    @property
    def elements(self) -> Set[DcrElement]:
        return self.__elements

    @elements.setter
    def elements(self, value: Set[DcrElement]):
        self.__elements = value

    @property
    def relations(self) -> Set[DcrRelation]:
        return self.__relations
    
    @relations.setter
    def relations(self, value: Set[DcrRelation]):
        self.__relations = value

    @property
    def executions(self) -> list[DcrExecution]:
        return self.__executions

    @executions.setter
    def executions(self, value: list[DcrExecution]):
        self.__executions = value

    @property
    def activityMap(self) -> Dict[str, DcrActivity]:
        return self.__activityMap

    @activityMap.setter
    def activityMap(self, value: Dict[str, DcrActivity]):
        self.__activityMap = value

    @property
    def labelMap(self) -> Dict[str, Set[DcrActivity]]:
        return self.__labelMap
    
    @labelMap.setter
    def labelMap(self, value: Dict[str, Set[DcrActivity]]):
        self.__labelMap = value



    def getParents(self, element: DcrElement) -> Set[DcrParentElement]:
        parents = set()
        for e in self.elements:
            if isinstance(e, DcrParentElement) and element in e.children:
                parents.add(e)
        return parents
    
    def updateIncluded(self, element: DcrElement, value: bool=None):
        if value is not None:
            element.included = value
        if isinstance(element, DcrParentElement):
          for child in element.children:
              if not element.effectiveIncluded and child.parentsIncluded:
                  child.parentsIncluded = False
                  self.updateIncluded(child)
              else:
                  oldState = child.parentsIncluded
                  child.parentsIncluded = True
                  parents = self.getParents(child)
                  for parent in parents:
                      child.parentsIncluded = child.parentsIncluded and parent.effectiveIncluded
                  if child.parentsIncluded != oldState:
                      self.updateIncluded(child)
    
    def updatePending(self, element: DcrElement, value: bool=None):
        if value is not None:
            element.pending = value
        parents = self.getParents(element)
        for parent in parents:
            if  element.effectivePending and element.included and not parent.childrenPending:
                parent.childrenPending = True
                self.updatePending(parent)
            else:
                oldState = parent.childrenPending
                parent.childrenPending = False
                for child in parent.children:
                    parent.childrenPending = parent.childrenPending or child.effectivePending and child.included
                if parent.childrenPending != oldState:
                    self.updatePending(parent)
    
    def hasAsParent(self, child: DcrElement, element: DcrElement) -> bool:
        parents = self.getParents(child)
        if element in parents:
            return True
        else:
            res = False
            for parent in parents:
                res = res or self.hasAsParent(parent, element)
            return res
    
    def initiateSpawnContainers(self, element: DcrElement, subgraph: DcrSubgraph) -> Set[DcrSpawnContainer]:
        containers = set()
        if isinstance(element, DcrSpawnContainer):
            containers.add(element)
        else:
            element.isTemplate = True
            container = DcrSpawnContainer(element.ID + "Container", {element})
            containers.add(container)
            for r in self.relations:
                if r.source == element and (r.forAll or not self.hasAsParent(r.target, subgraph)):
                    r.source = container
                if r.target == element and (r.forAll or not self.hasAsParent(r.source, subgraph)):
                    r.target = container
        if isinstance(element, DcrNesting | DcrSubprocess):
            for child in element.children:
                containers.update(self.initiateSpawnContainers(child, subgraph))
        return containers

    def getSubprocessParents(self, element: DcrElement) -> Set[DcrSubprocess]:
        subprocesses = set()
        parents = self.getParents(element)
        for parent in parents:
            if isinstance(parent, DcrSubprocess):
                subprocesses.add(parent)
            else:
                subprocesses.update(self.getSubprocessParents(parent))
        return subprocesses

    def initialiseGraph(self):
        spawnContainers = set()
        elementIDs = set()
        for element in self.elements:
            if element.ID in elementIDs:
                raise Exception("More than one element with ID {} in graph".format(element.ID))
            else: elementIDs.add(element.ID)

            if len(self.getSubprocessParents(element)) > 1:
                raise Exception("Element with ID {} is part of more than one subprocesses".format(element.ID))

            if isinstance(element, DcrSubgraph):
                for relation in self.relations:
                    if relation.target == element and not isinstance(relation, DcrSpawn):
                        raise Exception("Subgraph with ID {} is the target of a non-spawn relation".format(element.ID))
                    if relation.source == element:
                        raise Exception("Subgraph with ID {} is the source of one or more relations and should not be".format(element.ID))
                containers = set()
                for child in element.children:
                    containers.update(self.initiateSpawnContainers(child, element))
                element.children = containers
                spawnContainers.update(containers)

        for element in self.elements:
            if isinstance(element, DcrActivity):
                if type(element) is DcrActivity:
                    self.activityMap[element.ID] = element
                if element.label in self.labelMap:
                    self.labelMap[element.label].add(element)
                else:
                    self.labelMap[element.label] = {element}
                if not element.effectiveIncluded:
                    self.updateIncluded(element)
                if element.effectivePending:
                    self.updatePending(element)

        self.elements.update(spawnContainers)
        for relation in self.relations:
            if isinstance(relation, DcrSpawn) and not isinstance(relation.target, DcrSubgraph | DcrSpawnContainer):
                raise Exception("Non-subgraph element with ID {} is the target of a spawn relation".format(relation.target.ID))
        self.executions = []

    def getExecutionID(self, activity: DcrActivity) -> str:
        for executionID, dcrActivity in self.activityMap.items():
            if activity == dcrActivity:
                return executionID

    def getActivity(self, executionID: str) -> DcrActivity:
        return self.activityMap[executionID]
    
    def getElementFromID(self, ID: str) -> DcrElement:
        for e in self.elements:
            if e.ID == ID:
                return e
        return None
    
    def getLabel(self, element: DcrActivity) -> str:
        for label, elements in self.labelMap.items():
            if element in elements:
                return label
            
    def getElementsFromLabel(self, label: str) -> Set[DcrActivity]:
        return self.labelMap[label]

    def getConstraints(self) -> int:
        return len(self.__relations)

    def isAccepting(self) -> bool:
        for e in self.elements:
            if isinstance(e, DcrActivity) and e.pending and e.included:
                return False
        return True

    #     #Mikkels code
    #
    # def isAccepting(self) -> bool:
    #     for e in self.elements:
    #         if isinstance(e, DcrActivity) and not self.getSubprocessParents(e) and e.pending and e.included:
    #             return False
    #     return True

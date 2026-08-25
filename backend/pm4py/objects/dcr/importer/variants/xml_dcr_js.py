"""Import the editor XML produced by the DCR.js frontend."""

from __future__ import annotations

import ast
import json
import math
import re
from datetime import datetime

from lxml import etree

from pm4py.objects.dcr.ocdcr.obj import (
    DcrActivity,
    DcrBounds,
    DcrConstraint,
    DcrEffect,
    DcrEventData,
    DcrGraph,
    DcrNesting,
    DcrPoint,
    DcrSetValue,
    DcrSpawn,
    DcrSubgraph,
    DcrSubprocess,
    RelationType,
)
from pm4py.util import constants
from tools.tool_call import ToolCall


DCR_NAMESPACE = "http://tk/schema/dcr"
DCR_DI_NAMESPACE = "http://tk/schema/dcrDi"
DC_NAMESPACE = "http://www.omg.org/spec/DD/20100524/DC"
DCR_TAG = f"{{{DCR_NAMESPACE}}}"
DCR_DI_TAG = f"{{{DCR_DI_NAMESPACE}}}"
DC_TAG = f"{{{DC_NAMESPACE}}}"


def apply(path, parameters=None) -> DcrGraph:
    """Read a DCR.js editor XML file into an object-centric DCR graph."""
    parser = etree.XMLParser(
        remove_comments=True, resolve_entities=False, no_network=True
    )
    return _EditorXmlImporter(etree.parse(path, parser).getroot()).parse()


def import_from_string(dcr_string, parameters=None) -> DcrGraph:
    """Read DCR.js editor XML from a string or bytes value."""
    if isinstance(dcr_string, str):
        dcr_string = dcr_string.encode(constants.DEFAULT_ENCODING)
    parser = etree.XMLParser(
        remove_comments=True, resolve_entities=False, no_network=True
    )
    return _EditorXmlImporter(etree.fromstring(dcr_string, parser)).parse()


class _EditorXmlImporter:
    DATA_TYPES = {"Bool": bool, "Int": int, "String": str}
    ELEMENT_TYPES = {
        "condition": (DcrConstraint, RelationType.C),
        "milestone": (DcrConstraint, RelationType.M),
        "response": (DcrEffect, RelationType.R),
        "include": (DcrEffect, RelationType.I),
        "exclude": (DcrEffect, RelationType.E),
        "noresponse": (DcrEffect, RelationType.N),
    }
    TOKEN_PATTERN = re.compile(
        r"\s+|\d+(?:\.\d+)?|\"(?:\\.|[^\"])*\"|'(?:\\.|[^'])*'|"
        r">=|<=|!=|==|=|>|<|\+|-|\*|/|\(|\)|[A-Za-z_][A-Za-z0-9_]*"
    )

    def __init__(self, root) -> None:
        self.root = root
        self.elements = set()
        self.elements_by_id = {}
        self.variables = {}
        self.bounds_by_id = {}
        self.relation_layout_by_id = {}
        self._parse_diagram()

    def parse(self) -> DcrGraph:
        graph_element = self._graph_element()
        for child in graph_element:
            self._parse_element(child)
        relations = {
            self._parse_relation(element)
            for element in graph_element.iter(f"{DCR_TAG}relation")
        }
        return DcrGraph(
            graph_element.get("id"),
            graph_element.get("title"),
            graph_element.get("description"),
            executions=[],
            elements=self.elements,
            relations=relations,
        )

    def _graph_element(self):
        graph = (
            self.root
            if self.root.tag == f"{DCR_TAG}dcrGraph"
            else self.root.find(f"{DCR_TAG}dcrGraph")
        )
        if graph is None or not graph.get("id"):
            raise ValueError("Editor XML must contain a DCR graph with an id.")
        return graph

    def _parse_element(self, element):
        element_type = etree.QName(element).localname
        if element_type not in {"event", "nesting", "subProcess"}:
            return None

        children = {
            child
            for xml_child in element
            if (child := self._parse_element(xml_child)) is not None
        }
        element_id = element.get("id")
        if not element_id or element_id in self.elements_by_id:
            raise ValueError(f"Missing or duplicate DCR element id: {element_id!r}.")

        if element_type == "event":
            label = element.get("label")
            description = element.get("description")
            if label is None:
                label = description
            event_data = self._parse_event_data(element)
            parsed = DcrActivity(
                element_id,
                role=element.get("role"),
                description=description,
                label=element_id if label is None else label,
                included=self._boolean(element, "included", True),
                pending=self._boolean(element, "pending", False),
                computation=self._parse_computation_attribute(
                    element, "computation"
                ),
                takesInput=self._boolean(
                    element, "takesInput", event_data is not None
                ),
                eventData=event_data,
            )
        elif element_type == "nesting":
            parsed = DcrNesting(element_id, children)
        elif self._boolean(element, "multi-instance", False):
            parsed = DcrSubgraph(element_id, children)
        else:
            parsed = DcrSubprocess(
                element_id,
                children,
                included=self._boolean(element, "included", True),
                pending=self._boolean(element, "pending", False),
                computation=self._parse_computation_attribute(
                    element, "computation"
                ),
            )
        if element_type != "event":
            description = element.get("description")
            parsed.label = element.get("label", description or element_id)
            parsed.description = description
            parsed.role = element.get("role")

        parsed.bounds = self.bounds_by_id.get(element_id)

        if isinstance(parsed, DcrActivity):
            parsed.priority = self._priority(element)
            parsed.trusted = self._boolean(element, "trusted", True)
            parsed.takesInput = self._boolean(
                element, "takesInput", parsed.eventData is not None
            )
            tool_name = element.get("toolCall")
            if tool_name is not None:
                try:
                    parsed.tool_call = ToolCall(tool_name)
                except ValueError as exc:
                    raise ValueError(
                        f"Unknown DCR tool call: {tool_name!r}."
                    ) from exc
            if self._boolean(element, "executed", False):
                # Editor XML stores only the executed flag, not its timestamp.
                parsed.executed = datetime.min
        self.elements.add(parsed)
        self.elements_by_id[element_id] = parsed
        return parsed

    def _parse_event_data(self, element) -> DcrEventData | None:
        event_data = element.find(f"{DCR_TAG}eventData")
        if event_data is None:
            return None
        name = event_data.get("name")
        if not name or name in self.variables:
            raise ValueError(f"Missing or duplicate event variable name: {name!r}.")
        value_type = event_data.get("type")
        if value_type not in self.DATA_TYPES:
            raise ValueError(f"Unsupported event data type: {value_type!r}.")
        self.variables[name] = element.get("id")
        default = event_data.get("default")
        return DcrEventData(name, self.DATA_TYPES[value_type], default)

    def _parse_relation(self, element):
        relation_type = (element.get("type") or "").lower()
        source = self._element_reference(element, "sourceRef")
        target = self._element_reference(element, "targetRef")
        guard = self._parse_computation_attribute(element, "guardComputation")
        if guard is None:
            guard = self._parse_expression(element.get("guard"))
        for_all = self._boolean(element, "forAll", False)
        if relation_type == "spawn":
            relation = DcrSpawn(source, target, guard=guard, forAll=for_all)
        elif relation_type in {"setvalue", "update"}:
            value = self._parse_computation_attribute(
                element, "valueComputation"
            )
            if value is None:
                value = self._parse_expression(element.get("value"), required=True)
            relation = DcrSetValue(
                source, target, value, guard=guard, forAll=for_all
            )
        else:
            try:
                relation_class, relation_enum = self.ELEMENT_TYPES[relation_type]
            except KeyError as exc:
                raise ValueError(
                    f"Unsupported DCR relation type: {relation_type!r}."
                ) from exc
            relation = relation_class(
                relation_enum, source, target, guard=guard, forAll=for_all
            )
        relation.ID = element.get("id")
        relation.waypoints = self.relation_layout_by_id.get(relation.ID, [])
        return relation

    def _element_reference(self, relation, attribute):
        element_id = relation.get(attribute)
        try:
            return self.elements_by_id[element_id]
        except KeyError as exc:
            raise ValueError(
                f"Relation references unknown DCR element: {element_id!r}."
            ) from exc

    def _parse_expression(self, expression, required=False):
        if not expression:
            if required:
                raise ValueError("Set-value relations require a value expression.")
            return None
        tokens = self.TOKEN_PATTERN.findall(expression)
        if re.sub(r"\s+", "", "".join(tokens)) != re.sub(r"\s+", "", expression):
            raise ValueError(f"Unsupported guard expression: {expression!r}.")

        computation = []
        for token in tokens:
            if token.isspace():
                continue
            if token in {"true", "false"}:
                computation.append(token == "true")
            elif token in {"and", "or", "not"}:
                computation.append(token)
            elif token in self.variables:
                computation.append((self.variables[token], "data"))
            elif token == "=":
                computation.append("==")
            elif token[0] in {'"', "'"}:
                computation.append(repr(ast.literal_eval(token)))
            elif re.fullmatch(r"\d+(?:\.\d+)?", token):
                computation.append(float(token) if "." in token else int(token))
            elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", token):
                raise ValueError(f"Guard references unknown variable: {token!r}.")
            else:
                computation.append(token)
        return computation

    def _parse_computation_attribute(self, element, attribute):
        value = element.get(attribute)
        if value is None:
            return None
        try:
            encoded = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Invalid {attribute} JSON: {value!r}."
            ) from exc
        if not isinstance(encoded, list):
            raise ValueError(f"{attribute} must encode a computation list.")

        computation = []
        for token in encoded:
            if isinstance(token, dict):
                reference = token.get("tuple")
                if (
                    set(token) != {"tuple"}
                    or not isinstance(reference, list)
                    or len(reference) not in {2, 4}
                    or not all(isinstance(part, str) for part in reference)
                ):
                    raise ValueError(
                        f"Invalid tuple token in {attribute}: {token!r}."
                    )
                computation.append(tuple(reference))
            elif type(token) in {str, bool, int, float} and not (
                isinstance(token, float) and not math.isfinite(token)
            ):
                computation.append(token)
            else:
                raise ValueError(
                    f"Unsupported token in {attribute}: {token!r}."
                )
        return computation

    def _parse_diagram(self) -> None:
        for shape in self.root.iter(f"{DCR_DI_TAG}dcrShape"):
            bounds = shape.find(f"{DC_TAG}Bounds")
            if bounds is not None and shape.get("boardElement"):
                self.bounds_by_id[shape.get("boardElement")] = DcrBounds(
                    *(
                        self._number(bounds.get(attribute), attribute)
                        for attribute in ("x", "y", "width", "height")
                    )
                )
        for relation in self.root.iter(f"{DCR_DI_TAG}relation"):
            relation_id = relation.get("boardElement")
            if relation_id:
                self.relation_layout_by_id[relation_id] = [
                    DcrPoint(
                        self._number(point.get("x"), "x"),
                        self._number(point.get("y"), "y"),
                    )
                    for point in relation.iter(f"{DCR_DI_TAG}waypoint")
                ]

    @staticmethod
    def _number(value, attribute):
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid diagram {attribute} coordinate: {value!r}.") from exc

    @staticmethod
    def _priority(element):
        value = element.get("priority")
        if value is None:
            return None
        try:
            priority = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid activity priority: {value!r}.") from exc
        if not math.isfinite(priority):
            raise ValueError(f"Invalid activity priority: {value!r}.")
        return priority

    @staticmethod
    def _boolean(element, attribute, default):
        value = element.get(attribute)
        return default if value is None else value.lower() == "true"

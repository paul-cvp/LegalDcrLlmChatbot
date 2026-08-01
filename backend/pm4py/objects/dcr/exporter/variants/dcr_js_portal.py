"""Export object-centric DCR graphs to the DCR.js editor XML format."""

from __future__ import annotations

import math

from lxml import etree

from pm4py.objects.dcr.ocdcr.obj import (
    DcrActivity,
    DcrBounds,
    DcrGraph,
    DcrNesting,
    DcrParentElement,
    DcrPoint,
    DcrRelation,
    DcrSetValue,
    DcrSpawnContainer,
    DcrSubgraph,
    RelationType,
)


DCR_NAMESPACE = "http://tk/schema/dcr"
DCR_DI_NAMESPACE = "http://tk/schema/dcrDi"
DC_NAMESPACE = "http://www.omg.org/spec/DD/20100524/DC"
NSMAP = {"dcr": DCR_NAMESPACE, "dcrDi": DCR_DI_NAMESPACE, "dc": DC_NAMESPACE}

RELATION_NAMES = {
    RelationType.S: "spawn",
    RelationType.E: "exclude",
    RelationType.I: "include",
    RelationType.N: "noresponse",
    RelationType.R: "response",
    RelationType.V: "setValue",
    RelationType.C: "condition",
    RelationType.M: "milestone",
}

XML_DATA_TYPES = {bool: "Bool", int: "Int", str: "String"}


def export_dcr_xml(
    graph: DcrGraph,
    output_file_name,
    dcr_title="DCR from pm4py",
    replace_whitespace=" ",
):
    """Write a canonical object-centric graph as DCR.js editor XML."""
    del dcr_title, replace_whitespace  # Retained for exporter API compatibility.
    tree = etree.ElementTree(_EditorXmlExporter(graph).build())
    tree.write(
        output_file_name,
        pretty_print=True,
        xml_declaration=True,
        encoding="utf-8",
    )


def export_as_string(graph: DcrGraph, parameters=None) -> bytes:
    """Serialize a canonical graph without writing it to the file system."""
    del parameters
    return etree.tostring(
        _EditorXmlExporter(graph).build(),
        pretty_print=True,
        xml_declaration=True,
        encoding="utf-8",
    )


class _EditorXmlExporter:
    def __init__(self, graph: DcrGraph) -> None:
        if not isinstance(graph, DcrGraph):
            raise TypeError("DCR.js export requires an ocdcr.obj.DcrGraph instance.")
        self.graph = graph
        self.elements = {
            element for element in graph.elements
            if not isinstance(element, DcrSpawnContainer)
        }
        self.element_ids = self._build_element_ids()
        self.parents = self._parent_map()
        self.bounds = {
            element: element.bounds for element in self.elements if element.bounds
        }
        self.reserved_relation_ids = {
            relation.ID
            for relation in graph.relations
            if relation.ID and relation.ID.startswith("Relation_")
        }
        self.relation_ids = {}
        self._layout_missing_elements()

    def build(self):
        definitions = etree.Element(
            etree.QName(DCR_NAMESPACE, "definitions"), nsmap=NSMAP
        )
        graph_xml = etree.SubElement(
            definitions, etree.QName(DCR_NAMESPACE, "dcrGraph"), id=self.graph.ID
        )
        self._optional_attribute(graph_xml, "title", self.graph.title)
        self._optional_attribute(
            graph_xml, "description", self.graph.description
        )
        for element in sorted(self._roots(), key=lambda item: item.ID):
            graph_xml.append(self._element_xml(element))
        for relation in sorted(self.graph.relations, key=self._relation_sort_key):
            graph_xml.append(self._relation_xml(relation))
        definitions.append(self._diagram_xml())
        return definitions

    def _element_xml(self, element):
        if type(element) is DcrActivity:
            tag = "event"
        elif isinstance(element, DcrNesting) and not isinstance(element, DcrSubgraph):
            tag = "nesting"
        else:
            tag = "subProcess"
        xml = etree.Element(
            etree.QName(DCR_NAMESPACE, tag), id=self.element_ids[element]
        )
        self._optional_attribute(xml, "label", getattr(element, "label", None))
        self._optional_attribute(xml, "role", getattr(element, "role", None))
        self._optional_attribute(
            xml, "description", getattr(element, "description", None)
        )
        if isinstance(element, DcrActivity):
            priority = getattr(element, "priority", None)
            if priority is not None:
                xml.set("priority", self._priority(priority))
            xml.set("included", self._boolean(element.included))
            xml.set("executed", self._boolean(element.executed is not None))
            xml.set("pending", self._boolean(element.pending))
        if isinstance(element, DcrSubgraph):
            xml.set("multi-instance", "true")
        if type(element) is DcrActivity and element.eventData is not None:
            data = element.eventData
            event_data = etree.SubElement(
                xml,
                etree.QName(DCR_NAMESPACE, "eventData"),
                name=data.name,
                type=XML_DATA_TYPES[data.data_type],
            )
            if data.default is not None:
                event_data.set("default", self._scalar(data.default))
        if isinstance(element, DcrParentElement):
            for child in sorted(self._children(element), key=lambda item: item.ID):
                xml.append(self._element_xml(child))
        return xml

    def _relation_xml(self, relation: DcrRelation):
        relation_id = self._relation_id(relation)
        xml = etree.Element(
            etree.QName(DCR_NAMESPACE, "relation"),
            id=relation_id,
            type=RELATION_NAMES[relation.relationType],
            sourceRef=self.element_ids[relation.source],
            targetRef=self.element_ids[relation.target],
        )
        if relation.guard:
            xml.set("guard", self._expression(relation.guard, relation))
        if relation.forAll:
            xml.set("forAll", "true")
        if isinstance(relation, DcrSetValue):
            xml.set("value", self._expression(relation.value, relation))
        return xml

    def _diagram_xml(self):
        board = etree.Element(
            etree.QName(DCR_DI_NAMESPACE, "dcrRootBoard"), id="dcrRootBoard"
        )
        plane = etree.SubElement(
            board,
            etree.QName(DCR_DI_NAMESPACE, "dcrPlane"),
            id="dcrPlane",
            boardElement=self.graph.ID,
        )
        for element in sorted(self.elements, key=lambda item: item.ID):
            shape = etree.SubElement(
                plane,
                etree.QName(DCR_DI_NAMESPACE, "dcrShape"),
                id=f"{self.element_ids[element]}_id",
                boardElement=self.element_ids[element],
            )
            bounds = self.bounds[element]
            etree.SubElement(
                shape,
                etree.QName(DC_NAMESPACE, "Bounds"),
                x=self._number(bounds.x),
                y=self._number(bounds.y),
                width=self._number(bounds.width),
                height=self._number(bounds.height),
            )
        for relation in sorted(self.graph.relations, key=self._relation_sort_key):
            relation_id = self._relation_id(relation)
            diagram_relation = etree.SubElement(
                plane,
                etree.QName(DCR_DI_NAMESPACE, "relation"),
                id=f"{relation_id}_di",
                boardElement=relation_id,
            )
            waypoints = relation.waypoints or self._route(relation)
            for point in waypoints:
                etree.SubElement(
                    diagram_relation,
                    etree.QName(DCR_DI_NAMESPACE, "waypoint"),
                    x=self._number(point.x),
                    y=self._number(point.y),
                )
        return board

    def _parent_map(self):
        parents = {}
        for parent in self.graph.elements:
            if not isinstance(parent, DcrParentElement):
                continue
            for child in self._children(parent):
                if child in self.elements:
                    parents[child] = parent
        return parents

    def _roots(self):
        return {
            element for element in self.elements
            if element not in self.parents and not element.isTemplate
        }

    @staticmethod
    def _children(parent):
        children = set()
        for child in parent.children:
            if isinstance(child, DcrSpawnContainer):
                children.update(child.children)
            else:
                children.add(child)
        return children

    def _layout_missing_elements(self):
        counter = 0
        for element in sorted(self.elements, key=lambda item: item.ID):
            if element in self.bounds or isinstance(element, DcrParentElement):
                continue
            column, row = counter % 4, counter // 4
            self.bounds[element] = DcrBounds(
                50 + column * 300, 50 + row * 220, 130, 150
            )
            counter += 1
        for root in sorted(self._roots(), key=lambda item: item.ID):
            self._layout_parent(root)

    def _layout_parent(self, element):
        if not isinstance(element, DcrParentElement):
            return self.bounds[element]
        children = sorted(self._children(element), key=lambda item: item.ID)
        for child in children:
            self._layout_parent(child)
        if element not in self.bounds:
            child_bounds = [self.bounds[child] for child in children]
            if child_bounds:
                left = min(bounds.x for bounds in child_bounds) - 30
                top = min(bounds.y for bounds in child_bounds) - 30
                right = max(bounds.x + bounds.width for bounds in child_bounds) + 30
                bottom = max(bounds.y + bounds.height for bounds in child_bounds) + 30
                self.bounds[element] = DcrBounds(
                    left, top, right - left, bottom - top
                )
            else:
                self.bounds[element] = DcrBounds(50, 50, 190, 210)
        return self.bounds[element]

    def _route(self, relation):
        source = self.bounds[relation.source]
        target = self.bounds[relation.target]
        if relation.source == relation.target:
            middle = source.x + source.width / 2
            bottom = source.y + source.height
            return [
                DcrPoint(middle, bottom),
                DcrPoint(middle, bottom + 25),
                DcrPoint(source.x - 25, bottom + 25),
                DcrPoint(source.x - 25, source.y + source.height / 2),
                DcrPoint(source.x, source.y + source.height / 2),
            ]
        start = DcrPoint(
            source.x + source.width, source.y + source.height / 2
        )
        end = DcrPoint(target.x, target.y + target.height / 2)
        middle = (start.x + end.x) / 2
        return [start, DcrPoint(middle, start.y), DcrPoint(middle, end.y), end]

    def _expression(self, computation, relation):
        tokens = []
        for token in computation:
            if isinstance(token, tuple):
                element_id, attribute = token
                if element_id == "source":
                    element_id = relation.source.ID
                elif element_id == "target":
                    element_id = relation.target.ID
                element = self.graph.getElementFromID(element_id)
                if attribute != "data" or not isinstance(element, DcrActivity):
                    raise ValueError(f"Unsupported DCR expression reference: {token!r}.")
                if element.eventData is None:
                    raise ValueError(
                        f"Activity {element.ID!r} has no event-data variable."
                    )
                tokens.append(element.eventData.name)
            elif isinstance(token, bool):
                tokens.append(self._boolean(token))
            else:
                tokens.append(str(token))
        return " ".join(tokens)

    def _relation_id(self, relation):
        if relation in self.relation_ids:
            return self.relation_ids[relation]
        base = relation.ID or (
            f"{self.element_ids[relation.source]}"
            f"{self.element_ids[relation.target]}"
            f"{RELATION_NAMES[relation.relationType]}"
        )
        if not base.startswith("Relation_"):
            base = f"Relation_{base}"
        used = set(self.relation_ids.values()) | (
            self.reserved_relation_ids - {relation.ID}
        )
        candidate, suffix = base, 2
        while candidate in used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        self.relation_ids[relation] = candidate
        return candidate

    def _build_element_ids(self):
        element_ids = {}
        used = {}
        for element in sorted(self.elements, key=lambda item: item.ID):
            prefix = self._element_prefix(element)
            element_id = (
                element.ID
                if element.ID.startswith(prefix)
                else f"{prefix}{element.ID}"
            )
            if element_id in used:
                raise ValueError(
                    f"DCR element IDs {used[element_id]!r} and {element.ID!r} "
                    f"both export as {element_id!r}."
                )
            element_ids[element] = element_id
            used[element_id] = element.ID
        return element_ids

    @staticmethod
    def _element_prefix(element):
        if type(element) is DcrActivity:
            return "Event_"
        if isinstance(element, DcrNesting) and not isinstance(element, DcrSubgraph):
            return "Nesting_"
        return "SubProcess_"

    @staticmethod
    def _relation_sort_key(relation):
        return (
            relation.source.ID,
            relation.target.ID,
            int(relation.relationType),
            relation.ID or "",
        )

    @staticmethod
    def _optional_attribute(element, name, value):
        if value is not None:
            element.set(name, str(value))

    @staticmethod
    def _boolean(value):
        return "true" if value else "false"

    @classmethod
    def _scalar(cls, value):
        return cls._boolean(value) if isinstance(value, bool) else str(value)

    @staticmethod
    def _number(value):
        return str(int(value)) if float(value).is_integer() else str(value)

    @classmethod
    def _priority(cls, value):
        try:
            priority = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid activity priority: {value!r}.") from exc
        if not math.isfinite(priority):
            raise ValueError(f"Invalid activity priority: {value!r}.")
        return cls._number(priority)

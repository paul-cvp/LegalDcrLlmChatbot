from pathlib import Path

import pytest

from pm4py.objects.dcr.exporter import exporter as dcr_exporter
from pm4py.objects.dcr.exporter.variants import dcr_js_portal
from pm4py.objects.dcr.importer.variants import xml_dcr_js
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
    DcrSpawnContainer,
    DcrSubgraph,
    DcrSubprocess,
    RelationType,
)
from pm4py.objects.dcr.ocdcr.semantics import DcrSemantics


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_FIXTURES = PROJECT_ROOT / "frontend" / "modeler" / "test" / "fixtures"
FRONTEND_EXAMPLES = (
    PROJECT_ROOT / "frontend" / "app" / "public" / "examples" / "diagrams"
)
LEXPLAIN_MODEL = (
    PROJECT_ROOT
    / "backend"
    / "notebook"
    / "Lexplain - Bekendtgørelse af barnets lov - merudgifter 86 stk 1.xml"
)
SOCIAL_SERVICE_MODEL = (
    PROJECT_ROOT
    / "backend"
    / "data"
    / "models"
    / "Social Service Law 86 Data EN.xml"
)


def test_imports_simple_editor_graph():
    graph = xml_dcr_js.apply(FRONTEND_FIXTURES / "simple.xml")

    assert graph.ID == "Graph"
    assert {element.ID for element in graph.elements} == {
        "Event_0gkcl6v",
        "Event_0egj3tr",
    }
    assert all(isinstance(element, DcrActivity) for element in graph.elements)
    assert graph.getElementFromID("Event_0gkcl6v").label == ""

    relation = next(iter(graph.relations))
    assert isinstance(relation, DcrConstraint)
    assert relation.relationType == RelationType.C
    assert relation.source.ID == "Event_0gkcl6v"
    assert relation.target.ID == "Event_0egj3tr"


def test_imports_nested_and_multi_instance_editor_elements():
    graph = xml_dcr_js.apply(FRONTEND_FIXTURES / "complex.xml")

    nesting = graph.getElementFromID("Nesting_1ezkbmp")
    subgraph = graph.getElementFromID("SubProcess_01lm2fg")
    assert isinstance(nesting, DcrNesting)
    assert {child.ID for child in nesting.children} == {
        "Event_1uzi91u",
        "Event_05ips30",
    }
    assert isinstance(subgraph, DcrSubgraph)
    assert all(isinstance(child, DcrSpawnContainer) for child in subgraph.children)

    spawn = next(
        relation for relation in graph.relations if isinstance(relation, DcrSpawn)
    )
    assert spawn.source.ID == "Event_041zcp8"
    assert spawn.target is subgraph
    assert any(
        isinstance(relation, DcrConstraint)
        and relation.relationType == RelationType.M
        for relation in graph.relations
    )


def test_imports_event_data_defaults_and_guards():
    graph = xml_dcr_js.apply(
        FRONTEND_EXAMPLES / "Multi-perspective Medical Prescription.xml"
    )

    diagnosis = graph.getElementFromID("Event_1thqk39")
    assert diagnosis.takesInput is True
    assert diagnosis.data is True

    guarded_response = next(
        relation
        for relation in graph.relations
        if isinstance(relation, DcrEffect)
        and relation.relationType == RelationType.R
        and relation.source is diagnosis
    )
    assert guarded_response.guard == [(diagnosis.ID, "data"), "==", True]


def test_imports_activity_marking():
    xml = (FRONTEND_FIXTURES / "simple.xml").read_text().replace(
        'included="true" executed="false" pending="false"',
        'included="false" executed="true" pending="true"',
        1,
    )

    graph = xml_dcr_js.import_from_string(xml)
    activity = graph.getElementFromID("Event_0gkcl6v")
    assert activity.included is False
    assert activity.pending is True
    assert activity.executed is not None


def test_round_trips_editor_xml_in_memory():
    graph = xml_dcr_js.import_from_string(SOCIAL_SERVICE_MODEL.read_bytes())

    exported = dcr_exporter.serialize(
        graph, variant=dcr_exporter.DCR_JS_PORTAL
    )
    imported = xml_dcr_js.import_from_string(exported)

    assert _graph_snapshot(imported) == _graph_snapshot(graph)


def test_guard_evaluation_does_not_corrupt_exported_expression():
    graph = xml_dcr_js.import_from_string(SOCIAL_SERVICE_MODEL.read_bytes())
    guarded = next(relation for relation in graph.relations if relation.guard)
    original_guard = list(guarded.guard)

    for element in graph.elements:
        DcrSemantics.isEnabled(element, graph)

    assert guarded.guard == original_guard
    exported = dcr_exporter.serialize(
        graph, variant=dcr_exporter.DCR_JS_PORTAL
    )
    imported = xml_dcr_js.import_from_string(exported)
    imported_guarded = next(
        relation for relation in imported.relations if relation.ID == guarded.ID
    )
    assert imported_guarded.guard == original_guard


def test_imports_lexplain_subprocesses_marking_and_relations():
    graph = xml_dcr_js.apply(LEXPLAIN_MODEL)

    request = graph.getElementFromID("SubProcess_0paoug4")
    expense = graph.getElementFromID("SubProcess_0y18arb")
    amount = graph.getElementFromID("Event_19by3yr")
    assert len(graph.elements) == 18
    assert len(graph.relations) == 8
    assert isinstance(request, DcrSubprocess)
    assert isinstance(expense, DcrSubprocess)
    assert expense in request.children
    assert amount in expense.children
    assert amount.included is False
    assert amount.pending is True
    assert amount.takesInput is True


def test_rejects_relations_with_unknown_element_references():
    xml = (FRONTEND_FIXTURES / "simple.xml").read_text().replace(
        'targetRef="Event_0egj3tr"', 'targetRef="missing"'
    )

    with pytest.raises(ValueError, match="unknown DCR element"):
        xml_dcr_js.import_from_string(xml)


def test_round_trips_social_service_model_with_metadata_and_layout(tmp_path):
    graph = xml_dcr_js.apply(SOCIAL_SERVICE_MODEL)

    assert len(graph.elements) == 18
    assert len(graph.relations) == 14
    age = graph.getElementFromID("Event_07k41iu")
    assert age.label == "Age"
    assert age.role == "Citizen"
    assert age.description.startswith("What is the age")
    assert age.eventData == DcrEventData("age", "Int", None)
    assert age.bounds == DcrBounds(340, 215, 130, 150)
    guarded = next(relation for relation in graph.relations if relation.guard)
    assert guarded.guard == [("Event_1kk6rx3", "data"), "==", True]
    assert guarded.waypoints

    exported = tmp_path / "round-trip.xml"
    dcr_js_portal.export_dcr_xml(graph, exported)
    imported = xml_dcr_js.apply(exported)

    assert _graph_snapshot(imported) == _graph_snapshot(graph)


def test_round_trips_every_object_centric_relation_type(tmp_path):
    source = DcrActivity(
        "source",
        label="Source",
        eventData=DcrEventData("source_value", "Int", 1),
    )
    target = DcrActivity(
        "target",
        label="Target",
        eventData=DcrEventData("target_value", "String", "initial"),
    )
    template = DcrActivity(
        "template",
        eventData=DcrEventData("template_value", "Bool", False),
    )
    subgraph = DcrSubgraph("repeatable", {template})
    source.bounds = DcrBounds(10, 20, 130, 150)
    target.bounds = DcrBounds(300, 20, 130, 150)
    subgraph.bounds = DcrBounds(500, 10, 190, 210)
    template.bounds = DcrBounds(530, 40, 130, 150)
    relations = {
        DcrConstraint(RelationType.C, source, target),
        DcrConstraint(RelationType.M, source, target),
        DcrEffect(RelationType.R, source, target),
        DcrEffect(RelationType.I, source, target),
        DcrEffect(RelationType.E, source, target),
        DcrEffect(RelationType.N, source, target),
        DcrSetValue(source, target, [("source", "data"), "+", 1]),
        DcrSpawn(source, subgraph),
    }
    for index, relation in enumerate(sorted(relations, key=repr)):
        relation.ID = f"relation-{index}"
        relation.waypoints = [DcrPoint(140, 95), DcrPoint(300, 95)]
    graph = DcrGraph("all-relations", elements={source, target, template, subgraph}, relations=relations)

    exported = tmp_path / "all-relations.xml"
    dcr_js_portal.export_dcr_xml(graph, exported)
    imported = xml_dcr_js.apply(exported)

    assert {relation.relationType for relation in imported.relations} == set(RelationType)
    set_value = next(
        relation for relation in imported.relations if isinstance(relation, DcrSetValue)
    )
    assert set_value.value == [("source", "data"), "+", 1]


def _graph_snapshot(graph):
    elements = []
    for element in graph.elements:
        if isinstance(element, DcrSpawnContainer):
            continue
        children = (
            sorted(
                child.ID
                for child in element.children
                for child in (
                    child.children if isinstance(child, DcrSpawnContainer) else {child}
                )
            )
            if isinstance(element, (DcrNesting, DcrSubgraph, DcrSubprocess))
            else []
        )
        elements.append(
            (
                element.ID,
                type(element).__name__,
                getattr(element, "label", None),
                getattr(element, "description", None),
                getattr(element, "role", None),
                getattr(element, "included", None),
                getattr(element, "pending", None),
                getattr(element, "executed", None) is not None,
                getattr(element, "eventData", None),
                element.bounds,
                children,
            )
        )
    relations = sorted(
        (
            relation.ID,
            relation.relationType,
            relation.source.ID,
            relation.target.ID,
            relation.guard,
            getattr(relation, "value", None),
            relation.forAll,
            relation.waypoints,
        )
        for relation in graph.relations
    )
    return sorted(elements), relations

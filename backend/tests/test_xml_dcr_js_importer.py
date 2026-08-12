from pathlib import Path

import pytest
from lxml import etree

from pm4py.objects.dcr.exporter import exporter as dcr_exporter
from pm4py.objects.dcr.exporter.variants import dcr_js_portal
from pm4py.objects.dcr.importer.variants import xml_dcr_js
from pm4py.objects.dcr.ocdcr.obj import (
    DcrActivity,
    DcrBounds,
    DcrConstraint,
    DcrEffect,
    DcrEventData,
    DcrExecution,
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
from tools.find_relevant_laws import FindRelevantLaws
from tools.find_similar_cases import FindSimilarCases
from tools.summarize_case import SummarizeCaseHistory
from tools.tool_call import ToolCall


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

    assert graph.title == "Social Service Law 86"
    assert graph.description.startswith("The law related to this graph states:")
    assert len(graph.elements) == 18
    assert len(graph.relations) == 15
    age = graph.getElementFromID("Event_07k41iu")
    assert age.label == "Age"
    assert age.role == "Citizen"
    assert age.description.startswith("What is the age")
    assert age.eventData == DcrEventData("age", int, None)
    assert age.eventData.value_type is int
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
        eventData=DcrEventData("source_value", int, 1),
    )
    target = DcrActivity(
        "target",
        label="Target",
        eventData=DcrEventData("target_value", str, "initial"),
    )
    template = DcrActivity(
        "template",
        eventData=DcrEventData("template_value", bool, False),
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
    assert imported.getActivity("Event_source").eventData.data_type is int
    assert imported.getActivity("Event_target").eventData.data_type is str
    assert imported.getActivity("Event_template").eventData.data_type is bool
    set_value = next(
        relation for relation in imported.relations if isinstance(relation, DcrSetValue)
    )
    assert set_value.value == [("source", "data"), "+", 1]


def test_export_adds_frontend_id_prefixes_without_mutating_graph():
    event = DcrActivity("plain")
    prefixed_event = DcrActivity("Event_ready")
    nesting = DcrNesting("group", {prefixed_event})
    subprocess = DcrSubprocess("flow", {event})
    relation = DcrEffect(RelationType.R, event, nesting)
    relation.ID = "link"
    preserved_relation = DcrEffect(RelationType.I, prefixed_event, subprocess)
    preserved_relation.ID = "Relation_ready"
    graph = DcrGraph(
        "graph",
        elements={event, prefixed_event, nesting, subprocess},
        relations={relation, preserved_relation},
    )

    exported = dcr_js_portal.export_as_string(graph)
    root = etree.fromstring(exported)
    namespace = {
        "dcr": "http://tk/schema/dcr",
        "dcrDi": "http://tk/schema/dcrDi",
    }
    graph_xml = root.find("dcr:dcrGraph", namespace)
    ids = {element.get("id") for element in graph_xml.iter() if element.get("id")}
    relation_xml = graph_xml.find("dcr:relation[@id='Relation_link']", namespace)
    diagram_refs = {
        element.get("boardElement")
        for element in root.findall(".//dcrDi:dcrShape", namespace)
    }

    assert {
        "Event_plain",
        "Event_ready",
        "Nesting_group",
        "SubProcess_flow",
    } <= ids
    assert {"Relation_link", "Relation_ready"} <= ids
    assert relation_xml.get("sourceRef") == "Event_plain"
    assert relation_xml.get("targetRef") == "Nesting_group"
    assert {
        "Event_plain",
        "Event_ready",
        "Nesting_group",
        "SubProcess_flow",
    } == diagram_refs
    assert event.ID == "plain"
    assert nesting.ID == "group"
    assert subprocess.ID == "flow"
    assert relation.ID == "link"


@pytest.mark.parametrize(
    ("xml_type", "python_type", "default", "expected_xml"),
    [
        ("Bool", bool, "false", 'type="Bool" default="false"'),
        ("Int", int, "42", 'type="Int" default="42"'),
        ("String", str, "hello", 'type="String" default="hello"'),
    ],
)
def test_event_data_types_convert_between_xml_and_python(
    xml_type, python_type, default, expected_xml
):
    xml = f'''<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="typed">
        <dcr:event id="value" included="true" executed="false" pending="false">
          <dcr:eventData name="value" type="{xml_type}" default="{default}" />
        </dcr:event>
      </dcr:dcrGraph>
    </dcr:definitions>'''

    graph = xml_dcr_js.import_from_string(xml)
    event_data = graph.getActivity("value").eventData
    exported = dcr_exporter.serialize(
        graph, variant=dcr_exporter.DCR_JS_PORTAL
    ).decode()

    assert event_data.data_type is python_type
    assert type(event_data.default) is python_type
    assert expected_xml in exported


@pytest.mark.parametrize(
    ("priority_xml", "expected", "expected_xml"),
    [
        ("", None, None),
        (' priority="2"', 2.0, 'priority="2"'),
        (' priority="2.5"', 2.5, 'priority="2.5"'),
        (' priority="-1"', -1.0, 'priority="-1"'),
    ],
)
def test_activity_priority_round_trips(priority_xml, expected, expected_xml):
    xml = f'''<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="priority">
        <dcr:event id="event"{priority_xml} included="true" executed="false" pending="false" />
      </dcr:dcrGraph>
    </dcr:definitions>'''

    graph = xml_dcr_js.import_from_string(xml)
    exported = dcr_js_portal.export_as_string(graph).decode()

    assert graph.getActivity("event").priority == expected
    if expected_xml is None:
        assert "priority=" not in exported
    else:
        assert expected_xml in exported


@pytest.mark.parametrize("priority", ["invalid", "NaN", "Infinity", "-Infinity"])
def test_rejects_invalid_activity_priority(priority):
    xml = f'''<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="priority">
        <dcr:event id="event" priority="{priority}" included="true" executed="false" pending="false" />
      </dcr:dcrGraph>
    </dcr:definitions>'''

    with pytest.raises(ValueError, match="Invalid activity priority"):
        xml_dcr_js.import_from_string(xml)


@pytest.mark.parametrize("priority", ["invalid", float("nan"), float("inf")])
def test_rejects_invalid_activity_priority_on_export(priority):
    graph = DcrGraph("priority", elements={DcrActivity("event", priority=priority)})

    with pytest.raises(ValueError, match="Invalid activity priority"):
        dcr_js_portal.export_as_string(graph)


@pytest.mark.parametrize("entity", ["&gt;", "&#62;"])
def test_set_value_entities_import_equally_and_export_canonically(entity):
    xml = f'''<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="set-value">
        <dcr:event id="source" included="true" executed="false" pending="false">
          <dcr:eventData name="age" type="Int" />
        </dcr:event>
        <dcr:event id="target" included="true" executed="false" pending="false">
          <dcr:eventData name="threshold" type="Bool" />
        </dcr:event>
        <dcr:relation id="set" type="setValue" sourceRef="source" targetRef="target" value="age {entity}= 18" />
      </dcr:dcrGraph>
    </dcr:definitions>'''

    graph = xml_dcr_js.import_from_string(xml)
    relation = next(iter(graph.relations))
    exported = dcr_js_portal.export_as_string(graph).decode()

    assert relation.value == [("source", "data"), ">=", 18]
    assert 'value="age &gt;= 18"' in exported
    assert "&#62;" not in exported


def test_semantics_coerces_execution_input_to_declared_python_type():
    activity = DcrActivity("number", eventData=DcrEventData("number", int))
    graph = DcrGraph("typed", elements={activity})

    DcrSemantics.executeActivity(DcrExecution("number", input="42"), graph)

    assert activity.data == 42
    assert type(activity.data) is int


def test_set_value_semantics_preserves_target_python_type():
    source = DcrActivity("source", eventData=DcrEventData("source", int, 1))
    target = DcrActivity("target", eventData=DcrEventData("target", int))
    relation = DcrSetValue(source, target, [("source", "data"), "+", 1])
    graph = DcrGraph(
        "typed", elements={source, target}, relations={relation}
    )

    DcrSemantics.executeActivity(DcrExecution("source", input="41"), graph)

    assert source.data == 41
    assert target.data == 42
    assert type(target.data) is int


@pytest.mark.parametrize(
    "computation",
    [
        [("source", "tool", "summary")],
        [("source", "tool", "graph", "executions")],
    ],
)
def test_summary_tool_computation_receives_graph_and_history(computation):
    received = {}

    async def summarize(graph, user_info=None, user_data=None):
        received.update(
            graph=graph,
            user_info=user_info,
            user_data=user_data,
        )
        return "Case summary"

    activity = DcrActivity(
        "summary",
        label="Summarize case",
        computation=computation,
    )
    activity.tool_call = summarize
    graph = DcrGraph("case", elements={activity})
    DcrSemantics(user_context="Citizen context", use_citizen_data=True)

    DcrSemantics.executeActivity(DcrExecution("summary"), graph)

    assert activity.data == "Case summary"
    assert received["graph"] is graph
    assert received["user_info"] == "Citizen context"
    assert received["user_data"][0]["id"] == "summary"


def test_registered_summary_tool_with_standard_token_receives_graph(monkeypatch):
    received = {}

    async def summarize(tool, graph, **kwargs):
        received.update(tool=tool, graph=graph, **kwargs)
        return "Case summary"

    monkeypatch.setattr(ToolCall, "__call__", summarize)
    activity = DcrActivity(
        "summary",
        label="Summarize case",
        computation=[("source", "tool")],
    )
    activity.tool_call = ToolCall.SUMMARIZE_CASE_HISTORY
    graph = DcrGraph("case", elements={activity})
    DcrSemantics(user_context=None, use_citizen_data=False)

    DcrSemantics.executeActivity(DcrExecution("summary"), graph)

    assert activity.data == "Case summary"
    assert received["tool"] is ToolCall.SUMMARIZE_CASE_HISTORY
    assert received["graph"] is graph
    assert received["user_data"][0]["id"] == "summary"


def test_round_trips_activity_definitions_and_tagged_computations():
    activity = DcrActivity(
        "automated",
        computation=[
            ("source", "tool"),
            ("source", "tool", "graph", "executions"),
            "and",
            True,
            3,
            2.5,
        ],
        takesInput=True,
    )
    subprocess = DcrSubprocess(
        "process", {activity}, computation=[("automated", "data"), "+", 1]
    )
    subprocess.priority = -2.5
    graph = DcrGraph("definitions", elements={activity, subprocess})

    xml = dcr_js_portal.export_as_string(graph)
    imported = xml_dcr_js.import_from_string(xml)
    imported_activity = imported.getActivity("Event_automated")
    imported_subprocess = imported.getElementFromID("SubProcess_process")

    assert imported_activity.computation == activity.computation
    assert imported_activity.takesInput is True
    assert imported_activity.eventData is None
    assert imported_subprocess.computation == [("Event_automated", "data"), "+", 1]
    assert imported_subprocess.priority == -2.5


@pytest.mark.parametrize(
    ("owner_class", "method_name", "expected"),
    [
        (FindRelevantLaws, "answer", ToolCall.FIND_RELEVANT_LAWS),
        (FindSimilarCases, "answer", ToolCall.FIND_SIMILAR_CASES),
        (
            SummarizeCaseHistory,
            "get_summary",
            ToolCall.SUMMARIZE_CASE_HISTORY,
        ),
    ],
)
def test_round_trips_registered_tool_calls_without_invoking_them(
    owner_class, method_name, expected
):
    activity = DcrActivity("tool")
    # Bypass heavyweight constructors; export only inspects method identity.
    activity.tool_call = getattr(owner_class.__new__(owner_class), method_name)
    graph = DcrGraph("tools", elements={activity})

    xml = dcr_js_portal.export_as_string(graph)
    imported = xml_dcr_js.import_from_string(xml)

    assert f'toolCall="{expected.value}"'.encode() in xml
    assert imported.getActivity("Event_tool").tool_call is expected


def test_rejects_unknown_and_unregistered_tool_calls():
    unknown = '''<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
      <dcr:dcrGraph id="tools">
        <dcr:event id="tool" toolCall="unknown" />
      </dcr:dcrGraph>
    </dcr:definitions>'''
    with pytest.raises(ValueError, match="Unknown DCR tool call"):
        xml_dcr_js.import_from_string(unknown)

    activity = DcrActivity("tool")
    activity.tool_call = lambda value: value
    with pytest.raises(ValueError, match="Unregistered tool call"):
        dcr_js_portal.export_as_string(DcrGraph("tools", elements={activity}))


def test_round_trips_lossless_relation_computations():
    source = DcrActivity("source", eventData=DcrEventData("source", int))
    target = DcrActivity("target", eventData=DcrEventData("target", int))
    guard = [("source", "enabled"), "and", True]
    value = [("source", "tool", "graph", "executions"), "+", 1.5]
    relation = DcrSetValue(source, target, value, guard=guard)
    graph = DcrGraph(
        "computations", elements={source, target}, relations={relation}
    )

    xml = dcr_js_portal.export_as_string(graph)
    imported = xml_dcr_js.import_from_string(xml)
    imported_relation = next(iter(imported.relations))

    assert imported_relation.guard == guard
    assert imported_relation.value == value
    assert b"guardComputation=" in xml
    assert b"valueComputation=" in xml


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
                getattr(element, "priority", None),
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
            _frontend_relation_id(relation.ID),
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
    return graph.ID, graph.title, graph.description, sorted(elements), relations


def _frontend_relation_id(relation_id):
    if relation_id is None or relation_id.startswith("Relation_"):
        return relation_id
    return f"Relation_{relation_id}"

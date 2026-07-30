import pytest

from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrExecution, DcrGraph
from pm4py.objects.dcr.ocdcr.semantics import DcrSemantics


def test_role_filters_enabled_activities():
    citizen_activity = DcrActivity("citizen", role="Citizen")
    shared_activity = DcrActivity("shared", role="Citizen, Case worker")
    public_activity = DcrActivity("public")
    graph = DcrGraph(
        "roles", elements={citizen_activity, shared_activity, public_activity}
    )

    assert DcrSemantics.getEnabledActivities(graph, "Citizen") == {
        citizen_activity,
        shared_activity,
        public_activity,
    }
    assert DcrSemantics.getEnabledActivities(graph, "Case worker") == {
        shared_activity,
        public_activity,
    }


def test_explicit_wrong_role_cannot_execute_activity():
    activity = DcrActivity("review", role="Case worker")
    graph = DcrGraph("roles", elements={activity})

    with pytest.raises(PermissionError, match="not authorized"):
        DcrSemantics.executeActivity(
            DcrExecution("review", role="Citizen"), graph
        )

    assert activity.executed is None


def test_matching_and_system_roles_can_execute_activity():
    role_activity = DcrActivity("review", role="Case worker")
    system_activity = DcrActivity("automatic", role="Robot")
    graph = DcrGraph("roles", elements={role_activity, system_activity})

    DcrSemantics.executeActivity(
        DcrExecution("review", role="Case worker"), graph
    )
    # Omitting the role preserves trusted internal execution.
    DcrSemantics.executeActivity(DcrExecution("automatic"), graph)

    assert role_activity.executed is not None
    assert system_activity.executed is not None

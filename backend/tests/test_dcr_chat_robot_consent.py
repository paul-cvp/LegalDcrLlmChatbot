import asyncio

import pytest
from fastapi import HTTPException

from api import chat_api
from approaches.dcr_chat import (
    ActivityRepeatPolicy,
    ROBOT_AUTO_EXECUTIONS_ENV,
    DcrChat,
    RobotExecutionPolicy,
)
from object.domain import DcrChatRequest
from object.errors import ValidationError
from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrEventData, DcrExecution, DcrGraph


class FakeInputInterpreter:
    def __init__(self, decision=True):
        self.decision = decision
        self.calls = []

    async def get_closest_match(self, text, data_type):
        self.calls.append((text, data_type))
        return self.decision


class FakeOutputInterpreter:
    def __init__(self):
        self.permission_calls = []

    async def get_robot_permission_question(self, activity, history):
        self.permission_calls.append((activity, list(history)))
        return f"May the Robot execute {activity.label}?"

    async def get_question(self, activity, graph):
        return activity.description or activity.label


def robot(activity_id="robot", data="value", *, pending=False):
    activity = DcrActivity(
        activity_id,
        label=f"Robot {activity_id}",
        description=f"Process {activity_id}",
        role="Robot",
        pending=pending,
    )
    activity.data = data
    return activity


def chat(*activities, limit=1, decision=True):
    return DcrChat(
        DcrGraph("graph", elements=set(activities)),
        input_interpreter=FakeInputInterpreter(decision),
        output_interpreter=FakeOutputInterpreter(),
        robot_auto_limit=limit,
    )


@pytest.mark.parametrize(("limit", "executions", "allowed"), [
    (0, 0, True),
    (0, 1, False),
    (2, 2, True),
    (2, 3, False),
    (-1, 10, True),
])
def test_activity_repeat_policy_counts_repetitions(limit, executions, allowed):
    activity = DcrActivity("answer", role="Citizen")
    trace = [DcrExecution(activity.ID) for _ in range(executions)]

    assert ActivityRepeatPolicy(limit).allows(activity, trace) is allowed


def test_activity_repeat_policy_rejects_values_below_minus_one():
    with pytest.raises(ValidationError, match="must be -1 or greater"):
        ActivityRepeatPolicy(-2)


def test_capped_active_role_notifies_user_that_other_roles_continue():
    activity = DcrActivity("answer", role="Citizen")
    other = DcrActivity("review", role="Case worker", pending=True)
    instance = chat(activity, other)
    instance.trace.append(DcrExecution(activity.ID))

    response = asyncio.run(instance.run(DcrChatRequest(
        text="try again",
        chat_type=1,
        act_id=activity.ID,
        dcr_role="Citizen",
        activity_repeat_limit=0,
    )))

    assert response.text == (
        "You have completed all currently enabled activities allowed by the repetition setting. "
        "Other roles will continue working on the case."
    )
    assert len(instance.trace) == 1


def test_capped_active_role_reports_an_accepting_process_as_complete():
    activity = DcrActivity("answer", role="Citizen")
    instance = chat(activity)
    instance.trace.append(DcrExecution(activity.ID))

    response = asyncio.run(instance.run(DcrChatRequest(
        text="",
        chat_type=1,
        dcr_role="Citizen",
        activity_repeat_limit=0,
    )))

    assert response.text == "The process is complete!"


@pytest.mark.parametrize("value", [-1, 0, 1, 3])
def test_robot_policy_accepts_supported_limits(value):
    assert RobotExecutionPolicy(value).automatic_limit == value


def test_robot_policy_rejects_values_below_minus_one():
    with pytest.raises(ValidationError, match="must be -1 or greater"):
        RobotExecutionPolicy(-2)


@pytest.mark.parametrize(
    ("configured", "expected"),
    [(None, 1), ("-1", -1), ("0", 0), ("2", 2)],
)
def test_robot_policy_reads_environment(monkeypatch, configured, expected):
    monkeypatch.setattr("approaches.dcr_chat.load_dotenv", lambda *args: None)
    if configured is None:
        monkeypatch.delenv(ROBOT_AUTO_EXECUTIONS_ENV, raising=False)
    else:
        monkeypatch.setenv(ROBOT_AUTO_EXECUTIONS_ENV, configured)

    assert RobotExecutionPolicy.from_environment().automatic_limit == expected


@pytest.mark.parametrize("configured", ["often", "-2"])
def test_robot_policy_rejects_invalid_environment(monkeypatch, configured):
    monkeypatch.setattr("approaches.dcr_chat.load_dotenv", lambda *args: None)
    monkeypatch.setenv(ROBOT_AUTO_EXECUTIONS_ENV, configured)

    with pytest.raises(ValidationError, match=ROBOT_AUTO_EXECUTIONS_ENV):
        RobotExecutionPolicy.from_environment()


def test_automatic_counts_are_independent_per_activity_and_session():
    first, second = robot("first"), robot("second")
    one = chat(first, second, limit=1)
    two = chat(robot("first"), limit=1)

    one._robot_policy.record_automatic_execution(first)

    assert not one._robot_policy.can_execute_automatically(first)
    assert one._robot_policy.can_execute_automatically(second)
    assert two._robot_policy.can_execute_automatically(two.get_dcr_activity("first"))


def test_zero_asks_immediately_and_passes_details_to_question_generator():
    activity = robot(data="computed result")
    instance = chat(activity, limit=0)
    instance.record_response("Svar på dansk", "user", "Citizen")

    response = asyncio.run(instance.present_question_to_user("Citizen"))

    assert response.act_id == activity.ID
    assert response.dcr_role == "Citizen"
    assert response.text == "May the Robot execute Robot robot?"
    called_activity, history = instance._o_llm_tool.permission_calls[0]
    assert called_activity is activity
    assert history[0].item == "Svar på dansk"
    assert not instance.trace


def test_default_executes_once_then_requests_permission_for_changed_data():
    activity = robot(data="first")
    instance = chat(activity)

    assert asyncio.run(instance.present_question_to_user("Citizen")) is None
    assert len(instance.trace) == 1
    activity.data = "second"
    response = asyncio.run(instance.present_question_to_user("Citizen"))

    assert response.act_id == activity.ID
    assert len(instance.trace) == 1


@pytest.mark.parametrize("role", ["Citizen", "Caseworker"])
def test_automatic_execution_reports_metadata_and_graph_update_for_any_role(role):
    activity = robot()
    instance = chat(activity)

    response = asyncio.run(
        instance.run(
            DcrChatRequest(
                text="",
                chat_type=1,
                dcr_role=role,
            )
        )
    )

    robot_entry = instance.history[0]
    assert robot_entry.metadata == {
        "robot_execution": True,
        "automatic": True,
        "activity_id": activity.ID,
        "activity_label": activity.label,
    }
    assert response.text == "The process is complete!"
    assert 'executed="true"' in response.graph_xml


def test_all_enabled_robot_activities_report_their_automatic_execution():
    instance = chat(robot("first"), robot("second"))

    response = asyncio.run(
        instance.run(
            DcrChatRequest(text="", chat_type=1, dcr_role="Citizen")
        )
    )

    robot_entries = [entry for entry in instance.history if entry.dcr_role == "Robot"]
    assert len(instance.trace) == 2
    assert len(robot_entries) == 2
    assert all(entry.metadata["automatic"] for entry in robot_entries)
    assert response.text == "The process is complete!"


def test_runtime_limit_update_preserves_automatic_execution_count():
    activity = robot(data="first")
    instance = chat(activity, limit=1)
    asyncio.run(instance.present_question_to_user("Citizen"))

    activity.data = "second"
    asyncio.run(
        instance.run(
            DcrChatRequest(
                text="",
                session_id="00000000-0000-0000-0000-000000000001",
                dcr_role="Citizen",
                robot_auto_limit=2,
            )
        )
    )
    activity.data = "third"
    response = asyncio.run(
        instance.run(
            DcrChatRequest(
                text="",
                session_id="00000000-0000-0000-0000-000000000001",
                dcr_role="Citizen",
                robot_auto_limit=2,
            )
        )
    )

    assert instance._robot_policy.automatic_counts[activity.ID] == 2
    assert len(instance.trace) == 2
    assert response.act_id == activity.ID


def test_unlimited_policy_keeps_automatic_execution_for_new_occurrences():
    activity = robot(data="first")
    instance = chat(activity, limit=-1)

    asyncio.run(instance.present_question_to_user("Citizen"))
    activity.data = "second"
    asyncio.run(instance.present_question_to_user("Citizen"))

    assert len(instance.trace) == 2
    assert instance._robot_policy.automatic_counts[activity.ID] == 2


def test_natural_language_approval_executes_without_consuming_allowance():
    activity = robot()
    instance = chat(activity, limit=0, decision=True)
    asyncio.run(instance.present_question_to_user("Citizen"))

    asyncio.run(
        instance.run(
            DcrChatRequest(
                text="Yes, please",
                session_id="00000000-0000-0000-0000-000000000001",
                act_id=activity.ID,
                dcr_role="Citizen",
            )
        )
    )

    assert instance._i_llm_tool.calls == [("Yes, please", bool)]
    assert len(instance.trace) == 1
    assert instance._robot_policy.automatic_counts[activity.ID] == 0
    assert any("permission True" in entry.item for entry in instance.history)
    robot_entry = next(entry for entry in instance.history if entry.dcr_role == "Robot")
    assert robot_entry.metadata == {
        "robot_execution": True,
        "automatic": False,
        "activity_id": activity.ID,
        "activity_label": activity.label,
    }


def test_denial_suppresses_occurrence_and_allows_enabled_user_activity():
    activity = robot(pending=True)
    user_activity = DcrActivity(
        "answer",
        description="Please answer",
        role="Citizen",
        eventData=DcrEventData("answer", str),
    )
    instance = chat(activity, user_activity, limit=0, decision=False)
    asyncio.run(instance.present_question_to_user("Citizen"))

    response = asyncio.run(
        instance.run(
            DcrChatRequest(
                text="No, wait",
                session_id="00000000-0000-0000-0000-000000000001",
                act_id=activity.ID,
                dcr_role="Citizen",
            )
        )
    )

    assert response.act_id == user_activity.ID
    assert not instance.trace
    assert instance._robot_policy.is_current_occurrence_denied(activity)


def test_denied_occurrence_can_be_requested_after_data_changes():
    activity = robot(data="old")
    instance = chat(activity, limit=0, decision=False)
    asyncio.run(instance.present_question_to_user("Citizen"))
    asyncio.run(
        instance.handle_robot_permission(
            DcrChatRequest(
                text=False,
                session_id="00000000-0000-0000-0000-000000000001",
                act_id=activity.ID,
                dcr_role="Citizen",
            )
        )
    )

    assert asyncio.run(instance.present_question_to_user("Citizen")) is None
    assert "waiting" in instance.history[-1].item
    activity.data = "new"
    response = asyncio.run(instance.present_question_to_user("Citizen"))

    assert response.act_id == activity.ID


def test_pending_permission_rejects_other_activity_input():
    activity = robot()
    instance = chat(activity, limit=0)
    asyncio.run(instance.present_question_to_user("Citizen"))

    with pytest.raises(ValidationError, match="pending Robot permission"):
        asyncio.run(
            instance.run(
                DcrChatRequest(
                    text="answer",
                    session_id="00000000-0000-0000-0000-000000000001",
                    act_id="different",
                    dcr_role="Citizen",
                )
            )
        )


def test_input_free_user_activity_executes_without_interpretation():
    activity = DcrActivity(
        "A1",
        label="Review application",
        role="Citizen",
    )
    instance = chat(activity)

    asyncio.run(
        instance.execute_activity_with_chat(
            DcrChatRequest(
                text="Continue",
                session_id="00000000-0000-0000-0000-000000000001",
                act_id=activity.ID,
                dcr_role="Citizen",
            )
        )
    )

    assert instance._i_llm_tool.calls == []
    assert instance.trace[-1].activityID == activity.ID
    assert instance.trace[-1].input is None
    assert instance.history[-1].item == "Continue"


def test_denied_activity_can_be_requested_after_disable_and_reenable():
    activity = robot()
    policy = RobotExecutionPolicy(0)
    policy.observe_enabled([activity])
    policy.deny_current_occurrence(activity)

    policy.observe_enabled([])
    policy.observe_enabled([activity])

    assert not policy.is_current_occurrence_denied(activity)


def test_chat_api_maps_configuration_validation_to_422(monkeypatch):
    async def reject_request(request):
        raise ValidationError("Invalid Robot execution configuration.")

    monkeypatch.setattr(chat_api.controller, "create_response", reject_request)
    request = DcrChatRequest(
        text="start",
        session_id="00000000-0000-0000-0000-000000000001",
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(chat_api.get_response(request))

    assert error.value.status_code == 422
    assert error.value.detail == "Invalid Robot execution configuration."

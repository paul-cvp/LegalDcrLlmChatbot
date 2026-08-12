"""DCR chat approach."""

import logging
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from approaches.chat_interface import ChatWithHistory, Chat
from object.domain import ChatSessionResponse, DcrChatRequest, DcrChatResponse
from object.errors import ValidationError
from pm4py.objects.dcr.exporter import exporter as dcr_exporter
from pm4py.objects.dcr.ocdcr.obj import DcrGraph, DcrExecution, DcrActivity
from pm4py.objects.dcr.ocdcr.semantics import DcrSemantics
from tools.interpret_input import InterpretInput
from tools.interpret_output import InterpretOutput

from util.util import prioritize_user_activities


LOGGER = logging.getLogger("uvicorn.error")
ROBOT_AUTO_EXECUTIONS_ENV = "DCR_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY"


@dataclass(frozen=True)
class RobotOccurrence:
    activity_id: str
    enabled_generation: int
    data: str


class RobotExecutionPolicy:
    """Track automatic allowances and consent independently per Robot activity."""

    def __init__(self, automatic_limit: int) -> None:
        self.automatic_limit = 0
        self.set_automatic_limit(automatic_limit)
        self.automatic_counts: Counter[str] = Counter()
        self.pending: RobotOccurrence | None = None
        self._denied: dict[str, RobotOccurrence] = {}
        self._enabled_ids: set[str] = set()
        self._enabled_generations: Counter[str] = Counter()

    def set_automatic_limit(self, automatic_limit: int) -> None:
        if automatic_limit < -1:
            raise ValidationError(f"{ROBOT_AUTO_EXECUTIONS_ENV} must be -1 or greater.")
        self.automatic_limit = automatic_limit

    @classmethod
    def from_environment(cls) -> "RobotExecutionPolicy":
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        raw_value = os.getenv(ROBOT_AUTO_EXECUTIONS_ENV, "1").strip()
        try:
            value = int(raw_value)
        except ValueError as error:
            raise ValidationError(
                f"{ROBOT_AUTO_EXECUTIONS_ENV} must be an integer, got {raw_value!r}."
            ) from error
        return cls(value)

    def observe_enabled(self, activities: list[DcrActivity]) -> None:
        enabled_ids = {activity.ID for activity in activities}
        for activity_id in enabled_ids - self._enabled_ids:
            self._enabled_generations[activity_id] += 1
        for activity_id in self._enabled_ids - enabled_ids:
            self._denied.pop(activity_id, None)
            if self.pending is not None and self.pending.activity_id == activity_id:
                self.pending = None
        self._enabled_ids = enabled_ids

    def occurrence(self, activity: DcrActivity) -> RobotOccurrence:
        return RobotOccurrence(
            activity.ID,
            self._enabled_generations[activity.ID],
            repr(activity.data),
        )

    def can_execute_automatically(self, activity: DcrActivity) -> bool:
        return (
            self.automatic_limit == -1
            or self.automatic_counts[activity.ID] < self.automatic_limit
        )

    def record_automatic_execution(self, activity: DcrActivity) -> None:
        self.automatic_counts[activity.ID] += 1

    def request_permission(self, activity: DcrActivity) -> None:
        self.pending = self.occurrence(activity)

    def clear_permission(self) -> None:
        self.pending = None

    def deny_current_occurrence(self, activity: DcrActivity) -> None:
        occurrence = self.occurrence(activity)
        self._denied[activity.ID] = occurrence
        self.pending = None

    def is_current_occurrence_denied(self, activity: DcrActivity) -> bool:
        denied = self._denied.get(activity.ID)
        current = self.occurrence(activity)
        if denied is not None and denied != current:
            self._denied.pop(activity.ID, None)
            return False
        return denied == current

class DcrChat(ChatWithHistory):

    def __init__(
        self,
        dcr_graph: DcrGraph,
        input_interpreter: InterpretInput | None = None,
        output_interpreter: InterpretOutput | None = None,
        robot_auto_limit: int | None = None,
        user_context: str | None = None,
        use_citizen_data: bool = False,
    ) -> None:
        super().__init__()
        self._dcr_graph = dcr_graph
        self._dcr_semantics = DcrSemantics(user_context=user_context,use_citizen_data=use_citizen_data)
        self._enabled_events = set()
        self._enabled_pending = set()
        self._trace = []
        # Validate configuration before creating potentially expensive LLM clients.
        self._robot_policy = (
            RobotExecutionPolicy(robot_auto_limit)
            if robot_auto_limit is not None
            else RobotExecutionPolicy.from_environment()
        )
        self._i_llm_tool = input_interpreter or InterpretInput()
        self._o_llm_tool = output_interpreter or InterpretOutput()
    
    @property
    def trace(self) -> list[DcrExecution]:
        return self._trace
    
    def get_trace(self) -> list[DcrExecution]:
        return []

    def clear_trace(self) -> None:
        self._trace.clear()

    def get_dcr_activity(self, act_id):
        for e in self._dcr_graph.elements:
            if e.ID == act_id:
                return e
        return None

    async def execute_activity_with_chat(self, request: DcrChatRequest):
        dcr_role = request.dcr_role
        input = request.text
        act_id = request.act_id
        act = self.get_dcr_activity(act_id)
        if act is None:
            raise ValidationError(f"DCR activity {act_id!r} was not found.")
        if act.role == "Robot":
            raise ValidationError("Robot activities can only execute through the Robot permission flow.")
        if act.eventData is None:
            # Input-free activities execute from the user's acknowledgement.
            input_interpreted = None
            self.record_response(item=f"{input}", chat_role="user")
        elif type(input) == act.eventData.data_type:
            input_interpreted = input
            self.record_response(item=f"{input}", chat_role="user")
        else:
            # LLM to interpret the input as data for the event
            input_interpreted = await self._i_llm_tool.get_closest_match(input, act.eventData.data_type)
            self.record_response(item=f"{input}", chat_role="user")
            self.record_response(item=f"Interpreted as {input_interpreted}", chat_role="user",dcr_role=dcr_role,metadata={"interpreted":True})

        execution = DcrExecution(act_id, input=input_interpreted, role=dcr_role)
        self._dcr_semantics.executeActivity(execution, self._dcr_graph)
        self.trace.append(execution)

    async def handle_robot_permission(self, request: DcrChatRequest) -> bool:
        pending = self._robot_policy.pending
        if pending is None or request.act_id != pending.activity_id:
            raise ValidationError("The Robot permission response does not match the pending activity.")
        act = self.get_dcr_activity(pending.activity_id)
        if act is None:
            self._robot_policy.clear_permission()
            raise ValidationError(f"DCR activity {pending.activity_id!r} was not found.")

        decision = request.text if type(request.text) is bool else await self._i_llm_tool.get_closest_match(request.text, bool)
        self.record_response(item=f"{request.text} interpreted as Robot permission {decision}", chat_role="user", dcr_role=request.dcr_role)
        LOGGER.info("DCR Chat: Robot activity %s permission interpreted as %s", act.ID, decision)
        self._robot_policy.clear_permission()
        if decision:
            return await self.execute_robot_activity(act)

        self._robot_policy.deny_current_occurrence(act)
        self.record_response(item=f"Permission denied. Robot activity {act.label} was not executed.", chat_role="assistant", dcr_role=request.dcr_role)
        LOGGER.info("DCR Chat: Robot activity %s permission denied", act.ID)
        return False

    async def refresh_set_of_activities(self):
        self._enabled_events.clear()
        self._enabled_pending.clear()
        for element in self._dcr_graph.elements:
            if self._dcr_semantics.isEnabled(element,self._dcr_graph):
                self._enabled_events.add(element)
                if element.pending:
                    self._enabled_pending.add(element)
        self._robot_policy.observe_enabled([
            activity
            for activity in self._enabled_events
            if activity.role == "Robot"
        ])

    async def execute_robot_activity(self, act: DcrActivity, *, automatic: bool = False) -> bool:
        act_id = act.ID
        if act.data is not None or act.tool_call is not None:
            execution = DcrExecution(act_id, input=act.data, role=act.role)
            self._dcr_semantics.executeActivity(execution, self._dcr_graph)
            self.trace.append(execution)

            # normalized_request = self.normalize_request(request)
            msg = ""
            msg += f"answering query '{act.description}'" if act.description else ""
            msg += f"executed"
            msg += f" with data '{act.data}'" if act.data else ""
            self.record_response(
                item=f"Robot activity {act.label} {msg}.",
                chat_role="assistant",
                dcr_role="Robot",
                metadata={
                    "robot_execution": True,
                    "automatic": automatic,
                    "activity_id": act.ID,
                    "activity_label": act.label,
                },
            )
            LOGGER.info("DCR Chat: Robot activity %s executed", act.ID)
            return True
        else:
            return False

    def check_what_robot_executes(self, act, max_history=None):
        if act.pending and act.data:
            return True
        for i, t in enumerate(reversed(self.trace)):
            if max_history and i>=max_history:
                return True
            if t.activityID == act.ID:
                if t.input!=act.data:
                    return True
                else:
                    return False
        return True

    def get_activities_by_role(self, active_role):
        robot_acts = []
        denied_robot_acts = []
        active_role_acts = []
        non_active_role_acts = []
        element_list = []
        if len(self._enabled_pending)>0:
            element_list = self._enabled_pending
        elif len(self._enabled_events)>0:
            element_list = self._enabled_events
        else:
            print("[i] Nothing to execute")
        for act in element_list:
            if act.role == 'Robot':
                should_execute = self.check_what_robot_executes(act)
                if should_execute:
                    if self._robot_policy.is_current_occurrence_denied(act):
                        denied_robot_acts.append(act)
                    else:
                        robot_acts.append(act)
            elif act.role == active_role or act.role == None:
                active_role_acts.append(act)
            else:
                non_active_role_acts.append(act)

        # A denied pending Robot must not hide other enabled user work.
        if denied_robot_acts and not robot_acts:
            for act in self._enabled_events - set(element_list):
                if act.role == active_role or act.role is None:
                    active_role_acts.append(act)
                elif act.role != "Robot":
                    non_active_role_acts.append(act)
        return robot_acts, active_role_acts, non_active_role_acts, denied_robot_acts

    async def pick_next_user_activity(self, active_role) -> DcrActivity:
        robot_acts, active_role_acts, non_active_role_acts, denied_robot_acts = self.get_activities_by_role(active_role)
        while len(robot_acts)>0:
            robo_act = robot_acts.pop()
            if not self._robot_policy.can_execute_automatically(robo_act):
                self._robot_policy.request_permission(robo_act)
                LOGGER.info("DCR Chat: requesting permission for Robot activity %s", robo_act.ID, )
                return robo_act
            success = await self.execute_robot_activity(robo_act, automatic=True)
            if success:
                self._robot_policy.record_automatic_execution(robo_act)
                await self.refresh_set_of_activities()
                robot_acts, active_role_acts, non_active_role_acts, denied_robot_acts = self.get_activities_by_role(active_role)
                LOGGER.info("DCR Chat: Robot activity %s executed automatically (%s/%s)", robo_act.ID, self._robot_policy.automatic_counts[robo_act.ID], self._robot_policy.automatic_limit,
                )
        if len(active_role_acts)>0:
            print(f"[i] User in active role {active_role} needs to answer a question! From the following:")
            for act in active_role_acts:
                print(f"[i] \t Label: {act.label} - priority: {act.priority}")
            return prioritize_user_activities(active_role_acts,self._dcr_graph, self.trace)[0]
        elif len(non_active_role_acts)>0:
            self.record_response(item=f"You don't have anything to execute! We have notified the other roles about their activities!", chat_role="assistant", dcr_role=active_role)
            print("[i] You don't have anything to execute! We have notified the other roles about their activities!")
            return None
        elif len(denied_robot_acts)>0:
            labels = ", ".join(activity.label for activity in denied_robot_acts)
            message = f"The process is waiting because permission for Robot activity {labels} was denied."
            self.record_response(item=message, chat_role="assistant", dcr_role=active_role)
            LOGGER.info("DCR Chat: %s", message)
            return None
        else:
            print("[i] The process is complete!")
            self.record_response(item=f"The process is complete!", chat_role="assistant", dcr_role=active_role)
            return None

    async def present_question_to_user(self, active_role=None) -> DcrChatResponse|None:
        await self.refresh_set_of_activities()
        id = None
        role = None
        question = None
        act = await self.pick_next_user_activity(active_role)
        if act:
            id = act.ID
            pending = self._robot_policy.pending
            if pending is not None and pending.activity_id == id:
                role = active_role
                question = await self._o_llm_tool.get_robot_permission_question(act, self.history[-10:])
                LOGGER.info("DCR Chat: asking permission for Robot activity %s: %s", act.ID, question,)
            else:
                role = act.role
                question = (act.description or "").strip() or None

            if not question:
                q_act = self.get_dcr_activity(id)
                question = await self._o_llm_tool.get_question(q_act,self._dcr_graph) # Interpret with LLM to generate a question

            self.record_response(item=question, chat_role="assistant",dcr_role=role)
            graph_xml = dcr_exporter.serialize(self._dcr_graph, variant=dcr_exporter.DCR_JS_PORTAL).decode("utf-8")
            return DcrChatResponse(text=question, act_id=id, graph_xml=graph_xml,dcr_role=role)
        else:
            #return last message from history
            return None
    
    async def run(self, request: DcrChatRequest) -> DcrChatResponse|ChatSessionResponse:
        if request.robot_auto_limit is not None:
            self._robot_policy.set_automatic_limit(request.robot_auto_limit)
        pending = self._robot_policy.pending
        if pending is not None:
            if request.act_id != pending.activity_id:
                raise ValidationError(f"Answer the pending Robot permission for activity {pending.activity_id!r} before continuing.")
            await self.handle_robot_permission(request)
        elif request.act_id:
            await self.execute_activity_with_chat(request)
        res = await self.present_question_to_user(active_role=request.dcr_role)
        if res:
            return res
        else:
            graph_xml = dcr_exporter.serialize(self._dcr_graph, variant=dcr_exporter.DCR_JS_PORTAL).decode("utf-8")
            return DcrChatResponse(text=self.get_last_history_entry().item, session_id=request.session_id,graph_xml=graph_xml)

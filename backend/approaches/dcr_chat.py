"""DCR chat approach."""

from approaches.chat_interface import ChatWithHistory, Chat
from object.domain import ChatSessionResponse, DcrChatRequest, DcrChatResponse
from pm4py.objects.dcr.exporter import exporter as dcr_exporter
from pm4py.objects.dcr.ocdcr.obj import DcrGraph, DcrExecution, DcrActivity
from pm4py.objects.dcr.ocdcr.semantics import DcrSemantics
from tools.interpret_input import InterpretInput
from tools.interpret_output import InterpretOutput

from util.util import prioritize_user_activities

class DcrChat(ChatWithHistory):
    """just dcr no llm."""

    def __init__(self, dcr_graph: DcrGraph) -> None:
        super().__init__()
        self._dcr_graph = dcr_graph
        self._dcr_semantics = DcrSemantics()
        self._enabled_events = set()
        self._enabled_pending = set()
        self._trace = []
        self._i_llm_tool = InterpretInput()
        self._o_llm_tool = InterpretOutput()
    
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
        # act.eventData.coerce()
        if type(input) == act.eventData.data_type:
            input_interpreted = input
            self.record_response(item=f"{input}", chat_role="user")
        else:
            # LLM to interpret the input as data for the event
            input_interpreted = await self._i_llm_tool.get_closest_match(input, act.eventData.data_type)
            self.record_response(item=f"{input} interpreted as {input_interpreted}", chat_role="user",dcr_role=dcr_role)

        execution = DcrExecution(act_id, input=input_interpreted, role=dcr_role)
        self._dcr_semantics.executeActivity(execution, self._dcr_graph)
        self.trace.append(execution)

    async def refresh_set_of_activities(self):
        self._enabled_events.clear()
        self._enabled_pending.clear()
        for element in self._dcr_graph.elements:
            if self._dcr_semantics.isEnabled(element,self._dcr_graph):
                self._enabled_events.add(element)
                if element.pending:
                    self._enabled_pending.add(element)

    async def execute_robot_activity(self, act: DcrActivity):
        act_id = act.ID
        print(act_id,act.data)
        if act.data is not None or act.tool_call is not None:
            execution = DcrExecution(act_id, input=act.data, role=act.role)
            self._dcr_semantics.executeActivity(execution, self._dcr_graph)
            self.trace.append(execution)

            # normalized_request = self.normalize_request(request)
            self.record_response(item=f"Robot activity {act.label} answering {act.description} executed with {act.data}", chat_role="assistant", dcr_role="Robot")
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
                    robot_acts.append(act)
            elif act.role == active_role or act.role == None:
                active_role_acts.append(act)
            else:
                non_active_role_acts.append(act)
        return robot_acts, active_role_acts, non_active_role_acts

    async def pick_next_user_activity(self, active_role) -> DcrActivity:
        robot_acts, active_role_acts, non_active_role_acts = self.get_activities_by_role(active_role)
        while len(robot_acts)>0:
            robo_act = robot_acts.pop()
            success = await self.execute_robot_activity(robo_act)
            if success:
                await self.refresh_set_of_activities()
                robot_acts, active_role_acts, non_active_role_acts = self.get_activities_by_role(active_role)
                print("[i] Robot activity executed automatically!")
        if len(active_role_acts)>0:
            print(f"[i] User in active role {active_role} needs to answer a question! From the following:")
            for act in active_role_acts:
                print(f"[i] \t {act.label} {act.priority}")
            return prioritize_user_activities(active_role_acts,self._dcr_graph, self.trace)[0]
        elif len(non_active_role_acts)>0:
            self.record_response(item=f"You don't have anything to execute! We have notified the other roles about their activities!", chat_role="assistant", dcr_role=active_role)
            print("[i] You don't have anything to execute! We have notified the other roles about their activities!")
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
            role = act.role
            question = act.description

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
        if request.act_id:
            await self.execute_activity_with_chat(request)
        res = await self.present_question_to_user(active_role=request.dcr_role)
        if res:
            return res
        else:
            graph_xml = dcr_exporter.serialize(self._dcr_graph, variant=dcr_exporter.DCR_JS_PORTAL).decode("utf-8")
            return DcrChatResponse(text=self.get_last_history_entry().item, session_id=request.session_id,graph_xml=graph_xml)
"""DCR chat approach."""

from approaches.chat_interface import ChatWithHistory, Chat
from object.domain import DcrChatRequest, DcrChatResponse
from pm4py.objects.dcr.exporter import exporter as dcr_exporter
from pm4py.objects.dcr.ocdcr.obj import DcrGraph, DcrExecution
from pm4py.objects.dcr.ocdcr.semantics import DcrSemantics

class DcrChat(ChatWithHistory):
    """just dcr no llm."""

    def __init__(self, dcr_graph: DcrGraph) -> None:
        super().__init__()
        self._dcr_graph = dcr_graph
        self._dcr_semantics = DcrSemantics()
        self._enabled_events = set()
        self._enabled_pending = set()
        self._trace = []
    
    @property
    def trace(self) -> list[str]:
        return self._trace
    
    def get_trace(self) -> list[str]:
        return []

    def clear_trace(self) -> None:
        self._trace.clear()

    async def run(self, request: DcrChatRequest) -> DcrChatResponse:
        if isinstance(request, DcrChatRequest) and request.act_id:
            self._dcr_semantics.executeActivity(DcrExecution(request.act_id),self._dcr_graph)
            self.trace.append(request.act_id)

        normalized_request = self.normalize_request(request)
        self.record_response(item=normalized_request.text, chat_role="user")

        self._enabled_events.clear()
        self._enabled_pending.clear()
        for element in self._dcr_graph.elements:
            if self._dcr_semantics.isEnabled(element,self._dcr_graph):
                self._enabled_events.add(element)
                if element.pending:
                    self._enabled_pending.add(element)
        for e in self._enabled_pending:
            print(e.label)
        id = None
        role = None
        question = None
        if len(self._enabled_pending)>0 or len(self._enabled_events)>0:
            if len(self._enabled_pending)>0:
                act = list(self._enabled_pending)[0]
            else:
                act = list(self._enabled_events)[0]
            id = act.ID
            role = act.role
            question = act.description

        self.record_response(item=question, chat_role="assistant",dcr_role=role)
        graph_xml = dcr_exporter.serialize(
            self._dcr_graph, variant=dcr_exporter.DCR_JS_PORTAL
        ).decode("utf-8")
        return DcrChatResponse(text=question, act_id=id, graph_xml=graph_xml)

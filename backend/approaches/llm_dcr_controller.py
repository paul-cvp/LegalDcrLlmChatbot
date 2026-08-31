"""Language-model-backed DCR controller chat approach."""

from collections.abc import Callable

from approaches.dcr_chat import DcrChat
from approaches.chat_interface import ChatWithHistory
from object.domain import (
    ChatHistoryEntry,
    ChatRequest,
    ChatSessionRequest,
    DcrChatRequest,
    DcrChatResponse,
    DcrControllerChatResponse,
    DcrGraphCandidate,
)
from object.errors import ValidationError
from pm4py.objects.dcr.importer import importer as dcr_importer
from pm4py.objects.dcr.ocdcr.obj import DcrGraph
from tools.find_relevant_dcr_graphs import FindRelevantDcrGraphs


DcrChatFactory = Callable[[DcrGraph, int | None], DcrChat]


class LLMDcrControllerChat(ChatWithHistory):
    """Find a DCR graph, then delegate the session to DcrChat."""

    def __init__(
        self,
        graph_finder: FindRelevantDcrGraphs | None = None,
        dcr_chat_factory: DcrChatFactory | None = None,
        top_k: int = 5,
    ) -> None:
        super().__init__()
        self._graph_finder = graph_finder or FindRelevantDcrGraphs()
        self._dcr_chat_factory = dcr_chat_factory
        self._top_k = top_k
        self._candidates = {}
        self._dcr_chat: DcrChat | None = None

    @property
    def history(self) -> list[ChatHistoryEntry]:
        return self._dcr_chat.history if self._dcr_chat else self._history

    def get_history(self) -> list[ChatHistoryEntry]:
        return list(self.history)

    def clear_history(self) -> None:
        self.history.clear()

    async def run(
        self,
        request: ChatRequest | str,
    ) -> DcrControllerChatResponse | DcrChatResponse:
        normalized_request = self.normalize_request(request)
        if self._dcr_chat is not None:
            return await self._dcr_chat.run(self._as_dcr_request(normalized_request))

        text = normalized_request.text
        if not isinstance(text, str):
            raise ValidationError("DCR graph searches and selections must be text.")

        selected_graph = self._candidates.get(text)
        if selected_graph is not None:
            return await self._start_dcr_chat(normalized_request, selected_graph.content)

        answer = await self._graph_finder.answer(
            text,
            user_info=normalized_request.citizen_information,
            top_k=self._top_k,
            graph_format="xml",
        )
        self._candidates = {graph.source: graph for graph in answer.graphs}
        self.record_response(text, "user", getattr(normalized_request, "dcr_role", None))
        self.record_response(answer.text, "assistant")
        return DcrControllerChatResponse(
            text=answer.text,
            graphs=[
                DcrGraphCandidate(
                    graph_id=graph.graph_id,
                    source=graph.source,
                    format=graph.format,
                    score=graph.score,
                    excerpt=graph.excerpt,
                )
                for graph in answer.graphs
            ],
        )

    async def _start_dcr_chat(
        self,
        request: ChatRequest,
        graph_xml: str,
    ) -> DcrChatResponse:
        dcr_request = self._as_dcr_request(request)
        if not dcr_request.dcr_role:
            raise ValidationError("dcr_role is required when selecting a DCR graph.")

        graph = dcr_importer.deserialize(
            graph_xml,
            variant=dcr_importer.DCR_JS_PORTAL,
        )
        dcr_chat = (
            self._dcr_chat_factory(graph, dcr_request.robot_auto_limit)
            if self._dcr_chat_factory is not None
            else self._create_dcr_chat(
                graph,
                dcr_request.robot_auto_limit,
                dcr_request.citizen_information,
                bool(getattr(dcr_request.metadata, "use_trace_data", True)),
            )
        )
        # Carry discovery messages into the process chat's session history.
        dcr_chat.history.extend(self._history)
        dcr_chat.record_response(dcr_request.text, "user", dcr_request.dcr_role)
        self._dcr_chat = dcr_chat
        return await dcr_chat.run(dcr_request)

    @staticmethod
    def _create_dcr_chat(
        graph: DcrGraph,
        robot_auto_limit: int | None,
        citizen_information: str | None,
        use_trace_data: bool,
    ) -> DcrChat:
        return DcrChat(
            graph,
            robot_auto_limit=robot_auto_limit,
            user_context=citizen_information,
            use_trace_data=use_trace_data,
        )

    @staticmethod
    def _as_dcr_request(request: ChatRequest) -> DcrChatRequest:
        if isinstance(request, DcrChatRequest):
            return request
        if isinstance(request, ChatSessionRequest):
            return DcrChatRequest(
                text=request.text,
                session_id=request.session_id,
            )
        raise ValidationError("A DCR chat session request is required.")

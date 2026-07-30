"""Language-model-backed DCR controller chat approach."""

from approaches.chat_interface import ChatWithHistory


class LLMDcrControllerChat(ChatWithHistory):
    """DCR-controller specialization of the language-model chat."""

from object.domain import ChatMetadata, DcrChatMetadata, DcrChatRequest, RagChatMetadata


def test_chat_metadata_flags_default_to_enabled():
    metadata = ChatMetadata()

    assert metadata.use_chat_history is True
    assert DcrChatMetadata().use_trace_data is True


def test_metadata_subtypes_parse_disabled_chat_flags():
    assert RagChatMetadata(use_chat_history=False).use_chat_history is False
    metadata = DcrChatMetadata(use_chat_history=False, use_trace_data=False)
    assert metadata.use_chat_history is False
    assert metadata.use_trace_data is False


def test_dcr_request_parses_dcr_metadata():
    request = DcrChatRequest(
        text="",
        chat_type=1,
        metadata={"use_chat_history": False, "use_trace_data": False},
    )

    assert isinstance(request.metadata, DcrChatMetadata)
    assert request.metadata.use_trace_data is False

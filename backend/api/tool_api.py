"""HTTP routes exposing tool calls approved for DCR activities."""

from fastapi import APIRouter
from pydantic import BaseModel

from tools.tool_call import ToolCall


router = APIRouter(prefix="/api/tool-calls", tags=["Tool calls"])


class ToolCallOption(BaseModel):
    value: str
    label: str


@router.get("", response_model=list[ToolCallOption])
@router.get("/", response_model=list[ToolCallOption], include_in_schema=False)
async def list_tool_calls() -> list[ToolCallOption]:
    """List the only tool calls accepted by the DCR XML importer."""
    return [ToolCallOption(value=tool.value, label=tool.label) for tool in ToolCall]

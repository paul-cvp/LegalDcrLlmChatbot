"""HTTP routes for editor-format DCR graphs."""

from fastapi import APIRouter, HTTPException, Response, status

from controller.dcr_dashboard_controller import DcrDashboardController
from object.domain import (
    DCRGraphCreate,
    DCRGraphHolder,
    DCRGraphUpdate,
)

from object.errors import (
    ConflictError,
    ControllerError,
    NotFoundError,
    PersistenceError,
    ValidationError,
)

router = APIRouter(prefix="/api/dcr-graphs", tags=["DCR graphs"])
controller = DcrDashboardController()


def _http_error(error: ControllerError) -> HTTPException:
    status_code = {
        ValidationError: 422,
        NotFoundError: status.HTTP_404_NOT_FOUND,
        ConflictError: status.HTTP_409_CONFLICT,
        PersistenceError: status.HTTP_500_INTERNAL_SERVER_ERROR,
    }.get(type(error), status.HTTP_500_INTERNAL_SERVER_ERROR)
    return HTTPException(status_code=status_code, detail=str(error))


@router.get("", response_model=list[DCRGraphHolder])
@router.get("/", response_model=list[DCRGraphHolder], include_in_schema=False)
async def list_graphs() -> list[DCRGraphHolder]:
    try:
        return controller.list_graphs()
    except ControllerError as error:
        raise _http_error(error) from error


@router.get("/{name}", response_model=DCRGraphHolder)
async def get_graph(name: str) -> DCRGraphHolder:
    try:
        return controller.get_graph(name)
    except ControllerError as error:
        raise _http_error(error) from error


@router.post("", response_model=DCRGraphHolder, status_code=status.HTTP_201_CREATED)
@router.post(
    "/",
    response_model=DCRGraphHolder,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_graph(graph: DCRGraphCreate) -> DCRGraphHolder:
    try:
        return controller.create_graph(graph)
    except ControllerError as error:
        raise _http_error(error) from error


@router.put("/{name}", response_model=DCRGraphHolder)
async def update_graph(name: str, graph: DCRGraphUpdate) -> DCRGraphHolder:
    try:
        return controller.update_graph(name, graph)
    except ControllerError as error:
        raise _http_error(error) from error


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_graph(name: str) -> Response:
    try:
        controller.delete_graph(name)
    except ControllerError as error:
        raise _http_error(error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# DCR Controller

DCR Controller combines the DCR-js frontend with a local FastAPI backend. DCR graphs saved in the UI are persisted as editor-format XML files in `backend/data/models`.

## Requirements

- Python 3.10 or newer
- Node.js and Yarn Classic

Install the dependencies from the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && yarn install && cd ..
```

## Start the application

```bash
./start.sh
```

The frontend is available at <http://localhost:5173/dcr-js> and the API documentation at <http://localhost:8000/docs>. The script stops both development servers when either server exits or when it receives `Ctrl+C`.

The ports can be changed with `BACKEND_PORT` and `FRONTEND_PORT`. Use `DCR_BACKEND_URL` to change the Vite development proxy target, `DCR_MODELS_DIR` to change the model storage directory, and comma-separated `DCR_CORS_ORIGINS` to configure browser origins.

`DCR_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY` controls automatic Robot activity executions per activity and chat session. It defaults to `1`; use `-1` for unlimited automatic execution, `0` to always ask permission, or a positive integer for that many automatic executions.

## DCR graph persistence

The dashboard loads saved graphs from the backend when it starts. **Save Graph** updates the selected graph, while **Save Graph As** creates a separate graph and leaves the original unchanged. Persisted XML uses the same formatted editor representation as **Download Editor XML**.

Graph names are trimmed, must be between 1 and 120 characters, and may contain ASCII letters, numbers, spaces, hyphens, and underscores. Names are unique without regard to letter case. Each graph is stored as `backend/data/models/<name>.xml`.

## API

All graph endpoints use JSON and are rooted at `/api/dcr-graphs`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dcr-graphs` | List all graphs with their editor XML |
| `GET` | `/api/dcr-graphs/{name}` | Read one graph |
| `POST` | `/api/dcr-graphs` | Create a graph from `{ "name", "xml" }` |
| `PUT` | `/api/dcr-graphs/{name}` | Update a graph from `{ "xml" }` |
| `DELETE` | `/api/dcr-graphs/{name}` | Delete a graph |

The API accepts only well-formed XML using the DCR editor `definitions` root element. Duplicate names return HTTP `409`; invalid names or XML return HTTP `422`.

## Tests and builds

```bash
cd backend && python -m pytest tests
cd ../frontend && yarn workspace app predeploy
```

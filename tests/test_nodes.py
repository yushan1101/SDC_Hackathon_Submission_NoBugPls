"""Multi-node: the worker node rejects calls without NODE_TOKEN (main-node side: test_api.test_node_config_needs_token)."""
def test_worker_requires_token():
    from fastapi.testclient import TestClient
    from mcp_server.server import mcp
    from worker import RequireToken
    with TestClient(RequireToken(mcp.http_app(path="/mcp"), "s3cret")) as c:
        assert c.get("/").status_code == 200  # host health check stays open
        assert c.post("/mcp", json={}).status_code == 401
        assert c.post("/mcp", json={}, headers={"Authorization": "Bearer nope"}).status_code == 401
        assert c.post("/mcp", json={}, headers={"Authorization": "Bearer s3cret"}).status_code != 401

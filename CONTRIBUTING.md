# Team workflow

Branches: `feature/router`, `feature/forecast`, `feature/mcp-governance`, `feature/ui`.

1. Implement against the contracts documented in `docs/api_contracts.md`.
2. Add unit tests and a clear Pull Request description.
3. Run `pytest` before every merge.
4. Never change shared state keys without notifying all owners.
5. Record GPU spend and model experiments in `docs/experiment_log.md`.

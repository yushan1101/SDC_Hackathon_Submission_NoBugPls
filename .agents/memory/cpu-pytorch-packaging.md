---
name: CPU PyTorch packaging
description: Environment-specific package installer issue encountered while keeping the app on CPU-only inference.
---

For this Python project, use an explicit CPU PyTorch index and resolve from the project manifest rather than relying on the package installer's add operation once that index is configured. The add operation unexpectedly associated many unrelated packages with the CPU index, leaving dependency resolution impossible.

**Why:** CPU inference avoids downloading the much larger CUDA runtime; the package installer's source editing was not safe with the explicit index.

**How to apply:** When changing the serving dependencies, keep the CPU-only source mapping narrow and inspect manifest changes before accepting installer-generated edits. Resolve using the existing manifest when necessary.

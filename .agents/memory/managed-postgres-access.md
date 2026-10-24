---
name: Managed PostgreSQL access boundaries
description: Safe Replit development and production database access when workspace shell environment labels are ambiguous.
---

Use Replit's environment-scoped database tools for managed database work. In this workspace, the shell reported `REPLIT_ENVIRONMENT=production` even though the development database was available through the Replit development SQL tool. A direct `DATABASE_URL` migration must stop when the shell reports production; do not override that guard.

**Why:** the runtime-managed URL can point at a different environment than intended, and production schema changes are applied through Publish rather than direct shell connections.

**How to apply:** apply and verify development schema/data through the development database tool, validate the running app, then let the user publish and resolve the production database copy/diff prompts.

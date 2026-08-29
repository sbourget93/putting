# Agent Guidelines

## Immediately
- Read [`./README.md`](./README.md).

## Core Design Considerations
This table does not prescribe solutions, it only provides context and constraints. The solutions exist in the `AGENTS.md` files in each components directory.
| Principle | Assumption/Constraint |
| --- | --- |
| **Inexpensive** | This app should run as inexpensively as possible without risking permanent data loss. |
| **Mobile Interface** | This app is intended to be used primarily on mobile devices. Desktop formatting can be ignored. |
| **Event Sourced** | This app uses event sourcing and projections. Events will be persisted to S3 for durability. |
| **Writes Require Login** | Only logged in users should be able to perform actions resulting in a database write. |
| **User-Scoped Data** | User actions should never be able to modify objects owned by a different user. |
| **Offline Supported** | The core feature of this app (recording and editing a daily "test" of putts) should work entirely offline and sync to the server when possible. |
| **No Sensitive Data** | All data stored locally or on S3 should be completely innocuous. Things that users might not want to be leaked (such as their email address) should not be stored. Names are fine. |

## Cross-Component Decisions
These decisions span more than one component, or are not component specific.
| Decision | Detail |
| --- | --- |
| **Shared Configuration** | App-wide values live in [`./app.config.json`](./app.config.json) at the repository root. |
| **One Gitignore** | Keep one single `.gitignore` file at the repository root, rather than many individual nested `.gitignore` files. |

## Context Routing Rules
Before writing code or executing tasks, evaluate the scope of the request. You must read the corresponding context file(s) listed below if the task touches that domain:

| Domain | When the task touches | Context file |
| --- | --- | --- |
| Backend | API endpoints (FastAPI), CQRS, database (SQLite), backup/durability (S3), event sourcing | [`backend/AGENTS.md`](./backend/AGENTS.md) |
| Data Model | database table schemas, projections, frontend aggregate mirrors (offline snapshots, reducers) | [`documentation/models/AGENTS.md`](./documentation/models/AGENTS.md) |
| Roles | RBAC constraints and descriptions | [`documentation/roles/AGENTS.md`](./documentation/roles/AGENTS.md) |
| Frontend | UI (React/Vite), local-first (IndexedDB), offline sync, PWA, auth/login (Google), reverse proxy (nginx) | [`frontend/AGENTS.md`](./frontend/AGENTS.md) |
| Gateway | reverse proxy (nginx) | [`gateway/AGENTS.md`](./gateway/AGENTS.md) |
| Infrastructure | IaC (Terraform), cloud compute (EC2), DNS (Route 53), SSL (certbot), source control (Github), deployment, production debugging, cloud secrets (SSM) | [`infrastructure/AGENTS.md`](./infrastructure/AGENTS.md) |
| Local Dev | docker-compose, unit testing, local debugging | [`local/AGENTS.md`](./local/AGENTS.md) |

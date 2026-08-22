# Agent Guidelines

## Immediately
- Read [`./README.md`](./README.md).

## Template Instructions
If `.is_template` exists at the repo root:
- This is a template repository.
- Immediately read [`./AGENTS_TEMPLATE.md`](./AGENTS_TEMPLATE.md) for instructions specific to the template repository.

Otherwise:
- This repository began as a fork of an application template.
- **Do not** read [`./AGENTS_TEMPLATE.md`](./AGENTS_TEMPLATE.md) unless explicitly asked to.
- Make UI/UX design decisions based on the existing template files. See the Styling section of [`frontend/AGENTS.md`](./frontend/AGENTS.md), plus the theme tokens in [`frontend/src/index.css`](./frontend/src/index.css) and worked examples like [`FooModal`](./frontend/src/components/FooModal.tsx) and [`TemplateTestPage`](./frontend/src/pages/TemplateTestPage.tsx).

## Template Improvement
If this is not the template repository, determine if certain changes should *also* be made to the template (non application-specififc changes such boilerplate adjustments, testing workflows, auth changes, design decisions for net-new components, etc). Keep a concise running table of these changes in `./template_improvements.md` so the developer may adjust the template repositry at his convenience. The same file may be used even if this is the template repository to store TODO items at the request of the developer. Do not add entries to this document that have not been specifically discussed.

## Core Design Considerations
This table does not prescribe solutions, it only provides context and constraints. The solutions exist in the `AGENTS.md` files in each components directory.
| Principle | Assumption/Constraint |
| --- | --- |
| **Inexpensive** | This app should run as inexpensively as possible without risking permanent data loss. |
| **Mobile Interface** | This app is intended to be used primarily on mobile devices. Desktop formatting can be ignored. |
| **Event Sourced** | This app uses event sourcing and projections. Events will be persisted to S3 for durability. |
| **Only Admins Write** | Only authenticated admins may cause a database write. |
| **Few Admins** | This app is scoped for personal use. There will never be more than a handful of admins for. Therefore write conflicts will be rare and don't need to be handled comprehensively. |
| **Offline Supported** | This app will frequently be used in places with poor internet access. It must start and work seamlessly when offline, and sync with the server when possible. |

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
| Data Model | database table schemas, projections, frontend aggregate mirrors (offline snapshots, reducers) | [`documentation/AGENTS.md`](./documentation/AGENTS.md) |
| Frontend | UI (React/Vite), local-first (IndexedDB), offline sync, PWA, auth/login (Google), reverse proxy (nginx) | [`frontend/AGENTS.md`](./frontend/AGENTS.md) |
| Gateway | reverse proxy (nginx) | [`gateway/AGENTS.md`](./gateway/AGENTS.md) |
| Infrastructure | IaC (Terraform), cloud compute (EC2), DNS (Route 53), SSL (certbot), source control (Github), deployment, production debugging, cloud secrets (SSM) | [`infrastructure/AGENTS.md`](./infrastructure/AGENTS.md) |
| Local Dev | docker-compose, unit testing, local debugging | [`local/AGENTS.md`](./local/AGENTS.md) |

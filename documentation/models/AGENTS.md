# Data Models Agent Guidelines

This directory holds reference documentation for the application's data model.

Before writing or modifying code that touches projection data models (table schemas, projections, or the events that feed them), read [`README.md`](./README.md) for the required context.

Consult the models whenever you edit backend table schemas/projections or the frontend aggregate data that mirrors them (offline snapshots & reducers). This documentation, backend projection schemas, and frontend aggregate schemas must all stay in sync. If, at any time, you notice that the documentation and the implementation are not in sync, prompt the developer to reconcile the differences.

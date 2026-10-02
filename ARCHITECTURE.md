# Architecture

Both apps use hexagonal boundaries. Domain rules and application logic depend on contracts they own. HTTP, PostgreSQL, model providers, n8n and React sit outside that core.

```text
Inbound adapter → application → domain
                       ↓
                 application port
                       ↑
                 outbound adapter
```

The entry points choose concrete adapters and inject them. Core code does not import those implementations, NestJS, React, `fetch`, or environment configuration.

## Backend: `apps/api/src`

```text
src/
├── domain/
│   ├── assessment.ts                  Verdict and exact-quote validation
│   ├── requirements.ts                Submitted requirement rules
│   ├── implementation-path.ts         Deterministic dossier rules
│   ├── run-trace.ts                   Safe execution evidence
│   └── errors.ts                      Framework-independent failures
├── application/
│   ├── runs.service.ts                Assessment and run use cases
│   ├── demo-runs.service.ts            Admission and workflow start
│   ├── assessment.prompt.ts           Shared generation policy
│   └── ports/
│       ├── run-store.ts               Persistence and retrieval contract
│       ├── assessment-generator.ts    Model generation contract
│       └── workflow-starter.ts        Workflow dispatch contract
├── adapters/
│   ├── inbound/http/
│   │   ├── runs.controller.ts         Routes, request binding and delegation
│   │   ├── internal-token.guard.ts    Worker authentication
│   │   └── assessment-error.filter.ts Application failure → HTTP response
│   └── outbound/
│       ├── postgres/                  SQL repository and connection lifecycle
│       ├── ai/                        Provider transport and failover
│       └── n8n/                       Authenticated webhook transport
├── app.module.ts                      Composition: adapters, ports and logging
└── main.ts                            HTTP bootstrap
```

`RunsService` accepts `RunStore` and `AssessmentGenerator`. `DemoRunsService` accepts `RunStore` and `WorkflowStarter`. `RunsRepository`, `AssessmentModel` and `N8nWorkflowStarter` implement those ports. `AppModule` binds them through explicit provider factories; the services are ordinary TypeScript classes.

The controller delegates to application use cases. The HTTP filter translates typed application failures to the existing 400, 404, 409, 429 and 503 responses. Authentication stays in the inbound guard. Database constraints and atomic writes stay in the PostgreSQL adapter; provider deadlines and response parsing stay in the AI adapter.

Database migrations and provisioning scripts remain outside `src`. The exported n8n workflow remains in `n8n/`, because it runs in a separate process.

## Web: `apps/web/src`

```text
src/
├── domain/
│   ├── assessment.ts                  Requirements, verdicts, sources and traces
│   └── execution.ts                   Live/recorded execution and quote selection
├── application/
│   ├── flow.ts                        Evidence status and recorded replay rules
│   └── ports/assessment-api.ts         Assessment backend contract
├── adapters/
│   ├── inbound/react/
│   │   ├── App.tsx                    Interaction and navigation
│   │   ├── assessment/                Cited answers and implementation path
│   │   ├── documents/                 Full document reader
│   │   ├── execution/                 Activity, n8n graph and evidence inspectors
│   │   ├── illustrations/             Evidence illustration
│   │   └── components/                Shared presentation
│   └── outbound/http/api.ts           Requests, deadlines and response validation
└── main.tsx                           Composition and React mount
```

The HTTP adapter implements `AssessmentApi`. `main.tsx` supplies it to `App`, which passes it to the document reader and source dialog. React imports core models and ports, never the concrete HTTP client. Polling cancellation, focus, dialogs and navigation remain in the React adapter. Status and replay calculations remain independent of React and HTTP.

The browser models describe public serialized responses; backend persistence types describe stored rows. They belong to separate application boundaries rather than a shared database model.

## Follow one request

1. React calls `AssessmentApi.startDemo` through the injected HTTP adapter.
2. The HTTP controller delegates to `DemoRunsService`, which validates input, reserves admission through `RunStore`, and dispatches through `WorkflowStarter`.
3. The n8n adapter calls the authenticated webhook. n8n calls the worker HTTP endpoints to create and assess a run.
4. `RunsService` retrieves pinned sources through `RunStore`, generates through `AssessmentGenerator`, applies domain validation, and persists the validated assessment.
5. n8n requests the deterministic dossier and completion. React reads saved results and execution receipts through its API port.

## Keep the boundaries intact

Run `pnpm check:architecture`. It scans production TypeScript imports in both apps:

- Domain modules may import domain modules and Node built-ins.
- Application modules may import application/domain modules and Node built-ins.
- An adapter may import its own adapter directory and the core; it may not import another adapter or the composition root.
- Only `main.ts`, `main.tsx` and `app.module.ts` are composition entry points at the source root.
- Core modules may not call `fetch` or access `process.env`.

The check covers static imports/re-exports and literal dynamic/type imports. JSON resources used by the illustrated workflow are allowed in adapters. It is a dependency guard, not a proof of every runtime interaction.

Tests are colocated with their owners. Integration tests can cross adapter boundaries to exercise real composition. `pnpm test` runs the boundary check before tests; set `TEST_DATABASE_URL` to a migrated, seeded disposable database to run PostgreSQL and HTTP integration tests.

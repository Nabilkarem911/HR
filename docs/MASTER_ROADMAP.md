# Gpack-HR — Master Project Control Document

> Last reviewed: 2026-08-27  
> Repository: `F:\projects\HR-main`  
> Scope of this document: planning and control only. No feature implementation is performed by this document.

## Production Evidence Record

| Item | Evidence | Date |
|---|---|---|
| Production commit | `1d0fa32` | 2026-08-27 |
| Production deployment | PASS | 2026-08-27 |
| Container health | healthy, `/health` = 200 | 2026-08-27 |
| Migrations | 8/8 applied, zero pending | 2026-08-27 |
| Production database baseline | preserved | 2026-08-27 |
| Production backup | verified | 2026-08-27 |
| Dokploy app/database separation | verified | 2026-08-27 |
| PostgreSQL persistent volume | verified | 2026-08-27 |
| Final Production Regression | 84/84 PASS | 2026-08-27 |
| Attendance DELETE fix | deployed and verified | 2026-08-27 |
| Dashboard KPIs fix | deployed and verified | 2026-08-27 |
| Dashboard audit-log scoping | deployed and verified | 2026-08-27 |
| Settings RBAC fix | deployed and verified | 2026-08-27 |
| Companies validation fix | deployed and verified | 2026-08-27 |
| Vehicles document validation fix | deployed and verified | 2026-08-27 |

## Master Status Dashboard

| Metric | Count |
|---|---:|
| Total tasks | 77 |
| P0 — production/security/data-loss blocker | 11 |
| P1 — critical business functionality | 28 |
| P2 — major product improvement | 26 |
| P3 — UX/performance improvement | 9 |
| P4 — nice-to-have | 3 |
| NOT STARTED | 64 |
| IN PROGRESS | 0 |
| BLOCKED | 4 |
| VERIFYING | 4 |
| COMPLETE | 5 |

- **Current phase:** Phase 2 — Organization Structure & Employee 360 (ORG-001 implemented, pending Production verification)
- **Current task:** ORG-001 — Organization Structure (VERIFYING — isolated runtime PASS, pending Production deploy + verification)
- **Next task:** ORG-002 — Employee reporting relationships (P2, NOT STARTED — depends on ORG-001 Production verification)
- **Primary blockers:** ESS still retains `plain_password` dependency (SEC-004); `app.js` runs migrations automatically on startup with no release gate (FND-004); migration runner is not transactional per migration (DB-001); canonical isolated test DB not yet evidenced (FND-005); restore drill not yet demonstrated (DB-003 VERIFYING).

## Control Rules

### Classification

- **EXISTS** — capability is present and usable in the repository.
- **PARTIAL** — core capability exists but workflow, coverage, or integration is incomplete.
- **IMPROVEMENT** — capability exists and needs security, UX, business, performance, or reliability improvement.
- **NEW** — capability is not present and requires new product work.
- **TECHNICAL** — architecture, security, reliability, quality, deployment, or data-engineering work.

### Status rules

A task is not `COMPLETE` until it has:

```text
Code
+ Static checks
+ Runtime verification in isolated environment
+ Regression verification
+ Production verification when applicable
+ Documentation
```

`UNKNOWN` is never treated as `PASS`. Production data is never used as a test fixture.

### Task contract

Every task row below records: ID, priority, current state, goal/scope, expected files/modules, database/migration impact, security/API/frontend impact, verification/rollback, acceptance criteria, and status. File paths are targets, not authorization to modify them before the task is approved.

## Current Repository Reality

### Architecture

- Static HTML/CSS/Vanilla JavaScript SPA shell: `index.html`, `assets/js/app.js`, `pages/*.html`.
- Express API: `server/src/app.js`.
- PostgreSQL through `pg` pool: `server/src/config/db.js`.
- JWT authentication: `server/src/middleware/auth.js`.
- Custom role/module/action RBAC: `server/src/middleware/rbac.js`.
- Async success-based audit middleware: `server/src/middleware/auditLog.js`.
- Basic required-field/UUID/enum validators: `server/src/middleware/validate.js`.
- Supabase-shaped compatibility layer: `assets/js/apiClient.js`; active frontend callers use `window.db`.
- API startup runs `runMigrations()` from `app.js`; `Dockerfile` now starts `node src/app.js` directly.
- `initDb.js` remains a separate initialization/seed operation.

### Database reality

`server/schema.sql` defines 16 core tables:

```text
companies
employees
system_users
employee_documents
employee_assets
issued_letters
employee_requests
monthly_attendance
payroll_records
vehicles
vehicle_documents
audit_logs
system_settings
branches
departments
job_positions
```

Direct ownership is represented by `company_id` on several tables and indirectly through `employee_id -> employees.company_id` on employee children. `company_id` is nullable in several tables and there is no universal tenant constraint.

There are 9 migrations. The runner creates `schema_migrations`, sorts SQL files, skips registered filenames, and runs new files once. It does not wrap each migration and its tracking insert in an explicit transaction.

### Product capability matrix

| Module | Repository status | Evidence / current capability |
|---|---|---|
| Authentication | **EXISTS / IMPROVEMENT** | Unified admin/ESS login, JWT, bcrypt for admin path, phone/email lookup; ESS still supports `plain_password`; stateless 7-day tokens. |
| Users & RBAC | **EXISTS / IMPROVEMENT** | Five roles, default matrix, custom permission merge, route middleware; several GET routes rely on frontend or inline checks. |
| Companies | **EXISTS / IMPROVEMENT** | CRUD, building number, logo URL, soft archive, company employee view, static ownership hardening. |
| Organization Structure | **EXISTS / IMPROVEMENT** | Branches, departments (with hierarchy), job positions, employee org links; backend `/api/organization` with CRUD + tree; frontend `pages/organization.html`; RBAC `organization` module. Implemented ORG-001, pending Production verification. |
| Employees | **EXISTS / IMPROVEMENT** | CRUD, search, status, salary masking, soft delete, company association, employee code generation. |
| Employee Profile / Employee 360 | **PARTIAL** | Profile page, modal 360 view, linked assets/requests/letters; no authoritative consolidated read model, timeline, or history. |
| Employee Self Service (ESS) | **PARTIAL / IMPROVEMENT** | ESS profile, requests, letters, salary certificate; identity/session flow is separate and credential storage needs hardening. |
| Attendance | **PARTIAL** | Monthly grid, batch updates, filters, export/print UI, ownership hardening; no shifts/schedules/device ingestion/lock workflow. |
| Leaves | **PARTIAL** | Unified request records and approval statuses; no leave-balance engine, overlap policy, cancellation, or multi-level approvals. |
| Loans | **PARTIAL** | Request records, paid amount, auto-deduct, installments, payroll consumption; no authoritative loan ledger/eligibility/settlement workflow. |
| Payroll | **PARTIAL / IMPROVEMENT** | Draft/approved records, batch transaction, aliases, approved lock, frontend calculation, payslip UI; no server-authoritative calculation, history, formal approval workflow, or reliable runtime regression suite. |
| Letters | **PARTIAL / IMPROVEMENT** | Templates/rendering, PDF/print, archive, reference numbers, company branding, ESS access; no template administration, versioning, signature, or formal approval. |
| Employee Requests | **EXISTS / IMPROVEMENT** | Leave/loan/letter request CRUD and status transitions; no unified workflow engine, attachment support, escalation, or complete server-side ownership on every read path. |
| Compliance / Documents | **EXISTS / IMPROVEMENT** | Employee document CRUD, expiry radar, renewal UI; file storage, alerts, history, and reporting are missing. |
| Assets | **EXISTS / IMPROVEMENT** | Assignment/return/damage/lost lifecycle, serials, employee ownership hardening; no history, depreciation, maintenance, or barcode. |
| Vehicles | **EXISTS / IMPROVEMENT** | Vehicles and vehicle documents CRUD, expiry fields, ownership hardening; no driver, maintenance, expense, photo, or fleet history. |
| Dashboard | **EXISTS / IMPROVEMENT** | KPI counts, compliance radar, audit preview; KPI double-WHERE and audit scope gap fixed and verified in Production regression (84/84 PASS). |
| Settings | **PARTIAL / IMPROVEMENT** | Global key/value settings, `standard_month_days`, super-admin mutations, administrative read guard; no types, categories, validation, or audit detail. |
| Audit Logs | **PARTIAL / IMPROVEMENT** | Async write middleware and dashboard preview; no durable event contract, guaranteed write, retention, export, or complete coverage. |

## Confirmed Current Risks and Blockers

1. **P0 — ESS credential risk remains.** `system_users.plain_password` is still part of the schema and login logic; migration 002 intentionally writes plaintext iqama values for some ESS users. (SEC-004 BLOCKED)
2. **P0 — Automatic migrations remain in API startup.** `app.js` calls `runMigrations()` on every API start. New migrations can change Production schema/data during deploy/restart. No release gate is defined yet. (FND-004 BLOCKED)
3. **P0 — Migration runner is not explicitly transactional per migration.** A migration can partially apply before its tracking insert or before a later statement fails. (DB-001 BLOCKED)
4. **P0 — Canonical isolated test DB not yet evidenced.** 84/84 Production regression suite exists and passes, but a disposable isolated test database and canonical runner are not yet proven. (FND-005 VERIFYING)
5. **P0 — Restore drill not yet demonstrated.** Production backup is verified, but restore/checksum has not been evidenced. (DB-003 VERIFYING)
6. **P1 — No canonical tests.** No test runner, test script, API contract suite, migration test database, or regression suite exists in the repository as a repeatable isolated command. (QA-001 BLOCKED)
7. **P1 — Payroll remains client-calculated.** `net_salary` and components are accepted from the frontend; the current calculation must be specified before server authority is introduced. (PAY-001 NOT STARTED)
8. **P1 — Payroll frontend delete and batch are separate requests.** A batch conflict cannot roll back the preceding draft-delete request.
9. **P1 — Backend and frontend contracts are compatibility-shaped, not typed.** `apiClient.js` maps Supabase names to REST endpoints and translates errors; contract drift can be silent.
10. **P1 — Audit writes are fire-and-forget.** `auditLog` does not await or surface database write failure, and not all mutation routes use it.
11. **P2 — Frontend uses dynamic script injection and HTML interpolation.** Names and other values are inserted into HTML/inline handlers, requiring a focused output-encoding review.
12. **P2 — Several modules have read routes with weaker explicit RBAC than mutation routes.** Security must remain server-side; frontend visibility is not authorization.

### Resolved risks (2026-08-27)

- ~~Runtime verification is not complete.~~ **RESOLVED.** 84/84 Production regression PASS; cross-company isolation, RBAC read enforcement, and mandatory company-scope invariant all verified in Production. (SEC-001, SEC-002, SEC-003 COMPLETE)
- ~~Production persistence/backup is not repository-verifiable.~~ **RESOLVED.** Dokploy app/database separation verified, PostgreSQL persistent volume verified, Production backup verified, Production deployment PASS at commit `1d0fa32`. (FND-003, OPS-001 COMPLETE; DB-003 VERIFYING — restore drill pending)

## Roadmap Phases and Task Registry

### PHASE 0 — FOUNDATION & PRODUCT BASELINE

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| FND-001 | P1 | Inventory completed, runtime unknown | Baseline `app.js`, routes, pages, client, schema, docs | No change | Produce canonical endpoint/ownership map | Static evidence; revert documentation only | Every current route/page is indexed with owner and contract | NOT STARTED |
| FND-002 | P1 | Compatibility layer exists | Document REST vs `window.db` contracts; `apiClient.js` | No change | Identify silent field/status/array translation | Contract snapshots; no runtime data | Each active caller maps to one documented API contract | NOT STARTED |
| FND-003 | P1 | Production evidence verified | Dokploy/app/DB/backup/recovery evidence pack | No change | Deployment safety boundary | External evidence: commit `1d0fa32`, container healthy, health 200, migrations 8/8, backup verified, Dokploy separation verified, volume verified | Volume, backup, restore, startup, rollback facts are recorded | COMPLETE |
| FND-004 | P0 | Startup migrations automatic | Define safe release gate around `app.js` startup migration behavior | No schema change in design | Prevent unreviewed Production DB changes | Staging rehearsal and rollback plan | Deploy cannot proceed without migration/backup gate | BLOCKED |
| FND-005 | P0 | 84/84 Production regression suite exists; isolated test DB not yet evidenced | Bootstrap the smallest repeatable test foundation and disposable test database | Test database only; no Production migration | Make security/data-integrity verification repeatable | Synthetic fixtures, one command, cleanup plan | A new agent can run isolated checks without improvising a harness | VERIFYING |

### PHASE 1 — SECURITY & DATA INTEGRITY

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-001 | P0 | Cross-company isolation proven in Production regression | Companies/assets/vehicles/attendance/payroll/compliance/letters/users | No change initially | Prove cross-company isolation | 84/84 Production regression PASS; attendance DELETE fix verified | Every cross-company read/write/delete is denied | COMPLETE |
| SEC-002 | P0 | RBAC read enforcement verified in Production | All route read paths and `rbac.js` | No change initially | Enforce server-side module view permissions | Settings RBAC fix and dashboard audit-log scoping deployed and verified; 84/84 regression PASS | Roles cannot read modules they lack | COMPLETE |
| SEC-003 | P0 | Mandatory company-scope invariant verified in Production | Standardize mandatory scope and orphan policy | Constraints only after design | No missing-scope global fallback | Companies validation fix deployed and verified; 84/84 regression PASS | Missing scope always denies protected tenant reads/writes | COMPLETE |
| SEC-004 | P0 | ESS may use `plain_password` | `auth.js`, user lifecycle, migration strategy | Reversible data migration required | Preserve phone + identity login UX while removing plaintext | Staged hash migration and rollback | No active ESS credential requires plaintext | BLOCKED |
| SEC-005 | P1 | Audit middleware is partial | `auditLog.js` and all mutation routes | No schema change until event needs are known | Reliable actor/company/action capture | Failure injection in staging | Required mutations produce durable auditable events | NOT STARTED |
| SEC-006 | P1 | Basic validation only | Route input validation and error conventions | No migration | Reject malformed IDs/financial/status inputs safely | API negative tests; route rollback | Invalid input returns stable 4xx, never avoidable 500 | NOT STARTED |
| SEC-007 | P1 | Nullable company ownership is inconsistent | Define orphan/null `company_id` policy per resource | Constraints only with data plan | No ambiguous tenant ownership | Data inventory then reversible repair | Every protected resource has provable owner or explicit quarantine | NOT STARTED |
| SEC-008 | P1 | Deletes include hard deletes | Payroll/assets/documents/vehicles policies | Retention migration only if approved | Protect historical records and recovery | Backup/restore rehearsal | Destructive actions require explicit policy and audit | NOT STARTED |

### PHASE 2 — ORGANIZATION STRUCTURE & EMPLOYEE 360

Organization Structure is added before Employee 360 because company/branch/department/position/reporting ownership is a prerequisite for scalable HR workflows.

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| ORG-001 | P1 | Implemented + isolated runtime verified; pending Production verification | Define departments, branches, job positions, and company hierarchy without replacing `companies` | Migration `009_org_structure.sql` (additive: 3 new tables + 3 nullable columns on employees) | Tenant boundaries and role scope enforced via `organization` RBAC module | Isolated test DB (Docker postgres:15-alpine, port 55433): 23/23 runtime tests PASS; cross-company parent rejected; self-ref cycle rejected; viewer/employee RBAC enforced; employee org links verified in GET/list | Organization tree is explicit and every employee has a valid organizational path | VERIFYING |
| ORG-002 | P2 | No reporting relationship model | Add employee manager/reporting relationships and position assignments | Additive nullable relationships first | Prevent cycles and cross-company managers | Graph validation and backfill dry run | Reporting graph is acyclic, scoped, and historically explainable | NOT STARTED |
| ORG-003 | P2 | Company transfers are implicit | Define branch/company transfer rules and effective dates | Additive history only if required | Transfer cannot bypass company authorization | State transition and rollback tests | Transfer preserves old ownership/history and updates future scope predictably | NOT STARTED |
| EMP360-001 | P1 | 360 modal exists | Unified profile contract for personal/employment data, salary, attendance, leaves, loans, payroll, documents, letters, requests, assets, vehicles, compliance, timeline, and alerts | Prefer read-model/query first | One authorized employee-centered contract | API snapshot and isolation tests | Profile loads all permitted domains without client fan-out explosion | NOT STARTED |
| EMP360-002 | P2 | Linked records shown separately | Add timeline, alerts, status/history composition | Optional history table later | Preserve field-level salary masking | Fixture regression; feature can be disabled | Employee timeline explains important events and pending risks | NOT STARTED |
| EMP360-003 | P2 | No authoritative history | Define employment/status/transfer history | Likely additive migration | Audit sensitive changes | Backfill dry run and rollback | History is append-only and does not rewrite current records | NOT STARTED |

### PHASE 3 — ESS 2.0

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| ESS-001 | P1 | ESS session is separate | Formalize employee self-service authorization matrix | No change initially | Employee can only access self | API matrix with employee fixtures | Every ESS endpoint enforces employee identity server-side | NOT STARTED |
| ESS-002 | P2 | Profile/requests/letters exist | My attendance, leave, loan, payroll, payslips, documents, letters | Additive only if missing data is proven | Stable simple employee UX | Mobile smoke and role regression | ESS navigation has complete permitted journeys | NOT STARTED |
| ESS-003 | P2 | Status is basic | Request timeline, notifications, profile-change requests | Additive workflow tables only if needed | No cross-employee disclosure | End-to-end synthetic workflow | Employee sees request state and next action clearly | NOT STARTED |

### PHASE 4 — ATTENDANCE 2.0

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| ATT-001 | P1 | Monthly manual grid | Work schedules, shifts, weekends, holidays | Additive model after policy | Preserve existing monthly API | Period fixtures and payroll regression | Schedule rules produce deterministic attendance periods | NOT STARTED |
| ATT-002 | P1 | Batch/manual updates exist | Monthly lock, correction requests, approval | Additive lock metadata if needed | Prevent post-lock mutation | Concurrent and rollback tests | Locked period cannot be silently changed | NOT STARTED |
| ATT-003 | P2 | Overtime/absence fields exist | Overtime approval, import/export, payroll handoff | No migration until import contract is known | Validate source and ownership | Import fixture and reconciliation | Attendance totals reconcile with Payroll inputs | NOT STARTED |

### PHASE 5 — LEAVES & LOANS WORKFLOW

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| WF-001 | P1 | Leave requests exist, no balance engine | Leave accrual/balance/overlap policy | Additive ledger only after policy | Prevent impossible/overlapping leave | Policy fixtures and recalculation | Balance and overlap outcomes are explainable | NOT STARTED |
| WF-002 | P1 | Single status update exists | Review → approval → processing → completed | Additive workflow metadata if necessary | Role/owner approval boundaries | State-machine tests | Invalid transitions are rejected and audited | NOT STARTED |
| WF-003 | P2 | Loan amount/paid fields exist | Eligibility, installments, outstanding balance, settlement | Prefer ledger additive model | Payroll deduction cannot exceed balance | Ledger reconciliation and rollback | Loan balance equals approved transactions minus payments | NOT STARTED |
| WF-004 | P1 | Each request path owns part of its workflow | Unified engine for leave, loan, letter, attendance correction, employee change, payroll approval, renewal, onboarding, and offboarding | Additive workflow model only after state design | Requester/reviewer/approver, rejection, cancellation, escalation, and audit trail | State-machine tests and reversible rollout | One workflow contract supports all listed domains without duplicating approval logic | NOT STARTED |

### PHASE 6 — PAYROLL 2.0

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| PAY-001 | P0 | Frontend calculates and submits totals | Specify and implement server-authoritative calculation | Additive only after formula/data audit | Protect salary/net integrity | Shadow comparison, then guarded rollout | Server result matches approved business cases before authority switch | NOT STARTED |
| PAY-002 | P1 | Draft/approved lock exists | Payroll periods, review, approval, lock lifecycle | Additive period/approval metadata only if required | Approved records immutable | State and concurrency tests | Draft → review → approval → lock is enforced server-side | VERIFYING |
| PAY-003 | P1 | Records have no history/version model | Snapshots, adjustments, correction/reversal workflow | Additive history tables | Preserve approved historical truth | Migration dry run and restore | Corrections never overwrite approved history | NOT STARTED |

### PHASE 7 — LETTERS & DOCUMENT CENTER

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| LET-001 | P1 | Hard-coded/render functions exist | Template catalog, variables, company branding | Additive templates only if needed | Escape merged values and protect salary | Golden PDF/HTML snapshots | Authorized users can generate approved template variants | NOT STARTED |
| LET-002 | P2 | Archive/reference numbers exist | Versions, issue date, issuer, history, download | Additive version metadata | No history overwrite | Snapshot and rollback | Every issued document is reproducible | NOT STARTED |
| LET-003 | P2 | No formal approval/signature | Approval and optional digital signature workflow | Additive only with provider decision | Signer authorization and audit | Provider sandbox and failure tests | Signed/approved state is verifiable | NOT STARTED |

### PHASE 8 — COMPLIANCE CENTER

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| CMP-001 | P1 | Metadata/file URL tracking exists | Secure document storage/upload abstraction | Storage metadata additive if required | Validate type, size, access, and ownership | Upload/download security tests | Files are private, retrievable, and linked to employee/company | NOT STARTED |
| CMP-002 | P2 | Expiry radar exists | 7/30/60/90-day alerts and renewal workflow | Additive notification state only if needed | Avoid duplicate or cross-tenant alerts | Clock/expiry fixtures | Owners receive actionable expiry alerts | NOT STARTED |
| CMP-003 | P3 | Quick renewal exists | Document history, bulk actions, auditor reports | Additive history only if needed | Every renewal is attributable | Regression and export checks | Compliance status is historical and reportable | NOT STARTED |

### PHASE 9 — ASSETS & VEHICLES

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| FLEET-001 | P2 | Asset assignment/return exists | Assignment history, condition, employee timeline | Additive history if needed | Ownership remains employee/company provable | Lifecycle fixture tests | Asset custody chain is complete | NOT STARTED |
| FLEET-002 | P2 | Vehicle records/documents exist | Vehicle 360, maintenance, insurance, expenses | Additive records only after need | Driver/company ownership and expiry protection | Reconciliation and rollback | Vehicle costs and document state are traceable | NOT STARTED |
| FLEET-003 | P3 | No driver/fleet history | Driver assignment, photos, GPS/trip option assessment | New data model only if approved | Privacy and role restrictions | Feature flag and opt-out | Advanced fleet features are justified, not speculative | NOT STARTED |

### PHASE 10 — DASHBOARD 2.0

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| DASH-001 | P2 | Basic KPIs/radar exist | Stable KPI contract and role-specific data sets | Prefer query/index work first | Company scope and salary masking | Contract/snapshot tests | KPI values are consistent with source modules | NOT STARTED |
| DASH-002 | P2 | Limited cards/charts | Workforce, attendance, payroll, leave, loan, compliance KPIs | Materialized view only after profiling | Role-specific least privilege | Performance and role fixtures | Each role sees only permitted metrics | NOT STARTED |
| DASH-003 | P3 | No trends/drill-down | Trends, comparisons, drill-down, customizable widgets | No schema by default | Drill-down reuses server authorization | Query plans and UX smoke | Every chart has a source, filter, and empty/error state | NOT STARTED |

### PHASE 11 — NOTIFICATION CENTER

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| NOT-001 | P1 | No unified center | Event catalog for leave/loan/letter/payroll/compliance/attendance | Additive notification model | Tenant/role/recipient correctness | Event fixture matrix | Every approved event has one documented recipient rule | NOT STARTED |
| NOT-002 | P2 | Alerts are page-local | Inbox, unread/read, history, deep links | Additive notification records | No cross-user notification access | API and UI regression | Notification state is durable and idempotent | NOT STARTED |
| NOT-003 | P3 | No delivery/retry layer | Email/SMS/in-app delivery policy and retry/outbox | Additive outbox only after provider decision | Avoid duplicate sends and secret leakage | Failure injection | Failed delivery is visible and retryable | NOT STARTED |

### PHASE 12 — REPORTS & EXPORT CENTER

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| RPT-001 | P2 | Export is page-specific | Unified report definitions/filters for all modules | No schema by default | Reapply module/company permissions | Golden CSV/PDF fixtures | Report results equal authorized list queries | NOT STARTED |
| RPT-002 | P2 | Some CSV/PDF/print UI exists | Excel/CSV/PDF export contract and formatting | No migration by default | Mask sensitive fields consistently | Snapshot and large-data tests | Exports preserve filters, totals, and locale | NOT STARTED |
| RPT-003 | P3 | No async reporting | Large report jobs and progress/download lifecycle | Additive job table only if needed | Job ownership and retention | Queue failure/rollback | Large reports do not block API requests | NOT STARTED |

### PHASE 13 — UX/UI PROFESSIONALIZATION

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| UX-001 | P2 | Shared shell exists but pages vary | Document and incrementally unify navigation, tables, forms, modals | No change | Preserve role guards | Visual regression and rollback per page | UI primitives are consistent without rewriting modules | NOT STARTED |
| UX-002 | P3 | Error/loading/empty states vary | Standardize feedback, confirmation, validation, retry states | No change | Never expose raw secrets/SQL | Browser smoke tests | Every primary workflow has loading, empty, error, success states | NOT STARTED |
| UX-003 | P4 | RTL/responsive base exists | Accessibility, mobile, typography, spacing, keyboard support | No change | Preserve accessible permission behavior | WCAG smoke and visual snapshots | Critical pages meet agreed accessibility baseline | NOT STARTED |

### PHASE 14 — PERFORMANCE

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| PERF-001 | P1 | Query plans not documented | Profile dashboard/module queries and add only proven indexes | Index migrations only with explain evidence | No query broadening | Isolated EXPLAIN/load fixtures | P95 targets and query plans are documented | NOT STARTED |
| PERF-002 | P2 | N+1 and frontend fan-out exist | Reduce N+1, enforce pagination, eliminate unbounded reads | Prefer query changes; additive indexes if proven | Preserve scope in optimized queries | Before/after contract/perf tests | Same authorized data with bounded requests | NOT STARTED |
| PERF-003 | P2 | Pool/response observability limited | Pool metrics, compression/cache policy, connection budgets | No migration | Prevent stale sensitive responses | Load and failure tests | Resource limits and latency thresholds are observable | NOT STARTED |

### PHASE 15 — RELIABILITY & ERROR HANDLING

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| REL-001 | P1 | Central error middleware exists | Safe error taxonomy, correlation/request IDs, structured logs | No migration by default | No SQL/secrets in responses/logs | Failure injection and log review | Client errors are stable; operators get correlation IDs | NOT STARTED |
| REL-002 | P1 | Health exists; readiness is basic | Graceful shutdown, DB readiness, dependency health | No migration | Deploy only ready instances | Container lifecycle tests | Restart/deploy does not drop in-flight work unexpectedly | NOT STARTED |
| REL-003 | P2 | Retry/circuit policy absent | Retry only safe operations; handle DB/API dependency failures | No change | No duplicate financial mutations | Chaos/failure tests | Retries are bounded, idempotent, and observable | NOT STARTED |

### PHASE 16 — DATABASE & MIGRATION ENGINEERING

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| DB-001 | P0 | Runner has no explicit transaction per migration | Design transactional migration execution and failure recovery | Migration runner change only after design | Prevent partial schema/data changes | Staging failure rehearsal; preserve tracking | Failed migration cannot be falsely marked applied | BLOCKED |
| DB-002 | P1 | Schema/migrations can drift | Schema inventory, FK/index/nullable policy, drift report | Additive/reversible only | Enforce ownership where proven safe | Schema diff in isolated DB | Production schema has a documented expected version | NOT STARTED |
| DB-003 | P0 | Backup verified; restore drill not yet demonstrated | Backup schedule, retention, restore drill, RPO/RTO | No migration | Recovery is a security/data-integrity control | Production backup verified; isolated restore and checksum pending | Restore is demonstrated before risky DB change | VERIFYING |

### PHASE 17 — TESTING & QUALITY

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| QA-001 | P0 | No canonical test suite | Staging test DB, fixtures, runner, test conventions | Test DB only; no Production migration | Zero Production test data | Disposable DB and cleanup plan | One repeatable command runs isolated tests | BLOCKED |
| QA-002 | P1 | No API/RBAC regression suite | Auth, ownership, RBAC, contract, validation tests | Synthetic fixtures only | Prove deny/no-write invariants | API tests and DB assertions | Critical security matrix is automated | NOT STARTED |
| QA-003 | P1 | No domain regression suite | Payroll, attendance, leaves, loans, letters, documents, frontend smoke | Synthetic data only | Preserve calculations and history | Golden fixtures and rollback | Core workflows have regression coverage | NOT STARTED |

### PHASE 18 — PRODUCTION / DEVOPS

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| OPS-001 | P0 | Dokploy separation verified in Production | Prove Gpack-HR/HR-Postgres separation, volume, backup, rollback | No DB change | Never deploy app into unknown DB boundary | Dokploy app/database separation verified; PostgreSQL persistent volume verified; commit `1d0fa32` | Production deploy path is documented and reversible | COMPLETE |
| OPS-002 | P1 | Docker config is partly local-oriented | Separate staging/production env, secrets, ports, health/readiness | No migration | No default credentials/secrets | Deploy rehearsal with redacted config | Production has explicit non-default environment | NOT STARTED |
| OPS-003 | P2 | No canonical rollback checklist | GitHub/Dokploy deploy verification, image/version pinning, rollback | No migration | Protect data during deploy | Staging rehearsal | Operator can deploy/rollback without source improvisation | NOT STARTED |

### PHASE 19 — ADVANCED HR FEATURES

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| LIFE-001 | P1 | Employee status exists; lifecycle history does not | Define onboarding, probation, active, leave, termination, and offboarding states | Additive lifecycle/history model after policy | Protect employment history and access transitions | State-machine and rollback tests | Every lifecycle transition has actor, reason, effective date, and audit evidence | NOT STARTED |
| LIFE-002 | P2 | Transfers/promotions/contracts are not formal workflows | Contract lifecycle, transfers, promotions, probation outcomes, and effective-dated compensation changes | Additive history only when required | Prevent unauthorized company/role/salary changes | Backfill dry run and transition tests | Future changes do not overwrite historical employment facts | NOT STARTED |
| LIFE-003 | P2 | No onboarding/offboarding orchestration | Connect lifecycle checklists to the unified workflow engine | Additive tasks only after workflow design | Least-privilege task ownership and data retention | Synthetic lifecycle fixtures | Onboarding/offboarding is trackable, resumable, and auditable | NOT STARTED |
| ADV-001 | P3 | No formal onboarding/offboarding | Employee lifecycle checklists and tasks | Additive only after workflow design | Least-privilege task ownership | Workflow fixtures | Lifecycle transitions are auditable and reversible where possible | NOT STARTED |
| ADV-002 | P3 | No contracts/probation/promotion workflow | Contract management, probation, promotions, transfers | Additive history model if needed | Protect salary/employment history | State and history tests | Changes preserve historical effective dates | NOT STARTED |
| ADV-003 | P4 | Org structure/announcements absent | Departments, branches, announcements, internal HR tasks only if justified | New schema only with business case | Scope and notification rules | Product validation before build | Feature has approved business owner and measurable value | NOT STARTED |

### PHASE 20 — FINAL ENTERPRISE HARDENING

| ID | Priority | Current | Scope / files | DB / migration | Security / API / UI | Verification / rollback | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| FINAL-001 | P2 | Audit has not been repeated after all phases | Full security/data/performance/UX audit | No change by default | Confirm no regressions | Complete isolated regression | All P0/P1 findings closed or explicitly accepted | NOT STARTED |
| FINAL-002 | P3 | Release evidence is fragmented | Accessibility, performance, DR, rollback, production smoke checklist | No migration | Release gate includes backup proof | Signed release evidence | Release checklist is complete and reproducible | NOT STARTED |
| FINAL-003 | P4 | Documentation is distributed | Operator/developer/user documentation and decision log | No change | Avoid unsafe tribal knowledge | Documentation review | New agent can operate project from repository docs | NOT STARTED |

## Top 10 Tasks by Priority

1. **SEC-004 — Remove ESS plaintext credential dependency** — preserve phone + identity login while securing storage. (BLOCKED)
2. **PAY-001 — Server-authoritative Payroll calculation** — protect salary/net integrity after formula specification. (NOT STARTED)
3. **DB-001 — Transaction-safe migration runner** — prevent partial migration state. (BLOCKED)
4. **FND-004 — Startup migration release gate** — keep automatic migration behavior while requiring review/backup safety. (BLOCKED)
5. **FND-005 — Canonical isolated test foundation** — make security and payroll verification repeatable in isolation. (VERIFYING)
6. **DB-003 — Backup and restore proof** — demonstrate restore drill before risky DB changes. (VERIFYING)
7. **QA-001 — Canonical isolated test suite** — establish repeatable isolated test command and disposable test DB. (BLOCKED)
8. **SEC-005 — Audit middleware reliability** — ensure durable auditable events for all mutations. (NOT STARTED)
9. **SEC-006 — Route input validation** — reject malformed IDs/financial/status inputs safely. (NOT STARTED)
10. **SEC-007 — Orphan/null company ownership policy** — define and repair ambiguous tenant ownership. (NOT STARTED)

## Dependency Order

```text
FND-001/FND-002
  ↓
FND-003/FND-004 + OPS-001 + DB-003
  ↓
FND-005 + SEC-001/SEC-002/SEC-003/SEC-004
  ↓
QA-001/QA-002 + DB-001/DB-002
  ↓
ORG-001/ORG-002/ORG-003
  ↓
ATT-001/ATT-002 + WF-001/WF-002/WF-004
  ↓
PAY-001/PAY-002/PAY-003
  ↓
ESS-001/ESS-002 + EMP360-001/EMP360-002 + DASH-001
  ↓
Letters, compliance, assets, fleet, notifications, reports
  ↓
UX, performance, reliability, production release gates
  ↓
LIFE-001/LIFE-002/LIFE-003 + approved advanced HR work
  ↓
FINAL-001/FINAL-002/FINAL-003
```

## Definition of Done Checklist

Use this checklist for every task; do not mark `COMPLETE` from code review alone:

```text
- [ ] ID and scope approved
- [ ] Current behavior documented
- [ ] Design and API compatibility reviewed
- [ ] Security/ownership impact reviewed
- [ ] Database/migration decision recorded
- [ ] Implementation completed in minimal scope
- [ ] Static checks pass
- [ ] Isolated runtime verification passes
- [ ] Regression checks pass
- [ ] Production verification completed when applicable
- [ ] Rollback path documented/tested
- [ ] Documentation updated
- [ ] Task marked COMPLETE
```

## Production Release Gate

Do not push/deploy a release that changes application/database behavior until all applicable items are true:

```text
- [ ] Git diff contains only approved task files
- [ ] No uncommitted user changes are overwritten
- [ ] Static checks pass
- [ ] Staging database is isolated and disposable
- [ ] Synthetic security/RBAC/company fixtures pass
- [ ] Payroll draft/approved/rollback tests pass
- [ ] Migration plan and current schema version are known
- [ ] Backup completed and restore verified
- [ ] Dokploy app/database separation is evidenced
- [ ] Startup command and migration behavior are explicitly approved
- [ ] Rollback version and operator steps are ready
- [ ] Production smoke checklist is ready
```

## Master Decision Log

- Existing modules will be improved before any replacement module is created.
- Global Settings remain global; no `company_id` is added without a separate business/schema decision.
- Employee login remains `Phone Number + Identity/Iqama Number`; only credential storage is targeted for hardening.
- Existing API URLs and response shapes are preserved by default.
- No migration is created merely for code cleanliness.
- Runtime and Production facts marked `UNKNOWN` remain blockers until verified.
- The repository currently contains no canonical test runner; isolated runtime verification must not use Production data.
- 2026-08-27: Production deployment verified at commit `1d0fa32`. Container healthy, health 200, migrations 8/8 applied, backup verified, Dokploy separation verified, PostgreSQL volume verified. Final Production Regression 84/84 PASS. SEC-001/SEC-002/SEC-003 marked COMPLETE. FND-003 and OPS-001 marked COMPLETE. DB-003 moved to VERIFYING (backup verified, restore drill pending). FND-005 moved to VERIFYING (84/84 regression suite exists, isolated test DB pending).
- 2026-08-27: ORG-001 implemented. Migration `009_org_structure.sql` (additive: `branches`, `departments`, `job_positions` tables + `branch_id`, `department_id`, `job_position_id` nullable columns on `employees`). Backend route `/api/organization` with branches/departments/job-positions CRUD + tree endpoint. RBAC `organization` module added to all roles. Frontend page `pages/organization.html` with 3 tabs. Employee GET/POST/PUT extended with org fields. Isolated runtime: 23/23 tests PASS on Docker postgres:15-alpine (port 55433). Cross-company parent rejected, self-ref cycle rejected, viewer/employee RBAC enforced, soft-delete verified. Status: VERIFYING (pending Production deploy + verification). Files: `server/migrations/009_org_structure.sql`, `server/schema.sql`, `server/src/routes/organization.js`, `server/src/app.js`, `server/src/middleware/rbac.js`, `server/src/middleware/auditLog.js`, `server/src/routes/employees.js`, `pages/organization.html`, `index.html`, `assets/js/app.js`.

## Enterprise Product Completion Checklist

Gpack-HR is considered **Enterprise HRMS Complete** only when every applicable item below is evidenced, not merely implemented:

### Security and Access

- [ ] Authentication is secure for admin and ESS users, with the phone + identity login rule preserved.
- [ ] No active credential depends on plaintext storage.
- [ ] Server-side RBAC and resource ownership are enforced on every read and mutation path.
- [ ] Company/tenant boundaries, orphan policy, sensitive fields, file access, and output encoding are verified.
- [ ] Rate limits, secrets, session/token behavior, and audit integrity have approved policies.

### HR Core and Organization

- [ ] Companies, branches, departments, positions, hierarchy, and reporting relationships are explicit and scoped.
- [ ] Employee records, status, employment history, contracts, probation, transfers, promotions, onboarding, and offboarding are traceable.
- [ ] Employee 360 unifies profile, salary, attendance, leaves, loans, payroll, documents, letters, requests, assets, vehicles, compliance, alerts, and activity timeline.

### Attendance, Workflow, and Payroll

- [ ] Attendance supports schedules, shifts, holidays, corrections, overtime, locking, approvals, import/export, and Payroll integration.
- [ ] One workflow engine supports leave, loan, letter, attendance correction, employee changes, payroll approval, renewals, onboarding, and offboarding.
- [ ] Workflows support requester, reviewer, approver, rejection, cancellation, escalation, and audit trail.
- [ ] Payroll calculation is server-authoritative and reproducible from effective-dated inputs.
- [ ] Payroll supports salary history, allowances, deductions, overtime, bonuses, commissions, benefits, loans, penalties, absence deductions, adjustments, periods, review, approval, lock, snapshots, corrections, and reversals.
- [ ] Payslips, WPS/export requirements, payroll reports, and approved-record protection are verified.

### ESS and Documents

- [ ] ESS provides secure My Profile, Attendance, Leave, Loans, Payroll, Payslips, Documents, Letters, Requests, notifications, and request timelines.
- [ ] Letters use approved templates, variable merge, branding, reference numbers, issuer/date, history, PDF/print/download, and controlled employee access.
- [ ] Compliance uses private storage, upload validation, authorized access, expiry alerts, renewal workflow, document history, bulk actions, and auditability.

### Assets, Fleet, and Insights

- [ ] Assets have assignment, return, damage/lost lifecycle, history, condition, and optional depreciation/maintenance.
- [ ] Vehicles have Vehicle 360, driver assignment, documents, insurance, maintenance, expenses, alerts, and history where justified.
- [ ] Dashboard provides role/company-scoped workforce, attendance, payroll, leave, loan, compliance, trends, comparisons, and drill-downs.
- [ ] Notifications provide in-app history, unread/read state, deep links, event rules, retry/outbox where needed, and correct recipients.
- [ ] Reports cover HR, employees, attendance, payroll, leaves, loans, compliance, assets, vehicles, requests, letters, and audit with scoped CSV/Excel/PDF export.

### UX, Performance, Reliability, and Quality

- [ ] Shared design system covers navigation, tables, forms, modals, states, confirmations, RTL, responsive/mobile, and accessibility.
- [ ] Query plans, indexes, pagination, N+1 behavior, pool limits, and response performance meet documented targets.
- [ ] Request IDs, structured logs, safe errors, graceful shutdown, readiness, dependency health, retries, and idempotency are operational.
- [ ] Canonical isolated test runner, test database, synthetic fixtures, API/RBAC/security, domain, migration, and frontend regression tests are repeatable.

### Deployment, Recovery, and Documentation

- [ ] Dokploy app/database separation, environment isolation, secrets, volumes, backups, restore, health checks, rollback, and deployment verification are evidenced.
- [ ] Migrations are reviewed, tracked, safe for existing data, and recoverable on failure.
- [ ] Production smoke and rollback procedures are rehearsed without Production test writes.
- [ ] Architecture, API contracts, runbooks, decision log, user guidance, and release evidence are current.

## Master Progress Rules

1. Work on one task or a small dependency-safe group; do not open unrelated implementation work.
2. A task may start only after its dependencies are `COMPLETE` or explicitly waived by the project owner.
3. Independent documentation, static analysis, query profiling, and design tasks may run in parallel when they do not touch the same files/data.
4. Implementation follows:

   ```text
   Current behavior → Design approval → Minimal change → Static checks
   → Isolated runtime verification → Regression → Production verification
   → Rollback evidence → Documentation → COMPLETE
   ```

5. Never overwrite uncommitted user changes; review `git status` and `git diff` before every implementation.
6. Never use Production data for tests. Any runtime test requires a disposable, isolated database and synthetic fixtures.
7. Never create a migration unless the data model requires it and the migration has a backup, rollback, compatibility, and verification plan.
8. Preserve existing URLs, request/response shapes, workflows, and business rules by default.
9. A failed or unknown check blocks closure; `UNKNOWN` cannot be promoted to `PASS` by assumption.
10. Security/data-integrity blockers outrank visual or convenience improvements.
11. Update this file when scope, status, dependency, API contract, migration impact, or acceptance criteria changes.
12. Only the task owner may mark a task `COMPLETE` after the full Definition of Done checklist is satisfied.

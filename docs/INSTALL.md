# Installing and running Groundsill

## 1. Prerequisites

| Requirement | Version | Why |
|---|---|---|
| Go | ≥ 1.24 | builds the server |
| git | ≥ 2.38 | the storage engine: the server drives git plumbing as subprocesses |
| PostgreSQL | ≥ 14 (16 recommended) | the projection database; the `ltree` extension must be installable (it ships with `postgresql-contrib`) |
| Node.js + npm | ≥ 20 | builds the web client (not needed for API-only use) |

```sh
go version && git --version && psql --version && node --version
```

## 2. Database

Create a database. The server creates the extension and all tables on first start, so the
connecting role needs `CREATE` on the database (or create the extension once as a superuser:
`CREATE EXTENSION ltree;`).

```sh
createdb groundsill
```

The database is disposable: everything in it is rebuilt from Git by `POST /api/repository/reindex`
or automatically when the stored revision no longer matches the repository.

## 3. Build

```sh
git clone https://github.com/thomdehoog/origoa-foundation-for-lutz.git groundsill
cd groundsill
make build            # builds web/dist (npm install + typecheck + bundle) and bin/groundsilld
```

API-only build without Node:

```sh
go build -o bin/groundsilld ./cmd/groundsilld
```

## 4. Run

```sh
./bin/groundsilld -repo data/groundsill.git -addr 127.0.0.1:8080 -web web/dist \
  -db "postgres://user:password@localhost:5432/groundsill?sslmode=disable"
```

| Flag / env | Default | Meaning |
|---|---|---|
| `-repo` / `GROUNDSILL_REPO` | `data/groundsill.git` | path of the **bare** Git repository; created if missing. This is your data. |
| `-branch` / `GROUNDSILL_BRANCH` | `main` | the branch the Foundation owns |
| `-db` / `GROUNDSILL_DB` | *(required)* | PostgreSQL connection string |
| `-addr` / `GROUNDSILL_ADDR` | `127.0.0.1:8080` | listen address |
| `-web` / `GROUNDSILL_WEB` | `web/dist` | directory with the built client; `""` for API only |
| `-watch` | `3s` | how often to check for direct Git pushes and resynchronize |

Check it is alive:

```sh
curl -s http://127.0.0.1:8080/api/repository
```

Populate a demo domain and open <http://127.0.0.1:8080>:

```sh
./examples/seed.sh http://127.0.0.1:8080
```

## 5. Define your own domain

Groundsill has no built-in types. A domain is a set of schema and workflow files, stored through the
API (each store is one commit) or committed directly into the repository.

**A workflow** — a state machine that artifact types can reference:

```sh
curl -X PUT http://127.0.0.1:8080/api/workflows/dev -H 'Content-Type: application/json' -d '{
  "id": "dev", "initial": "open",
  "states": ["open", {"id": "review", "name": "In review"}, "done"],
  "transitions": [
    {"id": "submit",  "name": "Submit for review", "from": "open",   "to": "review"},
    {"id": "approve", "from": "review", "to": "done"},
    {"id": "rework",  "from": "review", "to": "open"}
  ]}'
```

**An entry type** — fields, HID generation, workflow assignment, presentation:

```sh
curl -X PUT http://127.0.0.1:8080/api/schemas/requirement -H 'Content-Type: application/json' -d '{
  "type": "requirement", "displayName": "Requirement",
  "hid": {"prefix": "REQ"}, "workflows": ["dev"],
  "fields": [
    {"id": "priority",  "name": "Priority",  "type": "enum", "required": true,
     "options": [{"value": "low"}, {"value": "medium"}, {"value": "high"}]},
    {"id": "rationale", "name": "Rationale", "type": "multiline"},
    {"id": "due",       "name": "Due",       "type": "date"}
  ],
  "presentation": {"columns": ["priority", "due"]}}'
```

Field types: `hid`, `boolean`, `integer`, `float`, `currency`, `date`, `time`, `datetime`, `text`,
`multiline`, `richtext`, `enum` (single or `"multiple": true`, optionally `"extendable": true`),
`hyperlink`, `reference`, `references`, `attachment`, `json`, `workflow`.

**A link type** — endpoint rules and cardinality:

```sh
curl -X PUT http://127.0.0.1:8080/api/schemas/verifies -H 'Content-Type: application/json' -d '{
  "type": "verifies", "kind": "link",
  "sourceTypes": ["testcase"], "targetTypes": ["requirement"], "cardinality": "many-to-many"}'
```

**Scoped refinement** — add `?scope=some/folder` to define or refine a type for a subtree only.
Schemas compose from the root down: `specs/safety` can add an `asil` field to `requirement`
without touching the root definition; `"inheritance": "off"` in a scoped schema ignores everything
defined above it.

**A document type** — `{"type": "spec", "kind": "document", ...}`; documents carry `content`, a tree
of blocks: `section` (title, children), `paragraph` (text), `entry` (guid), `list` (items), `code`,
`image` (src = attachment name or URL).

Create an entry:

```sh
curl -X POST http://127.0.0.1:8080/api/entries -H 'Content-Type: application/json' -d '{
  "path": "specs/boot", "type": "requirement", "title": "System boots in under 2 seconds",
  "fields": {"priority": "high"}}'
```

The response carries the permanent `guid`, the generated HID (`REQ-1`), the initial workflow state
and an `ETag`. Every write is a Git commit:

```sh
git --git-dir=data/groundsill.git log --oneline
```

## 6. Direct Git access

The repository is an ordinary bare repository. Clone it, edit files, push: the server picks up the
new head within `-watch` seconds (and on the next API call), replays the commits into the
projection, tolerates malformed files (they are reported by `GET /api/repository/validate`), and
can always be rebuilt with `POST /api/repository/reindex`. Metadata scattered by manual
restructuring is restored with `POST /api/repository/maintenance/relocate-metadata`.

## 7. Deployment notes

- **Authentication and TLS are not included** (outside the MVP scope of the design guide). Put an
  authenticating reverse proxy in front; do not expose the port directly.
- **Back up the bare repository**: `git clone --mirror data/groundsill.git` is a complete backup. The
  database is derived.
- **Several server processes** may share one repository and one database; writes are protected by
  the Git compare-and-swap and the database `processed_hash` CAS, and maintenance mode is
  advertised through the database.
- A minimal systemd unit:

  ```ini
  [Unit]
  Description=Groundsill
  After=network.target postgresql.service

  [Service]
  ExecStart=/opt/groundsill/bin/groundsilld -repo /var/lib/groundsill/groundsill.git -addr 127.0.0.1:8080 \
    -web /opt/groundsill/web/dist -db postgres://groundsill:secret@localhost/groundsill?sslmode=disable
  Restart=on-failure
  User=groundsill

  [Install]
  WantedBy=multi-user.target
  ```

## Troubleshooting

- **`-db (or GROUNDSILL_DB) is required`** — the projection database is mandatory; see §2.
- **`projection schema: ... ltree`** — the `ltree` extension could not be created: install
  `postgresql-contrib` or create the extension as a superuser once.
- **HTTP 503 with `Retry-After`** — maintenance mode (a reindex or a large folder move is running;
  `GET /api/repository` shows the phase and progress) or the database is unreachable. Reads fail
  closed on purpose: a fabricated empty answer could, for example, let a duplicate HID through.
- **HTTP 412** — your `If-Match` ETag is stale; someone changed the artifact. Re-read and merge.
- **HTTP 409** — duplicate HID, cardinality violation, or too much write contention (retry).
- **The client shows "syncing…"** — a direct push landed; the server replays it within seconds.

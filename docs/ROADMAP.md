# What is still missing

An honest assessment of the gaps in Groundsill as of the production pass, ranked by how much each
one would block a real deployment. Items within a group are in suggested order of attack.

## 1. Blocking for production use

- **Authentication and authorization.** There is none. Anyone who reaches the port can read and
  rewrite everything, and the commit author is whatever name the browser sends. A reverse proxy
  with OIDC provides identity quickly; per-folder permissions, and recording the verified identity
  in commits, have to live in the Foundation. This is the biggest gap by far.
- **Operational visibility.** Logs and a health probe exist, but there are no metrics (request
  latency, write queue depth, reindex duration, sync lag) and no structured logging. Saturation of
  the write mutex is invisible until users notice.
- **Schema editing in the client.** Schemas and workflows are JSON files managed through the API
  or Git. Fine for developers, a wall for everyone else. A schema editor with a preview of which
  existing artifacts a change would invalidate is the single most valuable feature still missing.

## 2. Will hurt as the repository grows

- **Write throughput.** Commits are serialized, roughly ten per second per process. A batch
  endpoint that commits many artifacts in one transaction is the fix; the transaction already
  supports multi-file changesets.
- **Reindex time.** A full rebuild walks the entire history. On a repository with years of commits
  this takes minutes, and writes are refused meanwhile. Incremental history indexing removes the
  cliff.
- **Attachments in Git.** Binaries bloat the repository forever. Either Git LFS or an object store
  with the content hash committed.
- **Presence is per process.** With two servers, users only see collaborators on their own server.
  A PostgreSQL LISTEN/NOTIFY fan-out fixes it cheaply.

## 3. Product features a requirements or PLM team will ask for early

- **Baselines.** Tagging a commit as a named release and diffing two baselines is standard in this
  domain, and Git makes it almost free to add.
- **Import and export.** CSV or ReqIF import, and document export to PDF or DOCX.
- **Bulk operations.** Multi-select in the overview with bulk transition, move and delete.
- **Rich text.** Content is plain text blocks. Inline formatting and tables are expected.
- **Saved views and notifications.** Persisted filters, and webhooks or email when a watched
  artifact changes.

## 4. Engineering hygiene

- An OpenAPI description of the REST API, so clients other than the bundled one can be generated.
- Load and soak tests. The suites prove correctness, not behaviour at ten thousand artifacts and
  fifty concurrent users.
- Tagged releases and a changelog.

## Authentication: the proposed design

Identity comes from an existing provider; the server never becomes one.

- **Built-in OIDC as the primary mode.** The OpenID Connect authorization-code flow with PKCE
  against whatever the team already runs (Entra, Google, Keycloak, Okta), using `coreos/go-oidc`
  for discovery and token validation. The result is an encrypted, HttpOnly, SameSite session
  cookie, which keeps the single-binary deployment. A `-auth proxy` mode trusts identity headers
  from a listed proxy address only, for teams that already run oauth2-proxy or Authelia. A
  `-auth none` mode keeps today's behaviour for local development and is never the default.
- **Personal access tokens** for scripts, CI and the seed script: generated in the client, stored
  as a hash in PostgreSQL rather than in Git, sent as a bearer header, scoped to a role and an
  expiry.
- **The identity reaches Git.** The Foundation sets the author name and email of every commit
  from the verified principal and refuses a client-supplied author; the presence hub uses the same
  name. That is what turns the history into an audit trail.
- **Authorization as configuration.** An `access.json` in a folder's `.groundsill` directory,
  inherited down the tree with nearest-wins exactly like schemas and workflows. Four roles:
  reader (artifacts and history), editor (create, update, transition, comment, attach),
  maintainer (schemas, workflows, folder moves, deletes) and admin (reindex, relocate metadata,
  tokens, access). Grants name users or identity-provider groups, so membership is maintained
  once. The root access file is bootstrapped from an `-admin` flag on first start.
- **Enforcement in the Foundation**, not the HTTP layer, with the principal carried in the
  request context, so the WebSocket and any future transport inherit the rules. Reads are
  filtered by permitted scopes through the existing `ltree` hierarchy: one prefix filter on the
  allowed paths, resolved once per request.
- **Two consequences to document.** Direct access to the bare repository is admin access, so
  only the service account may reach it and mirrors need hooks on the hosting side. Cookies bring
  CSRF into scope: SameSite=Lax plus a required custom header on every state-changing request
  closes it.

Order of work:

1. Proxy-header mode, verified commit authors, and a single all-or-nothing role. About a day,
   and it makes the system deployable behind what most teams already run.
2. Built-in OIDC and personal access tokens.
3. Folder-scoped roles with filtered reads, plus Foundation and browser tests for every role
   boundary.

## Suggested order

Authentication first, then metrics, then the schema editor. Those three turn a working system into
one that can be handed to a team.

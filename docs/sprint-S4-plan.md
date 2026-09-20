# Sprint S4 — Detailed Implementation Plan

**Status:** Complete ✅ — implemented, verified, deployed, and released
**Sprint:** S4
**Created:** 2026-09-20
**Last updated:** 2026-09-20 — S4-1..S4-6 implemented; local and live gates passed; production active
**Repository:** `Gavinsb/obsidian-vault-site`
**Baseline:** `master` after S3 (`3254cda`) plus sprint-history documentation
**Source of truth:** the Obsidian vault remains authoritative; application data stays outside the vault

This document is the implementation contract and recovery guide for Sprint S4. If an agent stops or fails, the next agent should read this file, `docs/sprints.md`, the current source, and `git status` before resuming. Do not infer completed work from this plan: verify code, tests, the deployed service, and Git history.

---

## Execution log

- **2026-09-20 — Build authorized.** Gav explicitly said `start build` and asked that this plan remain current.
- **2026-09-20 — Baseline passed.** `npm run lint`; 52/52 tests; production build; QA 25/25. Starting Git state: `master` at `d41dd00`, with only S4 planning documentation uncommitted. `kv-microsite.service` active.
- **2026-09-20 — Phase A passed.** Added and tested pure agent-block parsing/masking, autocomplete trigger/insertion, deterministic tag sorting/colour, ETag parsing, and authoritative `updated` injection. Work used only repository fixtures and temporary directories.
- **2026-09-20 — Phase B passed.** Added AES-256-GCM atomic file auth store under `dataDir`, bcrypt password hashing, stateful signed cookie sessions, login throttling, Origin checks, admin lifecycle APIs/last-admin guards, mutation authorization, path redaction, and login/admin UI.
- **2026-09-20 — Phase C passed.** Added authenticated raw source projection with strong ETag, `If-Match` enforcement (`428`/`412`), per-path serialization and final hash recheck before rename, server-owned UTC `updated`, manual-save editor, dirty/cancel/unload protection, and conflict-preserving UI.
- **2026-09-20 — Phases D/E passed.** Added raw-textarea wikilink/tag autocomplete, responsive deterministic tag cloud plus sortable directory, server-side agent masking from public projections/derived indexes, and draft-only review Accept/Reject. No model/network execution was added.
- **2026-09-20 — Local verification passed.** `npm run lint`; Vitest 89/89 across 14 files; production build (1607 modules); fixture QA 27/27; `git diff --check`. Final independent review blocked raw Markdown through `/api/raw/*` so it cannot bypass public agent masking, verified authenticated reindex JSON handling, removed absolute vault paths from startup/API error logs, corrected path-lock cleanup, hid create/reindex controls from unauthorized users, and prevented duplicate saves or saves during unresolved conflicts; all gates passed again afterward. Security inspection found no auth ciphertext, `.env`, SQLite/database, vault path exposure, or model-execution integration in changed source. Production audit retains two moderate React Router advisories requiring a major-version migration; the unused vulnerable `diff` dependency was removed. No real vault, service, deployment, commit, or push was touched at this checkpoint.
- **2026-09-20 — Production deployment passed.** Generated independent auth encryption/session secrets into `~/.config/kv-microsite/env` at mode `0600`; the one-time bootstrap password was entered through a masked trusted-terminal prompt and was never persisted. The encrypted `data/auth.enc` store was created at mode `0600`, is ignored by Git, and no auth/session/backup artifact exists in the vault. `kv-microsite.service` is active and enabled, user lingering is enabled, and the current HTTPS quick-tunnel origin is configured through `KV_PUBLIC_ORIGIN`; the tunnel URL rotates when cloudflared restarts and the origin must be refreshed with it.
- **2026-09-20 — Live acceptance passed.** Local and external HTTPS home/session endpoints returned `200`; public overview/config responses exposed no absolute path; a public note exposed no agent/review block; anonymous source access and save returned `401`. Headless Chrome verified the public home/sign-in state, absence of public edit controls, tag cloud, sortable directory, and zero severe console errors. A masked HTTPS verifier confirmed admin login, a `Secure` session cookie, admin authorization, protected source read with ETag, logout, and no real-vault mutation.

---

## 1. Approved scope and decisions

S4 contains six items:

| ID | Requirement | Approved decision |
|---|---|---|
| **S4-1** | Stop edit auto-save; save only when the user clicks **Save**; update changed date on save | Manual save only. Server owns the frontmatter `updated` value. |
| **S4-2** | Redesign tag cloud from supplied references; add right-side tag/count list sortable by count or alphabetically | Keep the visual cloud and existing note-selection behavior; add a deterministic, responsive list panel. |
| **S4-3** | Authenticated editing and access control | Public reads remain open. All mutations require login. Use encrypted **file-based storage only**—no SQLite and no external IdP. |
| **S4-4** | Atomic metadata management and optimistic concurrency | Use HTTP `ETag`/`If-Match`; reject stale saves with `412 Precondition Failed`; preserve atomic filesystem writes and server-authoritative UTC metadata. |
| **S4-5** | Live vault autocomplete for wikilinks and tags | Keep the raw Markdown textarea. Add `[[wikilink]]` and `#tag` autocomplete. **No ProseMirror/WYSIWYG in S4.** |
| **S4-6** | Embedded agent instructions and review staging | The microsite supports editing, syntax, public masking, and review staging only. OpenClaw performs AI work externally. The site must not call a model or execute prompts. |

### Non-negotiable constraints

1. Do not modify the vault as a migration step. Only explicit user saves or approved review actions may change vault files.
2. Never store auth files, indexes, backups, sessions, or app state inside the vault.
3. Never expose passwords, encryption keys, session secrets, raw agent prompts, or local filesystem paths in responses or logs.
4. Never silently overwrite an externally changed note.
5. Preserve path-traversal protection, sanitized Markdown rendering, atomic writes, backups, and external-file watching.
6. Preserve complex Obsidian Markdown byte-for-byte while editing unless the user explicitly changes it.
7. Public readers must never receive `[!agent]` or `[!agent-review]` source, even if they inspect API responses rather than rendered HTML.
8. All six items must pass the verification gate before deployment and Git push.

---

## 2. Current implementation baseline

The build agent must inspect current files rather than assuming the baseline is unchanged. At planning time:

- `src/client/components/DocView.tsx`
  - stores `draft`, `baseHash`, conflict state, and a 1200 ms `debounceAutoSave` timer;
  - polls the current document every four seconds;
  - exposes Save/Cancel and conflict reload/overwrite controls;
  - uses `meta.contentHash` as the edit baseline.
- `src/client/api.ts`
  - `getDoc()` returns JSON only;
  - `saveDoc()` sends `{ content, expectedHash }`;
  - treats `409` as a conflict.
- `src/server/api.ts`
  - has public read and mutation routes with no auth middleware;
  - saves with body `expectedHash` and returns `409` on conflict;
  - rating and metadata routes perform server-side read/modify/write;
  - `/api/config` currently exposes `vaultPath`, which must not remain public after auth is added.
- `src/server/obsidian-filesystem-provider.ts`
  - verifies SHA-256 before writes;
  - writes a temporary file, `fsync`s, then atomically renames;
  - already detects ordinary external modifications.
- `src/shared/frontmatter.ts`
  - can replace one top-level scalar while preserving unrelated frontmatter bytes.
- `src/client/components/TagsView.tsx`
  - renders a deterministic pseudo-random absolute-position cloud;
  - has no tag list or sort control;
  - selects a tag and displays matching notes.
- `src/client/components/Markdown.tsx`
  - strips frontmatter, transforms callouts/wikilinks/images, passes through `marked`, and sanitizes with DOMPurify;
  - currently would render agent callouts unless masking is added before public delivery.
- Existing tests cover 52 cases plus a 25-check QA script at the S3 baseline. Recount at build time; do not hard-code these as the final totals.

### Important overlap

S4-1 and S4-4 overlap deliberately. The Save button triggers the write, while S4-4’s server save pipeline injects the authoritative `updated` field. Do not implement separate client-side and server-side timestamp systems.

---

## 3. Target architecture

### 3.1 Request layers

Use this order for `/api` requests:

1. JSON/body-size handling.
2. Request ID and safe error mapping (no secret/path leakage).
3. Optional session resolution for all requests.
4. Origin/CSRF checks for cookie-authenticated mutations.
5. Route-specific authorization (`authenticated` or `admin`).
6. Validation and path safety.
7. Concurrency precondition validation.
8. Server metadata sanitization/injection.
9. Vault service/provider write.
10. Index/history refresh and response with new `ETag`.

### 3.2 Public and protected projections

Do not use one raw-document response for both public reading and editing.

- **Public document endpoint:** returns a public projection with agent instruction/review blocks removed.
- **Protected source endpoint:** returns the exact raw Markdown for an authenticated editor and includes the current strong `ETag`.
- The public route must not return hidden source in any alternate field.
- Responses that can vary by authentication must use `Vary: Cookie` and conservative cache headers. Prefer separate public/source routes so caches cannot mix them.

Recommended protected route shape:

- `GET /api/docs/:path/source` — authenticated raw source + `ETag`.
- `PUT /api/docs/:path` — authenticated save; requires `If-Match`.

Register specific source/meta/rating routes before the generic wildcard route because Express 4 wildcard ordering matters.

### 3.3 New modules (recommended boundaries)

Keep features testable rather than adding everything to `api.ts`:

- `src/server/auth-store.ts` — encrypted file persistence and atomic store updates.
- `src/server/auth.ts` — password verification, JWT/session issuance, cookie helpers, route guards, Origin checks.
- `src/server/write-pipeline.ts` — precondition parsing, metadata injection, save orchestration.
- `src/shared/agent-blocks.ts` — pure parser/mask/accept/reject helpers; no model calls.
- `src/client/auth.tsx` or `AuthContext.tsx` — session state and login/logout.
- `src/client/components/LoginView.tsx`.
- `src/client/components/UserAdminView.tsx`.
- `src/client/components/EditorAutocomplete.tsx` or a hook plus pure trigger utilities.

Names may change to fit project style, but maintain these separations.

---

## 4. S4-3 — Authenticated editing and access control

### 4.1 Authorization policy

Public, unauthenticated access remains available for read-only knowledge browsing.

**Public read examples:**

- document public projections;
- document lists, search, tags, graph, timeline, knowledge map, attachments/raw images;
- public-safe site configuration.

**Authenticated mutations:**

- save/create/move/delete documents;
- rating, favorite, and metadata updates;
- any review Accept/Reject operation;
- reindex or other operational mutations.

**Admin-only:**

- list users;
- create users;
- reset another user’s password;
- activate/deactivate users;
- grant/revoke admin role, subject to the “last active admin” guard.

Review every `/api` route and classify it explicitly. Do not protect only `PUT /docs`; all state-changing routes must be covered.

### 4.2 File-based encrypted auth store

Store auth data under configured `dataDir`, not in the vault, for example:

- `data/auth.enc`
- optional recoverable backup `data/backups/auth-<timestamp>.enc`

The encrypted file envelope should be versioned and contain only ciphertext metadata:

```json
{
  "version": 1,
  "algorithm": "aes-256-gcm",
  "iv": "base64",
  "tag": "base64",
  "ciphertext": "base64"
}
```

The decrypted payload contains:

```ts
interface AuthState {
  version: 1;
  users: Array<{
    id: string;
    username: string;
    usernameNormalized: string;
    role: 'admin' | 'user';
    passwordHash: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
    passwordChangedAt: string;
  }>;
  sessions: Array<{
    id: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
    revokedAt?: string;
  }>;
}
```

Implementation requirements:

- AES-256-GCM using Node `crypto`.
- Encryption key supplied through a protected environment variable such as `KV_AUTH_ENCRYPTION_KEY`; never derive it from the admin password.
- Require an adequately random 32-byte key (base64 or hex with strict validation).
- Atomic store writes: write temp file, mode `0600`, `fsync`, rename, and preserve the last valid encrypted copy before replacing it.
- Never log decrypted state, hashes, JWTs, cookie values, or encryption material.
- Serialize updates through a process-local store mutex/queue to prevent lost updates.
- Fail closed at startup if `auth.enc` exists but cannot be decrypted. Do not replace it or silently create a fresh admin.
- Use a pure-JavaScript maintained password-hash library compatible with this deployment (recommended preflight: `bcryptjs`) or a vetted built-in alternative. Do not add SQLite/native database dependencies.

### 4.3 Initial admin bootstrap

Environment inputs:

- `INITIAL_ADMIN_USERNAME` — default `admin` if omitted.
- `INITIAL_ADMIN_PASSWORD` — required only when no user/admin store exists.
- `KV_AUTH_ENCRYPTION_KEY` — always required while auth is enabled.
- `KV_SESSION_SECRET` — independent high-entropy signing secret.
- optional `KV_SESSION_TTL_HOURS` — default documented value (recommended 12 hours).

Rules:

1. On boot, if the encrypted store has no users, require `INITIAL_ADMIN_PASSWORD`, validate strength, hash it, and create the initial admin.
2. If users already exist, ignore the bootstrap password for provisioning and emit a warning that the operator should remove it from persistent environment configuration.
3. The application cannot erase a systemd/environment-file value itself. Deployment instructions must explicitly remove `INITIAL_ADMIN_PASSWORD` after the successful first login and restart.
4. Never commit a `.env` file. Extend `.gitignore` if any auth-specific local env filename is introduced.
5. Do not output the bootstrap password in logs, diagnostics, UI, tests, or Git history.

### 4.4 Sessions and cookies

Use a signed JWT in an HTTP-only cookie containing a random session ID, user ID, role, issued time, and expiry. Keep matching session records in the encrypted store so logout, password resets, and deactivation can revoke sessions.

Cookie requirements:

- name such as `kv_session`;
- `HttpOnly`;
- `SameSite=Lax`;
- `Path=/`;
- `Secure` in HTTPS production;
- bounded `Max-Age` aligned with server session expiry.

Do not put password hashes or unnecessary personal data in the JWT. Resolve the user and stateful session record on each protected request.

Security requirements:

- generic login failure message (no username enumeration);
- in-memory rate limiting/backoff by IP and normalized username;
- validate `Origin` against configured/public origin for mutation requests, in addition to `SameSite=Lax`;
- accept JSON only for JSON mutations;
- revoke all user sessions after password reset/deactivation;
- prevent deletion/deactivation/demotion of the last active admin;
- set Express `trust proxy` correctly only for the known reverse-proxy topology so secure-cookie detection is trustworthy;
- require HTTPS for non-loopback deployments.

### 4.5 Auth API contract

Recommended endpoints:

| Method | Endpoint | Access | Result |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Verifies credentials, creates stateful session, sets cookie |
| `POST` | `/api/auth/logout` | Authenticated | Revokes current session and clears cookie |
| `GET` | `/api/auth/session` | Public/optional | Returns `{authenticated:false}` or safe current-user details |
| `GET` | `/api/admin/users` | Admin | Lists safe user records, never hashes |
| `POST` | `/api/admin/users` | Admin | Creates user |
| `PUT` | `/api/admin/users/:id/password` | Admin | Resets password and revokes sessions |
| `PUT` | `/api/admin/users/:id/status` | Admin | Activates/deactivates user |
| `PUT` | `/api/admin/users/:id/role` | Admin | Changes role with last-admin guard |

Use `401` for unauthenticated, `403` for authenticated-but-forbidden, `400/422` for invalid input, and `409` for duplicate usernames.

### 4.6 Client behavior

- Add login/logout controls without blocking public browsing.
- Hide or disable Edit, Delete, Favorite, Rating, create/move, and operational controls for public users.
- If a protected request returns `401`, preserve unsaved draft locally in component memory, show a sign-in-required message, and do not discard it.
- Add an admin-only user management screen with create/reset/activate/deactivate actions and inline success/error states.
- Do not place tokens in localStorage/sessionStorage.

### 4.7 S4-3 acceptance criteria

- Public users can browse all intended read-only views.
- Public mutation requests receive `401` and do not change disk state.
- A normal user can edit but cannot access admin APIs.
- An admin can create, reset, deactivate, and reactivate users.
- Passwords are hashed; auth storage is encrypted at rest and contains no plaintext credentials.
- Logout/deactivation/password reset invalidate affected sessions.
- Restarting the service preserves users and valid non-expired sessions.
- A wrong encryption key fails closed without altering `auth.enc`.
- Public `/api/config` no longer leaks the absolute vault path.

---

## 5. S4-4 — Atomic metadata and concurrency control

### 5.1 Canonical metadata field

Use the existing vault frontmatter key **`updated`**, not a parallel `updatedAt` field. Inject an authoritative UTC ISO-8601 value, for example:

```yaml
updated: 2026-09-20T00:23:00.000Z
```

The server must:

1. ignore/remove a client-supplied top-level `updated` value for mutation purposes;
2. set `updated` immediately before the final save;
3. preserve all unrelated frontmatter bytes, comments, arrays, ordering, body content, and line-ending behavior as far as the existing targeted helper permits;
4. apply the same policy to full document saves and server-side rating/metadata mutations.

Do not update `created` automatically.

### 5.2 HTTP precondition contract

- Raw authenticated source response includes a strong quoted `ETag` derived from the on-disk version. The externally visible value must at least include the requested `mtimeMs` contract.
- Authenticated client stores the ETag when edit source is loaded.
- Every save sends `If-Match: "<etag>"`.
- Missing `If-Match` returns `428 Precondition Required` unless an explicit, separately authorized overwrite action is used.
- A stale precondition returns `412 Precondition Failed` with safe conflict metadata and the current ETag. Do not include hidden remote source in the error body by default.
- A successful write returns the new ETag and saved document metadata.

Recommended response body:

```json
{
  "error": "precondition_failed",
  "message": "The file changed after editing began.",
  "currentEtag": "...",
  "currentMtimeMs": 1234567890
}
```

### 5.3 Preserve internal hash protection

The API contract moves to ETag/If-Match, but do not discard content hashing blindly. Filesystems can have coarse mtime precision. Internally:

- capture both `mtimeMs` and SHA-256 when source is read;
- use the quoted mtime-based ETag required by the sprint;
- verify the current mtime immediately before write;
- retain hash verification as a secondary guard/migration aid where practical;
- update shared types/comments that currently call the hash “md5-ish”.

During one compatibility window, the server may accept the legacy body `expectedHash` only from the current client/tests while migration is underway. The finished S4 client must use `If-Match`; document and remove dead compatibility code before declaring complete if no external client needs it.

### 5.4 Race handling

- Serialize app-originated writes by canonical relative path with an in-process mutex/queue.
- Inside the lock: re-stat/re-read, compare precondition, inject metadata, write temp file, `fsync`, re-check expected target state immediately before rename, then atomic rename.
- Preserve current path-safety checks and backup behavior.
- Be explicit in code comments: arbitrary external programs do not honor application locks, so a POSIX filesystem cannot provide a perfect cross-process compare-and-swap. The implementation must minimize the gap and never claim stronger guarantees than it has.
- If the final check detects change, delete the temp file and return `412`; do not rename.

### 5.5 Client conflict experience

- Remove use of `baseHash`; store `baseEtag` from the authenticated source response.
- Save button remains available while dirty and authenticated.
- On `412`, retain the user’s draft and show:
  - **Load external version** — explicitly discards the local draft after confirmation;
  - **Review differences** — if existing diff support can be reused safely;
  - **Overwrite with mine** — separate privileged/explicit action that first loads the newest ETag and requires a second confirmation. Never implement overwrite by omitting `If-Match` accidentally.
- Polling must not replace `draft` while edit/split mode is active.

### 5.6 S4-4 acceptance criteria

- Source GET emits a valid ETag.
- Save without `If-Match` returns `428`.
- Save with a current ETag succeeds, injects server UTC `updated`, and returns a new ETag.
- Save after an external disk change returns `412`; the external content remains unchanged.
- Rating/metadata saves use the same metadata and concurrency pipeline.
- Two app requests racing on the same note cannot both silently succeed from the same baseline.
- Frontmatter tests prove comments, arrays, unknown keys, body bytes, and existing key order are preserved except for the targeted `updated` line.

---

## 6. S4-1 — Manual save only

### Implementation

- Delete `debounceAutoSave`, its timer ref, and all timeout cleanup made obsolete by removal.
- Textarea `onChange` updates `draft` only.
- Track dirty state as `draft !== loadedRawContent` (or an equivalent explicit baseline), not merely “user typed once”.
- Save is enabled only when authenticated, dirty, not currently saving, and not in unresolved conflict.
- Cancel restores the loaded source and returns to read mode. If dirty, use in-app confirmation; do not use native `confirm()`.
- Navigating away or closing the page while dirty should produce an in-app route warning where supported and a browser `beforeunload` warning for true page unload. Never auto-save as a workaround.
- After successful save, refresh the source/document, update ETag/baseline, clear dirty state, and show saved time.
- Failed save preserves the draft.

### Acceptance criteria

- Typing and waiting does not issue a save request and does not modify the file.
- Switching between Edit and Split does not save.
- Save click causes exactly one write request.
- Cancel discards only after explicit confirmation when dirty.
- Successful save updates `updated` through the server pipeline.
- Errors, `401`, and `412` keep the draft available.

---

## 7. S4-5 — Raw Markdown autocomplete

### 7.1 Scope

Retain the existing textarea and raw Markdown. Do not introduce a rich-text document model or serialize Markdown through ProseMirror.

Supported triggers:

- `[[` starts wikilink suggestions.
- Text after `[[` filters notes by title, alias, filename, and path.
- `#` starts tag suggestions only when it is a plausible tag token, not inside a word or fenced code block.
- Selecting a note inserts `[[Title]]` or the project’s canonical safe label.
- Selecting a tag inserts `#tag`.
- A typed tag not in the list remains valid; it becomes indexed after Save.

### 7.2 Data sources

- Wikilinks: debounce approximately 200 ms and use the existing `GET /api/search?q=` endpoint, limited client-side to a small top set (recommended 8). Ensure search remains fast; add a server `limit` query only if necessary and tested.
- Tags: fetch `/api/tags`, cache per view/session, and filter locally. Refresh after a successful save/reindex.
- Never scan vault files directly from the browser.

### 7.3 Trigger/parser behavior

Implement trigger detection as pure functions with unit tests. It must return:

```ts
interface AutocompleteTrigger {
  kind: 'wikilink' | 'tag';
  query: string;
  replaceStart: number;
  replaceEnd: number;
}
```

Rules:

- inspect the cursor position and current source;
- ignore closed wikilinks (`[[...]]`) behind the cursor;
- ignore fenced code blocks and inline code;
- preserve selected text and cursor placement;
- escape/handle note names containing spaces, `#`, aliases, and folders;
- cancel on Escape, cursor leaving the trigger, or edit mode closing.

### 7.4 UI

- Floating suggestion panel anchored near the editor/caret when feasible; a stable panel under the editor is acceptable on mobile.
- Show note title plus folder for wikilinks; show tag plus count for tags.
- Support click/tap selection and existing app visual language.
- Do not allow stale asynchronous responses to replace newer suggestions; use request sequence IDs or `AbortController`.
- Keep textarea focus after insertion.

### Acceptance criteria

- `[[abi` suggests the Abilene Paradox note and inserts a valid wikilink.
- `#hum` suggests matching tags with counts.
- Unknown tags can be typed and saved.
- No autocomplete opens inside fenced code or inline code.
- Rapid typing does not show stale results or make excessive requests.
- Save output exactly matches textarea source plus server-owned `updated`; no unrelated Markdown is rewritten.

---

## 8. S4-2 — Tag cloud redesign

### 8.1 Desktop layout

Use a two-column responsive layout:

- left/main: visual tag cloud;
- right: sortable tag directory with counts;
- selected-tag notes remain clearly associated below the cloud/list area or in a full-width section.

The visual direction from the supplied references:

- prominent tags use substantially larger bold type;
- multi-colour palette with deterministic colour per tag;
- organic, dense arrangement rather than identical chips in a strict grid;
- frequency maps to size with a clamped scale so one dominant tag does not erase smaller tags;
- avoid overlapping text and clipped tags;
- tags remain buttons/links with visible selected state and count tooltip.

A deterministic flex/packing layout is preferred over unbounded pseudo-random absolute positions. If vertical orientation is used to echo the references, limit it to a deterministic minority and disable it on narrow screens where readability suffers.

### 8.2 Tag directory

- One row per tag: tag label and count.
- Sort control with at least:
  - **Count** — descending by default; ties alphabetical;
  - **A–Z** — locale-aware ascending.
- Make the active sort explicit and deterministic.
- Clicking a cloud tag or list row selects the same state and loads its notes.
- Selected tag remains visible after sort changes.
- Empty state: “No tags found.”

### 8.3 Responsive behavior

- Desktop: cloud plus fixed/minmax right column.
- Tablet/mobile: stack cloud then list; controls remain above the list.
- No horizontal viewport overflow.
- Large tags wrap/scale down rather than clip.

### Acceptance criteria

- Size reflects count and colour is stable across reloads.
- Count sort and A–Z sort produce deterministic results, including ties and case differences.
- Cloud and list selection stay synchronized.
- Counts match `/api/tags` and selected note list.
- Layout works at desktop, tablet, and mobile widths without overlap/clipping.

---

## 9. S4-6 — Agent instruction syntax, masking, and review staging

### 9.1 Supported syntax

Instruction block:

```md
> [!agent] TARGET: document
> Research the claim and propose sourced additions.
```

A target may identify the document or a specific stable paragraph/block identifier. Define accepted target grammar in code and tests; malformed targets remain inert text in authenticated edit view but must still be hidden publicly if they start an agent callout.

Review block written by external OpenClaw orchestration:

```md
> [!agent-review] ID: <stable-id> STATUS: ready
> Proposed content appears here.
```

The microsite does **not** poll models, send prompts, execute shell commands, or call OpenClaw. External orchestration reads/writes the vault separately.

### 9.2 Shared parser

Create a pure line-aware parser rather than a broad regex. It must:

- identify complete `[!agent]` and `[!agent-review]` blockquote callouts;
- capture type, header metadata, content, start/end offsets, and stable ID where present;
- handle continuation `>` lines and blank quoted lines;
- ignore examples inside fenced code blocks;
- avoid consuming the paragraph after the block;
- tolerate LF/CRLF;
- provide `maskAgentBlocks(source)` that removes both instruction and review blocks from public projection without changing the file;
- provide edit/review helpers that operate by verified offsets or stable IDs and fail safely if source changed.

### 9.3 Public masking

Mask on the server before returning the public document API response. Client-only CSS hiding is forbidden because it leaks prompts through HTML/API/devtools/search.

Also ensure agent blocks do not enter:

- public search snippets/indexed body text;
- graph labels/metadata;
- timeline previews;
- public rendered HTML;
- logs or diagnostics.

The raw vault and authenticated source view remain unchanged.

### 9.4 Review staging UI

In authenticated edit/split mode:

- identify pending instruction and review blocks;
- show a compact review-status panel with counts and stable IDs/targets;
- allow navigating to the relevant source range;
- for `[!agent-review]`, provide:
  - **Accept** — convert the proposed payload to ordinary Markdown while removing only the wrapper/metadata;
  - **Reject** — remove the review block after in-app confirmation;
  - **Keep staged** — no file change.
- Accept/Reject only changes the editor draft. The user must still click the main **Save** button; this preserves S4-1 and S4-4 semantics.
- Never automatically replace human-authored text.

### 9.5 Loop and prompt-injection safety

- OpenClaw is responsible for processing only `[!agent]` blocks that do not already have a corresponding staged result.
- The site parser must preserve stable IDs so external orchestration can deduplicate.
- A completed instruction should be replaced/marked by the external orchestrator when it stages review output; otherwise it will be rediscovered.
- Public masking is unconditional regardless of prompt content.
- The microsite never treats prompt text as an application command.
- External orchestration must retain independent safety rules: no deleting core documents, no credential requests, no unauthorized external actions, and no destructive overwrite.

### Acceptance criteria

- Public document JSON and rendered HTML contain no instruction/review text.
- Authenticated source view shows the exact raw blocks.
- Blocks inside code fences are not interpreted.
- Accept converts only the selected review block into normal Markdown in the draft.
- Reject removes only the selected review block in the draft.
- Neither action writes until Save is clicked.
- No network/model execution is added to the microsite.

---

## 10. Consolidated API changes

| Method | Endpoint | Auth | Precondition | Notes |
|---|---|---:|---:|---|
| `GET` | `/api/docs/:path` | Public | — | Public projection; agent blocks removed |
| `GET` | `/api/docs/:path/source` | User | — | Exact raw Markdown; returns `ETag` |
| `PUT` | `/api/docs/:path` | User | `If-Match` required | Injects `updated`; `412` on stale version |
| `POST` | `/api/docs` | User | create-only | Injects `updated`; fails if path exists |
| `POST` | `/api/docs/move` | User | current source precondition where feasible | Preserve path protections |
| `DELETE` | `/api/docs/:path` | User | current ETag recommended | Preserve backup-before-delete |
| `PUT` | `/api/docs/:path/rating` | User | current ETag | Same write pipeline |
| `PUT` | `/api/docs/:path/meta` | User | current ETag | Allowlist fields; same write pipeline |
| `POST` | `/api/vault/reindex` | Admin | — | Operational mutation |
| `POST` | `/api/auth/login` | Public | — | Sets HTTP-only cookie |
| `POST` | `/api/auth/logout` | User | — | Revokes stateful session |
| `GET` | `/api/auth/session` | Optional | — | Safe session state |
| `GET/POST/PUT` | `/api/admin/users...` | Admin | — | User management |

If exact paths differ during implementation, update this document and API wrapper together. Do not leave undocumented hidden mutation routes.

---

## 11. Build order and checkpoints

Follow this order to limit broken intermediate states.

### Phase A — Baseline and pure utilities

1. Confirm clean Git state and current branch/head.
2. Run baseline lint, tests, build, and QA before changes.
3. Add pure tests/utilities for:
   - agent block parsing/masking;
   - updated-field sanitization/injection;
   - ETag/precondition parsing;
   - autocomplete trigger detection;
   - tag sorting.
4. Verify no vault file changed during utility work.

### Phase B — Auth foundation

1. Preflight maintained pure-JS libraries before adding dependencies.
2. Implement encrypted auth store and its failure/atomic-write tests.
3. Implement password verification, session signing, cookie handling, and authorization middleware.
4. Implement bootstrap and admin APIs.
5. Add login/session/admin UI.
6. Protect every mutation and redact public config.

Checkpoint: public reads work; anonymous writes fail; admin lifecycle works; no note-edit changes yet.

### Phase C — Write pipeline and manual editing

1. Implement source endpoint and ETag response.
2. Implement precondition/write pipeline and authoritative `updated` injection.
3. Route all content mutations through it.
4. Migrate client from `baseHash` body field to ETag headers.
5. Remove auto-save and add dirty/cancel/unload behavior.
6. Verify conflict UI preserves drafts.

Checkpoint: authenticated manual save is correct, stale writes return `412`, and external edits are retained.

### Phase D — Autocomplete and tag UI

1. Add pure autocomplete trigger/insertion behavior.
2. Wire debounced search and cached tag suggestions.
3. Redesign tag cloud/list and responsive styling.
4. Verify keyboard/click/touch behavior supported by existing UI patterns.

### Phase E — Agent staging

1. Apply masking to public API projections and searchable/indexed text.
2. Use raw source only in authenticated editor.
3. Add staged-review UI and draft-only Accept/Reject transforms.
4. Prove the app has no model execution/network integration.

### Phase F — Integration, deployment, and Git

1. Run the entire verification matrix below.
2. Build production assets.
3. Back up current app data/config and record pre-deploy service state.
4. Configure secrets through protected deployment mechanisms; never commit them.
5. Deploy/restart services.
6. Run local live smoke tests, then approved public endpoint checks.
7. Verify vault file manifest/change set contains only deliberate test/user saves.
8. Update `docs/sprints.md` with completion status, test totals, and commit.
9. Commit all S4 code/docs with a clear message and push `master` only after success.

---

## 12. Verification matrix

### 12.1 Static and existing gates

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run qa`
- inspect Git diff and ensure no generated `dist`, `data`, secret, or vault files are staged

### 12.2 New automated coverage

**Auth/store**

- bootstrap only when no users exist;
- duplicate normalized username rejected;
- password never serialized plaintext;
- ciphertext differs across writes because of fresh IV;
- wrong key/tamper fails closed;
- file mode and atomic replacement verified where platform permits;
- login success/failure and rate limiting;
- logout, expiry, reset, and deactivation revoke sessions;
- last-admin guard;
- anonymous `401`, non-admin `403`.

**Concurrency/metadata**

- GET source returns ETag;
- missing precondition `428`;
- matching ETag save success;
- stale ETag `412` after external edit;
- two same-baseline writes: only one succeeds;
- `updated` injected in UTC and client value ignored;
- comments/arrays/unknown frontmatter preserved;
- temp file cleaned after failure.

**Manual editor/autocomplete**

- typing does not call save;
- one click creates one save request;
- cancel/failed save preserves or deliberately resets as specified;
- wikilink/tag trigger ranges and insertion;
- no trigger inside code;
- stale suggestion response ignored.

**Tags**

- count sort descending with alphabetical tie-break;
- A–Z sort;
- stable colour/size mapping;
- selection synchronized between cloud and directory.

**Agent blocks**

- instruction and review blocks parsed;
- fenced examples ignored;
- public masking removes all block content;
- surrounding Markdown preserved;
- accept/reject affect only selected block;
- public search/snippets do not contain prompt/review text.

### 12.3 Live smoke tests

Use a disposable test note or temporary test vault when mutations are necessary. Do not use a valuable production note for destructive cases.

1. Anonymous home/search/note/image/tag pages load.
2. Anonymous edit controls are absent and direct mutation returns `401`.
3. Admin login sets expected cookie flags.
4. Create a temporary normal user; verify edit allowed and admin denied.
5. Edit a disposable note, wait beyond 1200 ms, verify disk unchanged.
6. Click Save; verify disk changes once and `updated` is refreshed.
7. Externally edit the note during a browser edit; Save returns conflict and external text survives.
8. Exercise `[[` and `#` suggestions.
9. Verify cloud/list sorting and responsive layout via screenshots.
10. Add sample agent/review blocks to disposable content; confirm public API/render/search mask them and authenticated source shows them.
11. Accept/reject in draft, then Cancel—disk must remain unchanged.
12. Save an accepted review and verify only intended content changes.
13. Deactivate test user and verify existing session immediately loses access.
14. Delete the disposable user/note through supported safe paths and verify backups where applicable.

### 12.4 Security inspection

- search repository and built assets for test passwords, secrets, cookie values, and private paths;
- inspect response headers for cookies, caching, and ETag behavior;
- confirm no auth file or `.env` is tracked;
- confirm public config/API does not expose `vaultPath` or raw agent prompts;
- confirm HTTPS/public proxy behavior before setting production cookie policy complete.

---

## 13. Deployment and first-run runbook

1. Generate independent high-entropy values for encryption and session signing via the protected secret mechanism; do not paste them into chat or commit them.
2. Set `INITIAL_ADMIN_PASSWORD` only for first bootstrap.
3. Deploy and start the service behind HTTPS.
4. Confirm bootstrap succeeds and `data/auth.enc` is created with restrictive permissions.
5. Log in as initial admin and change/reset password if the bootstrap policy requires it.
6. Remove `INITIAL_ADMIN_PASSWORD` from persistent environment configuration and restart.
7. Confirm existing admin login still works and no second admin is created.
8. Run public and authenticated smoke tests.
9. Retain the previous application version and encrypted auth backup until acceptance is complete.

If deployment cannot provide HTTPS, do not expose authenticated editing publicly. Keep it loopback/private until HTTPS is available.

---

## 14. Rollback and recovery

### Application rollback

- Stop the new service version.
- Restore the previous known-good app commit/build.
- Restore compatible configuration.
- Do not delete the vault or index to fix an auth/UI problem.

### Auth-store recovery

- Never overwrite an unreadable `auth.enc` automatically.
- Preserve the failed file and logs without secret content.
- Restore the latest valid encrypted backup using the same encryption key.
- If the key is lost, encrypted user data is intentionally unrecoverable; establish a deliberate owner-approved reset procedure that archives the old ciphertext before creating a new store.

### Vault-write recovery

- For a suspected bad write, compare the affected note with app backups and Git/Obsidian history before restoring.
- Restore only the affected file.
- Reindex after restoration.
- Do not bulk rewrite frontmatter.

### Interrupted-agent handoff

A replacement agent must:

1. run `git status --short --branch` and inspect recent commits;
2. read this document and `docs/sprints.md`;
3. inspect active service/process state;
4. run the smallest relevant tests before changing code;
5. determine the last completed checkpoint from evidence, not chat claims;
6. preserve any user draft, auth ciphertext, and vault files;
7. continue from the first unverified requirement.

---

## 15. Explicitly out of scope

- Full WYSIWYG/ProseMirror editor.
- SQLite or any dual database backend.
- OAuth, SSO, external identity providers, email flows, or public self-registration.
- AI/model execution inside the microsite.
- Automatic application of agent output.
- WebSockets or collaborative real-time editing.
- Reformatting all vault frontmatter.
- Moving the vault into application storage.
- Adding app caches/state inside the vault.

---

## 16. Definition of done

S4 is complete only when all of the following are evidenced:

- [x] S4-1 through S4-6 acceptance criteria pass in automated/local fixture verification.
- [x] Public browsing works without login.
- [x] Every application mutation is authenticated and correctly authorized (login is the intentional public exception).
- [x] Auth state is encrypted file storage only; no SQLite.
- [x] Auto-save is absent; unsaved drafts survive errors/conflicts.
- [x] Server updates canonical `updated` only on successful writes.
- [x] ETag/If-Match rejects stale writes without data loss.
- [x] Raw Markdown autocomplete works without source reserialization.
- [x] Tag cloud and sortable count directory match the approved responsive design.
- [x] Public APIs/render/search-derived indexes contain no agent instruction/review content.
- [x] Review actions remain draft-only until Save.
- [x] The microsite makes no AI/model calls.
- [x] Lint, tests, build, fixture QA, and local security inspection pass.
- [x] Deployment and live-service smoke tests pass on the active loopback service and current HTTPS tunnel.
- [x] Safe fixture/temp-directory and live read-only audits show no unintended real-vault modifications.
- [x] `docs/sprints.md` records completion status, deployment evidence, and verification totals.
- [x] Final changes are committed and pushed to GitHub.

No partial success should be described as completion. If blocked, record the exact failing command/test, affected requirement ID, preserved state, and the next safe action.

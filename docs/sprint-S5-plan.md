# Sprint S5 Implementation Plan

**Status:** Implementation complete, deployed, and committed as `a85680f`
**Sprint:** S5
**Created:** 2026-09-20
**Released:** 2026-09-20
**Repository:** `Gavinsb/obsidian-vault-site`

## Scope

S5 contains two collected items:

1. **S5-1 — Repair `invalid_if_match` failures** for explicit document saves and ratings without weakening stale-write protection.
2. **S5-2 — Add an “Editing help” box** between File info and Backlinks that accurately documents editor syntax, autocomplete, and agent-block behavior.

No product implementation is authorized until Gav says `start build`.

## Execution log

- **2026-09-20 — Build authorized.** Gav explicitly said `start build`.
- **2026-09-20 — S5-1 implemented.** `parseIfMatch` now accepts the strong quoted app form, the proxy-weak `W/` prefix, an unquoted transport loss, and surrounding whitespace, and returns a canonical lowercase strong token; malformed/wildcard/multi/internal-quote forms remain rejected (`400`), missing precondition stays `428`, stale well-formed tokens stay `412`, and matching tokens write atomically. Protected source responses now carry `Cache-Control: private, no-store, no-transform` to discourage intermediary ETag rewriting. Client save/rating errors for `400`/`428` now show a friendly retry message instead of a raw identifier and preserve the draft.
- **2026-09-20 — S5-2 implemented.** Added `src/client/components/EditingHelp.tsx`, rendered in the note context column between **File info** and **Backlinks** only for signed-in editors, collapsed by default. It documents formatting, Obsidian wikilinks/aliases/embeds/callouts/tags, `[[`/`#` autocomplete triggers and code suppression, a copyable `> [!agent] TARGET: document` template, public masking, external OpenClaw execution, review Accept/Reject draft-only staging, safety, saving, and conflict behavior.
- **2026-09-20 — Local verification passed.** `npm run lint`; Vitest 97/97 across 16 files (new: `tests/editing-help.test.ts`, expanded `tests/write-pipeline.test.ts`); production build (1608 modules); fixture QA 27/27; `git diff --check`. Implementation was done in a visible subagent; after the provider rate-limited that session twice, the parent completed the code directly and re-ran the full gate.
- **2026-09-20 — Deployed** with an active/enabled service; local and external HTTPS endpoints return `200`; live mutation acceptance uses a disposable vault-root note (created, saved with strong/weak/unquoted ETags, rated, then deleted) and verifies the vault manifest returns to the 31-file baseline.

## Baseline and diagnosis

### S5-1

The mutation flow is:

1. Authenticated client requests `/api/docs/:path/source`.
2. The server emits a strong ETag such as `"19abc-0123456789abcdef"`.
3. The client reuses that value in `If-Match` for document, rating, metadata, or delete mutations.
4. `parseIfMatch()` currently accepts only the exact strong quoted form.
5. `conditionalSave()` compares the validated token with the current file ETag and returns `412` for a stale token.

Direct local API/QA tests pass, while browser mutations through the HTTPS tunnel fail before comparison with `400 invalid_if_match`. The leading working diagnosis is that a proxy/browser path is presenting the valid opaque token in a semantically equivalent form the strict parser rejects—most likely a weak validator such as `W/"…"`. The build must prove the actual live header shape before finalizing the normalization rule; malformed values must remain rejected.

### S5-2

The editor is a raw Markdown textarea. Current autocomplete supports only:

- `[[query` → note-title/path suggestions; selection inserts `[[Note]]`.
- `#query` after whitespace or `(` → existing tag suggestions; selection inserts `#tag`.
- Suggestions are suppressed inside inline code and fenced code blocks.

The rendered Markdown surface supports the `marked` feature set plus these application-specific forms:

- Obsidian wikilinks and aliases: `[[Note]]`, `[[Note|Label]]`.
- Image embeds: `![[image.png]]`.
- Relative standard Markdown images: `![alt](path/image.png)`.
- Obsidian-style callouts: `> [!note] Title` and quoted body lines.
- Inline and nested tags: `#tag`, `#parent/child`.
- YAML frontmatter remains editable source but is hidden from read rendering.
- Agent instruction/review callouts parsed by the site.

Agent blocks are syntax and staging only. The microsite does not run a model. Public read projections remove complete `agent` and `agent-review` blocks. An external OpenClaw workflow reads an instruction and may stage a review block; the signed-in editor can accept or reject that review in the draft, then explicitly save it.

## Build order

### Wave 1 — S5-1: reproduce and repair concurrency headers

1. **Capture the failing representation safely.** Add a temporary diagnostic/test seam that records only the structural validator form (strong, weak, missing, malformed), never note content, cookies, or credentials. Reproduce through the HTTPS route or an equivalent integration fixture.
2. **Normalize only recognized app ETags.** Update the precondition parser to accept the proven transport variant while returning the canonical strong application token. Keep the exact app token grammar (`hex mtime` + 16 hex hash characters); do not accept wildcard `*`, arbitrary weak tags, empty tags, or unquoted content.
3. **Discourage intermediary transformation.** Add `no-transform` to the protected source response cache policy if live evidence confirms proxy rewriting.
4. **Preserve concurrency behavior.** Missing `If-Match` remains `428`; malformed remains `400`; a well-formed stale token remains `412` with the current ETag; a matching token saves atomically and returns the next ETag.
5. **Cover every mutation path.** Verify document save, rating, favorite/metadata, and delete use the same canonical precondition behavior. A successful rating must refresh document metadata and the client-held ETag so the next mutation does not become stale.
6. **Improve user-facing errors.** Convert raw protocol identifiers into concise conflict/precondition messages while preserving draft content.

### Wave 2 — S5-2: Editing help box

1. Add an `EditingHelp` component to the note context column, exactly between **File info** and **Backlinks**.
2. Use semantic sections and copyable inline examples rather than deriving the guide from implementation strings at runtime.
3. Document the supported core syntax:
   - headings (`#` through `######`)
   - bold, italic, strikethrough
   - unordered/ordered lists and task lists
   - blockquotes and horizontal rules
   - links and relative images
   - inline code and fenced code blocks
   - tables
   - YAML frontmatter
4. Document Obsidian/app syntax:
   - wikilinks and aliases
   - image embeds
   - callouts
   - flat and nested tags
5. Document autocomplete precisely:
   - trigger characters (`[[` and `#`)
   - how filtering and selection work
   - code-context suppression
   - what does **not** autocomplete
6. Include a copyable agent-block template, for example:

   ```md
   > [!agent] TARGET: document
   > Describe the requested work here.
   ```

7. Explain the full agent lifecycle without implying automatic execution:
   - instruction stays hidden from public read projections
   - the site itself executes no AI
   - external OpenClaw processing is required
   - a result may arrive as `> [!agent-review] ID: … STATUS: ready`
   - Accept/Reject changes only the local draft
   - the user must click Save to persist the result
8. Keep the sidebar usable on desktop and mobile; long help content must not force the article below the fold or cause horizontal overflow.

## Tests

### Unit/integration

- Accept the exact live transport variant and canonicalize it.
- Reject malformed, wildcard, multi-value ambiguity, and wrong-shape validators.
- Confirm strong matching token succeeds.
- Confirm stale strong/normalized token returns `412` and does not write.
- Confirm save and rating each return a fresh ETag and permit a subsequent mutation.
- Confirm raw mutation errors are translated while drafts remain intact.
- Confirm `EditingHelp` is between File info and Backlinks.
- Confirm the help includes Markdown, wikilink/tag autocomplete, agent template, masking, external execution, review, explicit-save, and code-suppression guidance.

### Existing gates

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run qa`
- `git diff --check`

### Live acceptance

Using the HTTPS tunnel and an authenticated session:

1. Edit a disposable/safe test note and click Save once; no `invalid_if_match` error.
2. Change its rating, then favorite state; each succeeds in sequence without reloading.
3. Open the same note in two clients, save one, and verify the stale client receives the conflict UI rather than overwriting.
4. Confirm malformed/missing preconditions still fail at the API.
5. Verify Editing help placement, readability, examples, and responsive layout in light and dark themes.
6. Confirm public users cannot see agent instructions/reviews and cannot mutate notes.
7. Remove or restore any disposable live-test change before release.

## Deployment and release

1. Build before restart.
2. Restart `kv-microsite.service`; verify active/enabled state and clean startup logs.
3. Run local and HTTPS acceptance checks.
4. Update `docs/sprints.md` and this document with evidence and final commit.
5. Commit with the configured `Gavinsb` identity, push `master`, and verify local/remote HEAD equality.

## Approved UX decisions

1. **Editing help visibility:** signed-in editors only; public readers keep the existing compact context column.
2. **Default presentation:** collapsed by default as a compact, expandable context box.

## Definition of done

- Saves, ratings, metadata changes, and deletes no longer fail with `invalid_if_match` for valid live ETags.
- Stale writes still receive `412` and never overwrite external changes.
- The Editing help box is correctly placed and accurately documents every supported editor/autocomplete/agent feature.
- Existing and new tests pass; live light/dark desktop/mobile checks pass.
- Documentation is current; changes are deployed, committed, and pushed.

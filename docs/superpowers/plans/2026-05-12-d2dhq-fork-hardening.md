# D2DHQ Documenso Fork Hardening Plan

> **For agentic workers:** Use superpowers:executing-plans (inline) to work through tasks. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Patch the D2DHQ Documenso fork so signing pages, emails, and webhooks look + behave like a first-party D2DHQ feature instead of a third-party tool. Ship 12 cheap-to-medium items in one wave; defer 4 schema-touching items to future focused sessions.

**Architecture:** Most changes are isolated edits to existing files in `apps/remix/app/` and `packages/`. Where Documenso provides an env-driven toggle, we set it via env on Dokploy. Where the marketing/upsell behavior is hardcoded, we patch it out directly in the fork (per D2DHQ policy: no feature flags during pre-user phase). Webhook ordering fix lives in the server-only webhook dispatcher. Geo-block lives in a Remix route loader.

**Tech Stack:** Remix v2 (Documenso migrated off Next.js), tRPC, Prisma, Tailwind, packaged at `apps/remix`. The fork sits at `/Volumes/source25/Projects/documenso`, branch `patch/smaller-field-bounds`.

**Cross-app boundary:** Items #12–#15 require coordinated changes in the D2DHQ FastAPI app (`/Volumes/source25/Projects/Chris Project`). Those are NOT in this plan — they each need their own design pass.

---

## Scope decisions made up front

- **No feature flags.** Per `feedback_no_feature_flags_preusers` — we have no production signers on this fork yet. Hardcode the white-label behavior; delete dead code paths instead of gating them.
- **Email branding lives in env vars** (`NEXT_PUBLIC_WEBAPP_URL`, `NEXT_PRIVATE_SMTP_FROM_NAME`, `NEXT_PRIVATE_SMTP_FROM_ADDRESS`). Document the values in `.env.example`; don't hardcode in templates.
- **Tests:** Documenso uses Vitest. Where a change touches pure logic (webhook dispatcher, geo-block loader), add a unit test. Where it's UI/CSS/copy, ship without a test (Documenso's existing UI tests are sparse — adding scaffolding for one component is more work than it's worth).
- **One commit per wave** so each can be reverted in isolation if it breaks deployment.

---

## Wave 1 — White-label + marketing leak removal

### Task 1.1: Disable signup-on-completion CTA (already shipped in 850da16)

**Files:** `apps/remix/app/routes/_recipient+/sign.$token+/complete.tsx:86`

- [x] Hardcoded `canSignUp = false` so the "Need to sign documents?" / "Claim account" block never renders.
- [x] Committed + pushed in `850da16`.

### Task 1.2: Replace "Documenso" branding strings on recipient-facing pages

**Files to inspect + edit:**
- `apps/remix/app/routes/_recipient+/sign.$token+/complete.tsx` — page title, success copy
- `apps/remix/app/routes/_recipient+/sign.$token+/_index.tsx` — signing page header
- `apps/remix/app/components/general/signing-footer.tsx` (if exists) — footer text
- Any `<title>` tags pointing at "Documenso"

**Action:** Replace user-visible "Documenso" with "D2DHQ" where the recipient sees it. Internal admin pages stay as "Documenso" — D2DHQ admins won't see those (only platform super-admins debugging).

- [ ] Grep recipient-facing routes for `Documenso` string literals and `<Trans>` blocks containing it
- [ ] Replace recipient-visible occurrences with `D2DHQ`
- [ ] Skip occurrences in admin-only routes (`apps/remix/app/routes/_authenticated+/admin*`)
- [ ] Build the app to confirm Trans translations don't break (`pnpm build` in `apps/remix`)
- [ ] Commit: `patch(branding): rename recipient-facing "Documenso" → "D2DHQ"`

### Task 1.3: Replace home/back-to-app link target

**Files:** `apps/remix/app/routes/_recipient+/sign.$token+/complete.tsx`

Currently the "Go Back Home" button links to `/` (Documenso's marketing root). For an embedded signer who arrived via email link, they should land on `https://www.d2dhq.com` instead.

- [ ] Update the `Link to=` target to read from `NEXT_PUBLIC_BACK_TO_APP_URL` env var, defaulting to `/` if unset
- [ ] Add `NEXT_PUBLIC_BACK_TO_APP_URL=https://www.d2dhq.com` to `.env.example` with a comment
- [ ] Commit: `patch(complete): make "back to app" link configurable via env`

### Task 1.4: Custom SMTP from-name + reply-to

**Files:** `.env.example`, deployment docs

Documenso already supports `NEXT_PRIVATE_SMTP_FROM_NAME` and `NEXT_PRIVATE_SMTP_FROM_ADDRESS`. The fork inherits this. Just document the values to set in production:

- [ ] Add to `.env.example`:
  ```
  NEXT_PRIVATE_SMTP_FROM_NAME="D2DHQ Documents"
  NEXT_PRIVATE_SMTP_FROM_ADDRESS="docs@d2dhq.com"
  ```
- [ ] Document in `docs/superpowers/plans/2026-05-12-d2dhq-fork-hardening.md` operator notes section
- [ ] No code change, no commit yet — operator sets these in Dokploy

### Task 1.5: Replace favicon + email logo

**Files:** `apps/remix/public/favicon.ico`, `packages/email/template-components/template-footer.tsx` (logo path)

- [ ] Replace `apps/remix/public/favicon.ico` with a D2DHQ red `D` mark. **Skip if no asset on hand** — flag this for the user to drop a file later.
- [ ] Grep email templates for the Documenso logo path; if found, point at a D2DHQ-hosted PNG via env var
- [ ] Commit: `patch(branding): swap favicon + email logo for D2DHQ marks`

---

## Wave 2 — Signing UX (mobile-first)

### Task 2.1: Pre-fill signer's name into name field on first focus

**Files:** `apps/remix/app/components/general/document-signing/document-signing-name-field.tsx`

Right now the name field is empty by default. The recipient already gave their name when the doc was sent; we should pre-fill it so they can hit "Sign" without retyping.

- [ ] Read the recipient context (already available via `useRecipientContext` hook) and seed the field's initial state with `recipient.name`
- [ ] If the recipient is overriding their name, let them — only seed on first render
- [ ] Build + smoke test in dev
- [ ] Commit: `patch(signing): pre-fill name field from recipient context`

### Task 2.2: Pre-fill signature field with typed-signature default

**Files:** `apps/remix/app/components/general/document-signing/document-signing-signature-field.tsx`

For mobile users, drawing a signature on a tiny canvas is awkward. Documenso supports a "typed" signature mode where the user's name is rendered in a script font. Default to typed mode + recipient name on first open.

- [ ] Inspect the signature field component for `defaultMode` / `signatureMode` state
- [ ] When the recipient has a name AND no signature has been drawn yet, set default to `typed` mode and pre-fill text with the name
- [ ] Let user switch to drawn signature with one tap
- [ ] Commit: `patch(signing): default signature to typed-name on first open`

### Task 2.3: Auto-advance to next field on field complete

**Files:** `apps/remix/app/components/general/document-signing/document-signing-fields.tsx` or `document-signing-form.tsx`

After signing a field, the recipient should be auto-scrolled to the next unsigned required field. Documenso has the field list and ordering; just need to wire the post-save callback.

- [ ] Add a `scrollNextRequired()` helper that finds the next unsigned required field by DOM order
- [ ] Call it from the post-field-save hook on the form
- [ ] Use `scrollIntoView({ behavior: 'smooth', block: 'center' })`
- [ ] Commit: `patch(signing): auto-scroll to next required field after sign`

### Task 2.4: Bigger touch targets on mobile

**Files:** `apps/remix/app/components/general/document-signing/document-signing-field-container.tsx` (or signature/initials/date field components)

Existing patches at `622e62c` lowered min field bounds. Mobile users still struggle with fields below the iOS 44pt touch target. Add a mobile-only minimum.

- [ ] Add Tailwind classes like `min-h-[44px] md:min-h-0` to signature/initials field containers so mobile gets a 44px minimum without affecting desktop layout
- [ ] Confirm in mobile Safari devtools that the bounding box meets 44pt
- [ ] Commit: `patch(signing): enforce 44pt min touch target on mobile`

### Task 2.5: Persist drawn signature across fields in same session

**Files:** `apps/remix/app/components/general/document-signing/document-signing-signature-field.tsx`, possibly a new hook

Once a recipient draws their signature on the first signature field, reuse it for all subsequent signature fields in the same document (or the bundled W-9 + contract + ACH packet). Avoids redraw on phone.

- [ ] On signature save, write the data URL to `sessionStorage` under key `documenso:lastSignature`
- [ ] On signature field mount, if `sessionStorage` has a value AND this field is empty, pre-populate it (but let user clear and redraw)
- [ ] Clear the key when the document is completed
- [ ] Commit: `patch(signing): reuse last drawn signature across fields in session`

---

## Wave 3 — Webhook reliability

### Task 3.1: Don't fire `document.created` webhook on first send

**Files:** `packages/lib/server-only/webhooks/trigger/*.ts` — find the dispatcher that fires `DOCUMENT_CREATED`

The D2DHQ app writes its local `RepDocumentEnvelope` row AFTER `distribute_document` returns. Documenso fires `document.created` immediately when the doc is uploaded, before D2DHQ has saved the envelope ID. Result: every send produces a "unknown documentId — ignoring" log entry on the D2DHQ side. Harmless but noisy.

Two options:
- (A) Stop firing `DOCUMENT_CREATED` at all on this fork (D2DHQ only cares about `sent` / `viewed` / `signed`)
- (B) Debounce 1s before firing

**Decision: (A).** Cleanest. D2DHQ doesn't subscribe to `document.created` anyway.

- [ ] Find the call site (`packages/lib/server-only/webhooks/trigger/*`)
- [ ] Comment out or remove the `DOCUMENT_CREATED` dispatch
- [ ] Add a regression test if a webhook unit test file exists
- [ ] Commit: `patch(webhooks): stop firing document.created — d2dhq doesn't consume it`

### Task 3.2: Exponential-backoff retry on webhook 5xx

**Files:** `packages/lib/server-only/webhooks/execute-webhook-call.ts`

Currently webhooks are fire-and-forget. If D2DHQ is briefly down (deploy in progress), webhooks are lost. Add retry with backoff on non-2xx responses.

- [ ] Inspect the existing call function — what does it do today?
- [ ] If no retry: add a 3-attempt retry with delays `[500ms, 2s, 5s]`
- [ ] Skip retries for 4xx (client errors are usually permanent)
- [ ] Log each retry attempt with the attempt number + status code
- [ ] Add a Vitest unit test that mocks fetch and asserts retry behavior
- [ ] Commit: `patch(webhooks): retry 3x with exponential backoff on 5xx`

---

## Wave 4 — Compliance

### Task 4.1: Geo-block signing pages to US IPs only

**Files:** `apps/remix/app/routes/_recipient+/sign.$token+/_index.tsx` loader (and `complete.tsx` loader)

D2DHQ is a US-only platform. Signers outside the US are almost certainly fraudulent — block them with a polite 403.

- [ ] Read country from `request.cf?.country` (Cloudflare Worker header on `sign.d2dhq.com`)
- [ ] If country is set AND not `US`, throw a 403 response with a "this page is available in the US only" message
- [ ] If country is unset (local dev, non-CF deploy), allow through — don't break dev
- [ ] Add a Vitest test for the loader
- [ ] Commit: `patch(security): geo-block signing pages to US IPs only`

---

## Deferred — needs its own session + D2DHQ coordination

These four items each require coordinated changes in both the Documenso fork (schema + API) AND the D2DHQ FastAPI app (caller code). They deserve focused planning:

- **#12 Single "send packet" endpoint** — new tRPC procedure + envelope-group schema + D2DHQ caller refactor. Estimated 4-6h focused work.
- **#13 Idempotency keys on upload_document** — new DB column + middleware + D2DHQ retry-key propagation. Estimated 2-3h.
- **#14 Per-document tags** — Prisma schema migration + tag-by-key query helpers + D2DHQ tag-emitter. Estimated 2-3h.
- **#15 Sign-on-behalf audit field** — Prisma schema migration + auth context wiring + D2DHQ admin-user passthrough. Estimated 3-4h.

**Recommendation:** Ship Waves 1–4 first, get production signal on the white-label/UX improvements, then plan #12–#15 against actual usage data (which one is most painful in practice).

---

## Operator notes (post-deploy)

After this lands on `sign.d2dhq.com`, set these env vars in Dokploy:

```
NEXT_PUBLIC_BACK_TO_APP_URL=https://www.d2dhq.com
NEXT_PRIVATE_SMTP_FROM_NAME=D2DHQ Documents
NEXT_PRIVATE_SMTP_FROM_ADDRESS=docs@d2dhq.com
```

And rebuild.

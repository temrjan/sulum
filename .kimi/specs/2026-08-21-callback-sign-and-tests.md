# Spec: Multicard callback sign verification + regression test + vitest suite

Date: 2026-08-21
Branch: `feat/callback-verify-and-tests`
Approved scope: Captain, 2026-08-21 («Да, скоуп 1–6», «Чини до тестов»)

## 1. Problem (verified facts)

- `POST /api/v1/payments/callback` activates a premium subscription for any body containing `invoice_id` — `validateCallback` (`src/services/multicard.service.ts:221`) checks field presence only, no signature.
- `invoiceId` format is `sulum_<userId>_<planKey>_<Date.now()>` (`subscription.service.ts:132`) — enumerable.
- Official Multicard docs (<https://docs.multicard.uz/callback-success-19729300e0>):
  - Callback body carries `sign = md5("{store_id}{invoice_id}{amount}{secret}")` (concatenation, no separators).
  - Merchant MUST verify `sign` (or IP-whitelist 195.158.26.90).
  - Non-200 response or `success != true` → payment is CANCELLED, funds returned to payer.
  - Timeout/HTTP 500 → Multicard freezes the transaction and RETRIES the callback; repeated callback for an already-paid invoice must return success (idempotency).
- Current idempotency exists at payment level: `processPaymentCallback` returns `true` if `payment.status === COMPLETED` (`subscription.service.ts:218`). Kept as-is.
- Units: `payment.amount` in DB is **sums** (`plan.price`, subscription.service.ts:139); callback `amount` is **tiyin** (we send `sumsToTiyin` on invoice creation, multicard.service.ts:164). Comparison: `Number(body.amount) === Number(payment.amount) * 100`.
- `MULTICARD_SECRET` and `MULTICARD_STORE_ID` already exist in prod `.env` — no new env vars needed.

## 2. Fix design (minimal)

### 2.1 `multicard.service.ts` — `validateCallback` rewrite

Multicard has TWO sign schemes selected by store setting `callback_scheme` (source: pay-uz `MulticardDriver.php:136-156`); which one this store uses is NOT verified, so BOTH are accepted — both are keyed by the same `config.secret`, accepting either does not weaken verification:

- `success` scheme: `md5("{store_id}{invoice_id}{amount}{secret}")`
- `webhooks` scheme (default per pay-uz): `sha1("{uuid}{invoice_id}{amount}{secret}")`

```ts
validateCallback(body: Record<string, unknown>): boolean {
  if (!body || typeof body !== 'object') return false;
  const { store_id, invoice_id, amount, uuid, sign } = body;
  if (!store_id || !invoice_id || !amount || typeof sign !== 'string') return false;
  if (Number(store_id) !== config.storeId) return false;
  const received = sign.toLowerCase();
  const candidates = [
    crypto.createHash('md5').update(`${store_id}${invoice_id}${amount}${config.secret}`).digest('hex'),
    crypto.createHash('sha1').update(`${uuid ?? ''}${invoice_id}${amount}${config.secret}`).digest('hex'),
  ];
  return candidates.some(
    (expected) =>
      expected.length === received.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)),
  );
}
```

- `amount` from the callback is integer **tiyin** (confirmed by pay-uz `verifyWebhook`).
- Return type stays `boolean`; route logic changes per 2.2.

### 2.2 `payment.routes.ts` — callback route

- Validation failure → `400 {"success": false, "message": "Invalid signature"}` (docs response shape; non-200 → Multicard cancels a forged/invalid payment — desired).
- On valid sign: `processPaymentCallback` return widened from `boolean` to `'activated' | 'already_completed' | 'not_found'` (single caller — this route; verified by Grep). `'not_found'` → `404 {"success": false, "message": "Не найден инвойс"}` (docs show this exact message surfaces to the payer). Current bug fixed here: route returns 200 `{success:true}` even when payment is not found (payment.routes.ts:80).
- Amount check: mismatch between `body.amount` (tiyin) and `payment.amount * 100` → `400`, no activation. Placement: inside `processPaymentCallback` (service owns payment integrity) — route passes `amount` through.
- Telegram success notification fires ONLY on `'activated'` — repeated Multicard retries (`'already_completed'`) return 200 `{success: true}` without re-notifying (docs: callbacks are retried on timeout/500).
- **Bug fix folded in:** `process.env.BOT_TOKEN` → `process.env.TELEGRAM_BOT_TOKEN` (payment.routes.ts:68). Prod `.env` has only `TELEGRAM_BOT_TOKEN` (verified via ssh) — the success notification has never been sent.
- Signature is verified BEFORE any DB write. A forged callback never reaches activation.

### 2.3 What does NOT change

- Idempotency by payment status (kept; now surfaced as `'already_completed'`).
- `createPayment` / `createInvoice` flow, OFD payload, retry logic.
- No schema migrations, no new env vars, no new dependencies for the fix.
- No server-side status reconciliation call to Multicard (status endpoint path undocumented — pay-uz marks it UNCERTAIN; sign + amount check is sufficient).

## 3. Regression test (testing skill rule №0 — red first)

File: `tests/payment-callback.test.ts` (supertest against the Express app, service layer mocked at Prisma boundary):

1. **RED→GREEN:** callback with real-format `invoice_id`, correct `store_id`/`amount` but missing/invalid `sign` → must NOT activate subscription, HTTP 400. On current code this test FAILS (activation happens) — that red run is the proof the hole existed.
2. Valid `sign` (md5 success-scheme, computed with test secret) + known pending payment → activates, HTTP 200, `{success: true}`.
3. Valid sha1 webhooks-scheme sign (uuid-based) → also accepted, activates.
4. Uppercase sign hex → accepted (case-insensitive compare).
5. Repeat same valid callback → 200 again, subscription not extended twice, Telegram notification NOT re-sent (idempotency).
6. Valid sign but amount mismatch → 400, no activation.
7. Valid sign, unknown invoice_id → 404 `{"success": false, "message": "Не найден инвойс"}`.
8. Wrong store_id with otherwise valid sign inputs → 400.

## 4. Test suite (approved scope 1–6)

1. **Infra:** `vitest` + `supertest` + `@vitest/coverage-v8` (devDeps); `npm test` / `npm run test:coverage` scripts; CI step in `.github/workflows/ci.yml` after type check (gate, no `|| true`).
2. **`multicard.service`:** `sumsToTiyin`, `validateCallback` table (valid / bad sign / missing fields / wrong store), token cache (second call no re-auth), retry backoff (axios mocked at boundary).
3. **`subscription.service`:** `createPayment` (unknown user, unknown plan, happy), `processPaymentCallback` idempotency, `activateSubscription` date math (fake timers). Prisma mocked with `vitest-mock-extended` (real Postgres in unit tests = slow and brittle; integration covered via route test with mocked Prisma). **Decision point, noted:** chose mock over testcontainers for speed in CI; integration proof of the real DB path stays the prod-verified history (2 COMPLETED payments).
4. **`payment.routes`:** supertest — 400 garbage, 404 unknown id, happy path, idempotent repeat.
5. **`chat-history`:** TTL refresh, trim to 20, corrupt JSON → empty. Redis via `ioredis-mock`.
6. **Zod validators** (`auth.validator`, `user.validator`): accept/reject tables incl. gender enum boundary.

Explicitly OUT of scope: bot handlers (grammy mocking — separate circle), `voiceService` (OpenRouter rewrite pending), OpenAI/Together key issues, admin-token-in-git (Captain decision: leave).

## 5. Gates

- Red run of regression test shown BEFORE the fix (rule №0 proof).
- `npx tsc --noEmit` green, `npm test` green — full output attached to report.
- `/review` clean (no blocking/important) → report → Captain «добро» → push → CI green → merge.
- Deploy is automatic on merge to `main` (existing pipeline).

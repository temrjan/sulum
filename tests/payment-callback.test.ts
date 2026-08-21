import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

// ─── Shared Prisma mock (routes and services each call `new PrismaClient()`) ──

const mPayment = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};
const mSubscription = {
  upsert: vi.fn(),
  update: vi.fn(),
};

const mPrisma = {
  payment: mPayment,
  subscription: mSubscription,
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mPrisma)),
};

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return {
    ...actual,
    PrismaClient: class {
      constructor() {
        return mPrisma;
      }
    },
  };
});

// ─── Grammy mock: capture Telegram notifications ───

const mSendMessage = vi.fn();
vi.mock('grammy', () => ({
  Bot: class {
    api = { sendMessage: mSendMessage };
  },
}));

// ─── Env must be set before importing modules that read config at import time ──

const STORE_ID = 2750;
const SECRET = 'test-multicard-secret';
process.env.MULTICARD_STORE_ID = String(STORE_ID);
process.env.MULTICARD_SECRET = SECRET;
process.env.MULTICARD_APPLICATION_ID = 'test-app-id';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';

const express = (await import('express')).default;
const request = (await import('supertest')).default;
const { paymentRouter } = await import('../src/routes/payment.routes');

const app = express();
app.use(express.json());
app.use('/api/v1/payments', paymentRouter);

// ─── Fixtures ───

const INVOICE_ID = 'sulum_user1_MONTHLY_1700000000000';
const AMOUNT_SUMS = 50000;
const AMOUNT_TIYIN = AMOUNT_SUMS * 100;

function pendingPayment() {
  return {
    id: 'pay1',
    userId: 'user1',
    invoiceId: INVOICE_ID,
    amount: AMOUNT_SUMS,
    status: 'PENDING',
    metadata: { planKey: 'MONTHLY', telegramId: '12345' },
    user: { telegramId: BigInt(12345), language: 'ru' },
  };
}

interface CallbackOverrides {
  sign?: string;
  store_id?: number;
  amount?: number;
  invoice_id?: string;
  uuid?: string;
}

function md5Sign(storeId: number, invoiceId: string, amount: number): string {
  return crypto.createHash('md5').update(`${storeId}${invoiceId}${amount}${SECRET}`).digest('hex');
}

function sha1Sign(uuid: string, invoiceId: string, amount: number): string {
  return crypto.createHash('sha1').update(`${uuid}${invoiceId}${amount}${SECRET}`).digest('hex');
}

function makeCallback(overrides: CallbackOverrides = {}) {
  const base = {
    store_id: STORE_ID,
    amount: AMOUNT_TIYIN,
    invoice_id: INVOICE_ID,
    uuid: 'e60d8ebc-b9fe-11ef-b159-005056b4367d',
  };
  const merged = { ...base, ...overrides };
  const sign = overrides.sign ?? md5Sign(merged.store_id, merged.invoice_id, merged.amount);
  return { ...merged, sign };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/payments/callback', () => {
  it('should reject callback without valid sign and NOT activate subscription', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send(makeCallback({ sign: 'forged' }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should reject callback with no sign field at all', async () => {
    const body = makeCallback();
    delete (body as Record<string, unknown>).sign;

    const res = await request(app).post('/api/v1/payments/callback').send(body);

    expect(res.status).toBe(400);
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should activate subscription on valid md5 (success-scheme) sign and notify user once', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send(makeCallback());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mSubscription.upsert).toHaveBeenCalledTimes(1);
    expect(mSendMessage).toHaveBeenCalledTimes(1);
  });

  it('should also accept sha1 (webhooks-scheme) sign', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());
    const uuid = 'uuid-webhooks-scheme';
    const body = makeCallback({ uuid, sign: sha1Sign(uuid, INVOICE_ID, AMOUNT_TIYIN) });

    const res = await request(app).post('/api/v1/payments/callback').send(body);

    expect(res.status).toBe(200);
    expect(mSubscription.upsert).toHaveBeenCalledTimes(1);
  });

  it('should accept uppercase sign hex', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());
    const body = makeCallback({ sign: md5Sign(STORE_ID, INVOICE_ID, AMOUNT_TIYIN).toUpperCase() });

    const res = await request(app).post('/api/v1/payments/callback').send(body);

    expect(res.status).toBe(200);
    expect(mSubscription.upsert).toHaveBeenCalledTimes(1);
  });

  it('should be idempotent: repeated callback returns 200 without re-activation and without re-notifying', async () => {
    mPayment.findUnique.mockResolvedValue({ ...pendingPayment(), status: 'COMPLETED' });

    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send(makeCallback());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mSubscription.upsert).not.toHaveBeenCalled();
    expect(mSendMessage).not.toHaveBeenCalled();
  });

  it('should reject when callback amount does not match payment record', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());
    const wrongAmount = AMOUNT_TIYIN - 100;

    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send(makeCallback({ amount: wrongAmount }));

    expect(res.status).toBe(400);
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should return 404 per Multicard docs when invoice is unknown', async () => {
    mPayment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send(makeCallback());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Не найден инвойс' });
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should reject callback for a foreign store_id', async () => {
    const foreignStore = 999999;
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send(makeCallback({
        store_id: foreignStore,
        sign: md5Sign(foreignStore, INVOICE_ID, AMOUNT_TIYIN),
      }));

    expect(res.status).toBe(400);
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });
});

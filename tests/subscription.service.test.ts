import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PaymentStatus } from '@prisma/client';

// ─── Shared Prisma mock (service calls `new PrismaClient()`) ──

const mUser = {
  findUnique: vi.fn(),
};
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
  user: mUser,
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

// ─── Multicard service mocked at the module boundary (no network) ──

const mIsConfigured = vi.fn<() => boolean>(() => true);
const mCreateInvoice = vi.fn();

vi.mock('../src/services/multicard.service', () => ({
  multicardService: {
    isConfigured: mIsConfigured,
    createInvoice: mCreateInvoice,
  },
}));

const { subscriptionService, SUBSCRIPTION_PLANS } = await import(
  '../src/services/subscription.service'
);

// ─── Fixtures ───

const TELEGRAM_ID = BigInt(12345);
const USER = { id: 'user1', telegramId: TELEGRAM_ID, language: 'ru' };

function pendingPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay1',
    userId: 'user1',
    invoiceId: 'sulum_user1_MONTHLY_1700000000000',
    amount: SUBSCRIPTION_PLANS.MONTHLY.price,
    status: PaymentStatus.PENDING,
    metadata: { planKey: 'MONTHLY', telegramId: TELEGRAM_ID.toString() },
    user: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mIsConfigured.mockReturnValue(true);
  mPayment.create.mockResolvedValue({ id: 'pay1' });
  mCreateInvoice.mockResolvedValue({
    success: true,
    data: {
      uuid: 'uuid-1',
      checkout_url: 'https://pay.example/checkout',
      short_link: 'https://pay.example/s',
      invoice_id: 'x',
      amount: 1,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('subscriptionService.createPayment', () => {
  it('should fail without touching the DB when the plan is unknown', async () => {
    const result = await subscriptionService.createPayment({
      telegramId: TELEGRAM_ID,
      planKey: 'NOPE' as keyof typeof SUBSCRIPTION_PLANS,
    });

    expect(result.success).toBe(false);
    expect(mUser.findUnique).not.toHaveBeenCalled();
    expect(mPayment.create).not.toHaveBeenCalled();
  });

  it('should fail when the user is unknown', async () => {
    mUser.findUnique.mockResolvedValue(null);

    const result = await subscriptionService.createPayment({
      telegramId: TELEGRAM_ID,
      planKey: 'MONTHLY',
    });

    expect(result.success).toBe(false);
    expect(mPayment.create).not.toHaveBeenCalled();
  });

  it('should create a pending payment with plan price and sulum invoice id on happy path', async () => {
    mUser.findUnique.mockResolvedValue(USER);

    const result = await subscriptionService.createPayment({
      telegramId: TELEGRAM_ID,
      planKey: 'MONTHLY',
    });

    expect(result).toEqual({ success: true, checkoutUrl: 'https://pay.example/checkout' });
    expect(mPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user1',
          amount: SUBSCRIPTION_PLANS.MONTHLY.price,
          currency: 'UZS',
          status: PaymentStatus.PENDING,
          invoiceId: expect.stringMatching(/^sulum_user1_MONTHLY_\d+$/),
        }),
      }),
    );
  });

  it('should pass the invoice id and plan price to Multicard', async () => {
    mUser.findUnique.mockResolvedValue(USER);

    await subscriptionService.createPayment({ telegramId: TELEGRAM_ID, planKey: 'WEEKLY' });

    expect(mCreateInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: expect.stringMatching(/^sulum_user1_WEEKLY_\d+$/),
        amountSums: SUBSCRIPTION_PLANS.WEEKLY.price,
      }),
    );
  });

  it('should mark the payment FAILED when invoice creation throws', async () => {
    mUser.findUnique.mockResolvedValue(USER);
    mCreateInvoice.mockRejectedValue(new Error('network down'));

    const result = await subscriptionService.createPayment({
      telegramId: TELEGRAM_ID,
      planKey: 'DAILY',
    });

    expect(result.success).toBe(false);
    expect(mPayment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { status: PaymentStatus.FAILED },
    });
  });
});

describe('subscriptionService.processPaymentCallback', () => {
  it('should return not_found when no payment matches the invoice', async () => {
    mPayment.findUnique.mockResolvedValue(null);

    const result = await subscriptionService.processPaymentCallback('unknown', 'paid');

    expect(result).toBe('not_found');
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should return already_completed and not re-activate a completed payment', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment({ status: PaymentStatus.COMPLETED }));

    const result = await subscriptionService.processPaymentCallback('inv', 'paid');

    expect(result).toBe('already_completed');
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should return amount_mismatch when callback tiyin does not match stored sums', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());
    const wrongTiyin = SUBSCRIPTION_PLANS.MONTHLY.price * 100 - 100;

    const result = await subscriptionService.processPaymentCallback('inv', 'paid', wrongTiyin);

    expect(result).toBe('amount_mismatch');
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should return amount_mismatch when paid callback omits the amount (fail-closed)', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const result = await subscriptionService.processPaymentCallback('inv', 'paid');

    expect(result).toBe('amount_mismatch');
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should activate the subscription on a paid callback with matching amount', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const result = await subscriptionService.processPaymentCallback(
      'inv',
      'paid',
      SUBSCRIPTION_PLANS.MONTHLY.price * 100,
    );

    expect(result).toBe('activated');
    expect(mSubscription.upsert).toHaveBeenCalledTimes(1);
  });

  it('should mark the payment FAILED on a failed-status callback', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const result = await subscriptionService.processPaymentCallback('inv', 'failed');

    expect(result).toBe('updated');
    expect(mPayment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { status: PaymentStatus.FAILED },
    });
    expect(mSubscription.upsert).not.toHaveBeenCalled();
  });

  it('should ignore unknown callback statuses without writes', async () => {
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const result = await subscriptionService.processPaymentCallback('inv', 'pending');

    expect(result).toBe('ignored');
    expect(mSubscription.upsert).not.toHaveBeenCalled();
    expect(mPayment.update).not.toHaveBeenCalled();
  });
});

describe('subscriptionService.activateSubscription (via processPaymentCallback)', () => {
  it('should set subscription endDate to now + plan days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    const result = await subscriptionService.processPaymentCallback(
      'inv',
      'paid',
      SUBSCRIPTION_PLANS.MONTHLY.price * 100,
    );

    expect(result).toBe('activated');

    const expectedEnd = new Date('2026-01-15T12:00:00.000Z');
    expectedEnd.setDate(expectedEnd.getDate() + SUBSCRIPTION_PLANS.MONTHLY.days);

    const upsertArg = mSubscription.upsert.mock.calls[0][0] as {
      update: { endDate: Date };
      create: { endDate: Date };
    };
    expect(upsertArg.create.endDate).toEqual(expectedEnd);
    expect(upsertArg.update.endDate).toEqual(expectedEnd);
  });

  it('should mark the payment COMPLETED inside the same transaction', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
    mPayment.findUnique.mockResolvedValue(pendingPayment());

    await subscriptionService.processPaymentCallback(
      'inv',
      'paid',
      SUBSCRIPTION_PLANS.MONTHLY.price * 100,
    );

    expect(mPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay1' },
        data: expect.objectContaining({ status: PaymentStatus.COMPLETED }),
      }),
    );
  });
});

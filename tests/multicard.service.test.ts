import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

// ─── Axios mock at the module boundary ───

type AxiosPost = (url: string, payload?: unknown, config?: unknown) => Promise<{ data: unknown }>;
const mAxiosPost = vi.fn<AxiosPost>();

vi.mock('axios', () => ({
  default: { post: mAxiosPost },
}));

// ─── Env must be set before importing modules that read config at import time ──

const STORE_ID = 2750;
const SECRET = 'test-multicard-secret';
process.env.MULTICARD_STORE_ID = String(STORE_ID);
process.env.MULTICARD_SECRET = SECRET;
process.env.MULTICARD_APPLICATION_ID = 'test-app-id';

const { MulticardService, multicardService } = await import('../src/services/multicard.service');

// ─── Helpers ───

function md5Sign(storeId: number, invoiceId: string, amount: number): string {
  return crypto.createHash('md5').update(`${storeId}${invoiceId}${amount}${SECRET}`).digest('hex');
}

function sha1Sign(uuid: string, invoiceId: string, amount: number): string {
  return crypto.createHash('sha1').update(`${uuid}${invoiceId}${amount}${SECRET}`).digest('hex');
}

function authResponse() {
  return Promise.resolve({ data: { token: 'test-bearer-token' } });
}

function invoiceResponse(invoiceId: string, amountTiyin: number) {
  return Promise.resolve({
    data: {
      success: true,
      data: {
        uuid: 'uuid-1',
        checkout_url: 'https://pay.example/checkout',
        short_link: 'https://pay.example/s',
        invoice_id: invoiceId,
        amount: amountTiyin,
      },
    },
  });
}

function invoiceCalls() {
  return mAxiosPost.mock.calls.filter((c) => String(c[0]).endsWith('/payment/invoice'));
}

function authCalls() {
  return mAxiosPost.mock.calls.filter((c) => String(c[0]).endsWith('/auth'));
}

beforeEach(() => {
  mAxiosPost.mockReset();
});

describe('multicardService.validateCallback', () => {
  const body = {
    store_id: STORE_ID,
    invoice_id: 'sulum_user1_MONTHLY_1700000000000',
    amount: 5000000,
    uuid: 'e60d8ebc-b9fe-11ef-b159-005056b4367d',
  };

  it('should accept valid md5 (success-scheme) sign', () => {
    const sign = md5Sign(body.store_id, body.invoice_id, body.amount);
    expect(multicardService.validateCallback({ ...body, sign })).toBe(true);
  });

  it('should accept valid sha1 (webhooks-scheme) sign', () => {
    const sign = sha1Sign(body.uuid, body.invoice_id, body.amount);
    expect(multicardService.validateCallback({ ...body, sign })).toBe(true);
  });

  it('should accept uppercase sign hex', () => {
    const sign = md5Sign(body.store_id, body.invoice_id, body.amount).toUpperCase();
    expect(multicardService.validateCallback({ ...body, sign })).toBe(true);
  });

  it('should reject a forged sign', () => {
    expect(multicardService.validateCallback({ ...body, sign: 'forged' })).toBe(false);
  });

  it('should reject when sign field is missing', () => {
    expect(multicardService.validateCallback({ ...body })).toBe(false);
  });

  it('should reject when invoice_id is missing', () => {
    const sign = md5Sign(body.store_id, body.invoice_id, body.amount);
    const { invoice_id: _omitted, ...rest } = body;
    expect(multicardService.validateCallback({ ...rest, sign })).toBe(false);
  });

  it('should reject when amount is missing', () => {
    const sign = md5Sign(body.store_id, body.invoice_id, body.amount);
    const { amount: _omitted, ...rest } = body;
    expect(multicardService.validateCallback({ ...rest, sign })).toBe(false);
  });

  it('should reject a foreign store_id even with a self-consistent sign', () => {
    const foreignStore = 999999;
    const sign = md5Sign(foreignStore, body.invoice_id, body.amount);
    expect(
      multicardService.validateCallback({ ...body, store_id: foreignStore, sign }),
    ).toBe(false);
  });

  it('should reject non-object input', () => {
    expect(multicardService.validateCallback(null as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('MulticardService.createInvoice', () => {
  it('should convert sums to tiyin in the invoice payload', async () => {
    const service = new MulticardService();
    mAxiosPost.mockImplementation((url) =>
      String(url).endsWith('/auth') ? authResponse() : invoiceResponse('inv-sums', 5000000),
    );

    const result = await service.createInvoice({
      invoiceId: 'inv-sums',
      amountSums: 50000,
      description: 'Test',
    });

    expect(result.success).toBe(true);
    const call = invoiceCalls()[0];
    expect(call[1]).toMatchObject({
      store_id: STORE_ID,
      invoice_id: 'inv-sums',
      amount: 50000 * 100,
    });
  });

  it('should cache the bearer token across consecutive invoices', async () => {
    const service = new MulticardService();
    mAxiosPost.mockImplementation((url) =>
      String(url).endsWith('/auth') ? authResponse() : invoiceResponse('inv', 100),
    );

    await service.createInvoice({ invoiceId: 'inv-1', amountSums: 100, description: 'A' });
    await service.createInvoice({ invoiceId: 'inv-2', amountSums: 100, description: 'B' });

    expect(authCalls()).toHaveLength(1);
    expect(invoiceCalls()).toHaveLength(2);
  });

  it('should retry on 503 and resolve when a later attempt succeeds', async () => {
    const service = new MulticardService();
    let invoiceAttempts = 0;
    mAxiosPost.mockImplementation((url) => {
      if (String(url).endsWith('/auth')) return authResponse();
      invoiceAttempts += 1;
      if (invoiceAttempts < 3) {
        return Promise.reject(new MulticardHttpError(503));
      }
      return invoiceResponse('inv-retry', 100);
    });

    const result = await service.createInvoice({
      invoiceId: 'inv-retry',
      amountSums: 100,
      description: 'Retry',
    });

    expect(result.success).toBe(true);
    expect(invoiceAttempts).toBe(3);
  });

  it('should throw after exhausting all attempts when every call fails', async () => {
    const service = new MulticardService();
    mAxiosPost.mockImplementation((url) =>
      String(url).endsWith('/auth')
        ? authResponse()
        : Promise.reject(new MulticardHttpError(503)),
    );

    await expect(
      service.createInvoice({ invoiceId: 'inv-fail', amountSums: 100, description: 'Fail' }),
    ).rejects.toMatchObject({ response: { status: 503 } });

    expect(invoiceCalls()).toHaveLength(3);
  });

  it('should not retry a non-retryable 400 error', async () => {
    const service = new MulticardService();
    mAxiosPost.mockImplementation((url) =>
      String(url).endsWith('/auth')
        ? authResponse()
        : Promise.reject(new MulticardHttpError(400)),
    );

    await expect(
      service.createInvoice({ invoiceId: 'inv-400', amountSums: 100, description: 'Bad' }),
    ).rejects.toMatchObject({ response: { status: 400 } });

    expect(invoiceCalls()).toHaveLength(1);
  });
});

class MulticardHttpError extends Error {
  response: { status: number };
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.response = { status };
  }
}

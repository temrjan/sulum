import { logger } from '../utils/logger';
/**
 * Multicard Payment Gateway Service for Sulum
 * Интеграция с Multicard API для приема платежей в Узбекистане
 */

import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// ========== CONFIG ==========

const config = {
  apiUrl: process.env.MULTICARD_API_URL || 'https://mesh.multicard.uz',
  applicationId: process.env.MULTICARD_APPLICATION_ID || '',
  secret: process.env.MULTICARD_SECRET || '',
  storeId: parseInt(process.env.MULTICARD_STORE_ID || '0', 10),
  serviceMxik: process.env.MULTICARD_SERVICE_MXIK || '',
  callbackUrl: process.env.MULTICARD_CALLBACK_URL || '',
  returnUrl: process.env.MULTICARD_RETURN_URL || '',
};

// ========== TYPES ==========

interface CreateInvoiceParams {
  invoiceId: string;    // Наш уникальный ID
  amountSums: number;   // Сумма в СУМАХ
  description: string;  // Описание платежа
  lang?: string;
}

interface InvoiceResponse {
  success: boolean;
  data?: {
    uuid: string;
    checkout_url: string;
    short_link: string;
    invoice_id: string;
    amount: number;
  };
  error?: unknown;
}

// Multicard API response types
interface MulticardAuthResponse {
  token?: string;
  data?: { token?: string };
}

interface MulticardInvoiceApiResponse {
  success: boolean;
  data?: {
    uuid: string;
    checkout_url: string;
    short_link: string;
    invoice_id: string;
    amount: number;
  };
}

// ========== SERVICE ==========

class MulticardService {
  private tokenCache: { token: string | null; expiresAt: number } = {
    token: null,
    expiresAt: 0,
  };

  private readonly AUTH_TIMEOUT_MS = 20000;
  private readonly INVOICE_TIMEOUT_MS = 20000;
  private readonly AUTH_ATTEMPTS = 3;
  private readonly INVOICE_ATTEMPTS = 3;
  private readonly BASE_DELAY_MS = 300;
  private readonly RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
  private readonly RETRY_CODES = new Set([
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETUNREACH',
  ]);

  constructor() {
    logger.info('MulticardService initialized', {
      apiUrl: config.apiUrl,
      storeId: config.storeId,
      hasCredentials: !!(config.applicationId && config.secret),
    });
  }

  /**
   * Проверить готовность сервиса (MXIK опционален)
   */
  isConfigured(): boolean {
    return !!(
      config.applicationId &&
      config.secret &&
      config.storeId
    );
  }

  /**
   * Получить Bearer токен для аутентификации
   */
  private async getBearer(): Promise<string> {
    if (this.tokenCache.token && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    logger.info('Requesting new Multicard auth token');

    try {
      const response = await this.postWithRetries<MulticardAuthResponse>(
        `${config.apiUrl}/auth`,
        {
          application_id: config.applicationId,
          secret: config.secret,
        },
        { 'Content-Type': 'application/json' },
        {
          attempts: this.AUTH_ATTEMPTS,
          timeoutMs: this.AUTH_TIMEOUT_MS,
        }
      );

      const token = response.data.token || response.data.data?.token;

      if (!token) {
        throw new Error('Auth failed: no token in response');
      }

      this.tokenCache.token = token;
      this.tokenCache.expiresAt = Date.now() + 23 * 60 * 60 * 1000;

      logger.info('Multicard auth token obtained successfully');
      return token;
    } catch (error) {
      logger.error('Multicard auth failed', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Multicard authentication failed: ${errMsg}`);
    }
  }

  /**
   * Создать инвойс для оплаты подписки
   */
  async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResponse> {
    const { invoiceId, amountSums, description, lang = 'ru' } = params;

    logger.info('Creating Multicard invoice', { invoiceId, amountSums });

    if (!this.isConfigured()) {
      throw new Error('Multicard is not configured. Check env variables.');
    }

    const bearer = await this.getBearer();
    const idempotencyKey = invoiceId;
    const requestId = crypto.randomUUID();

    const payload: Record<string, unknown> = {
      store_id: config.storeId,
      amount: this.sumsToTiyin(amountSums),
      invoice_id: invoiceId,
      lang,
      return_url: config.returnUrl,
      callback_url: config.callbackUrl,
    };

    // OFD данные добавляем только если есть MXIK код
    if (config.serviceMxik) {
      payload.ofd = [{
        qty: 1,
        price: this.sumsToTiyin(amountSums),
        total: this.sumsToTiyin(amountSums),
        mxik: config.serviceMxik,
        package_code: "",
        name: description,
      }];
    }

    try {
      const response = await this.postWithRetries<MulticardInvoiceApiResponse>(
        `${config.apiUrl}/payment/invoice`,
        payload,
        {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'X-Request-Id': requestId,
        },
        {
          attempts: this.INVOICE_ATTEMPTS,
          timeoutMs: this.INVOICE_TIMEOUT_MS,
        }
      );

      if (response.data.success && response.data.data) {
        logger.info('Multicard invoice created', {
          invoiceId,
          uuid: response.data.data.uuid,
        });

        return {
          success: true,
          data: response.data.data,
        };
      } else {
        throw new Error('Invoice creation failed');
      }
    } catch (error) {
      logger.error('Multicard invoice creation failed', { invoiceId, error });
      throw error;
    }
  }

  /**
   * Валидировать callback от Multicard
   */
  validateCallback(body: Record<string, unknown>): boolean {
    if (!body || typeof body !== 'object') {
      return false;
    }
    return !!(body.invoice_id || body.invoice_uuid);
  }

  private sumsToTiyin(sums: number): number {
    return Math.round(Number(sums) * 100);
  }

  private async postWithRetries<T>(
    url: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    options: { attempts: number; timeoutMs: number }
  ): Promise<{ data: T }> {
    const { attempts, timeoutMs } = options;

    for (let tryNo = 1; tryNo <= attempts; tryNo++) {
      try {
        const response = await axios.post<T>(url, payload, {
          headers,
          timeout: timeoutMs,
        });
        return { data: response.data };
      } catch (error) {
        const isLastAttempt = tryNo >= attempts;

        if (isLastAttempt || !this.shouldRetry(error)) {
          throw error;
        }

        const jitter = Math.floor(Math.random() * 100);
        const delay = this.BASE_DELAY_MS * Math.pow(2, tryNo - 1) + jitter;

        logger.warn(`POST retry ${tryNo}/${attempts} in ${delay}ms`, { url });
        await this.sleep(delay);
      }
    }

    throw new Error('Unreachable');
  }

  private shouldRetry(error: unknown): boolean {
    const err = error as { response?: { status?: number }; code?: string } | null;
    const status = err?.response?.status;
    if (status && this.RETRY_STATUSES.has(status)) {
      return true;
    }

    const code = err?.code;
    if (code && this.RETRY_CODES.has(code)) {
      return true;
    }

    if (!err?.response) {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const multicardService = new MulticardService();
export { MulticardService, CreateInvoiceParams, InvoiceResponse };

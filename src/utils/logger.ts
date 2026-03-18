import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    env: process.env.NODE_ENV,
  },
});

// Convenience methods for structured logging
export const log = {
  info: (msg: string, data?: object) => logger.info(data, msg),
  error: (msg: string, error?: unknown, data?: object) => {
    if (error instanceof Error) {
      logger.error({ err: error, ...data }, msg);
    } else {
      logger.error({ error, ...data }, msg);
    }
  },
  warn: (msg: string, data?: object) => logger.warn(data, msg),
  debug: (msg: string, data?: object) => logger.debug(data, msg),
};

export default logger;

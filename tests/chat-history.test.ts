import { describe, it, expect, vi } from 'vitest';

// ─── Redis mock at the module boundary ───

vi.mock('ioredis', async () => {
  const mod = await import('ioredis-mock');
  return { default: mod.default };
});

const history = await import('../src/services/chat-history');
const RedisMock = (await import('ioredis-mock')).default;

// Each test uses its own userId so the shared in-memory store stays isolated.

describe('chat-history', () => {
  it('should return an empty array when there is no history', async () => {
    expect(await history.getChatHistory('user-empty')).toEqual([]);
  });

  it('should return an added message with role and content', async () => {
    const userId = 'user-add';
    await history.addToHistory(userId, 'user', 'salom');

    const messages = await history.getChatHistory(userId);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'salom' });
    expect(typeof messages[0].timestamp).toBe('number');
  });

  it('should set a positive TTL when storing history', async () => {
    const userId = 'user-ttl';
    await history.addToHistory(userId, 'user', 'hello');

    const ttl = await history.getHistoryTTL(userId);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(7200);
  });

  it('should keep only the last 20 messages after adding 25', async () => {
    const userId = 'user-trim';
    for (let i = 1; i <= 25; i++) {
      await history.addToHistory(userId, 'user', `msg-${i}`);
    }

    const messages = await history.getChatHistory(userId);

    expect(messages).toHaveLength(20);
    expect(messages[0].content).toBe('msg-6');
    expect(messages[19].content).toBe('msg-25');
  });

  it('should return an empty array when stored data is corrupt JSON', async () => {
    const userId = 'user-corrupt';
    const redis = new RedisMock();
    await redis.set(`chat:history:${userId}`, '{not valid json');

    expect(await history.getChatHistory(userId)).toEqual([]);
  });

  it('should empty the history after clearHistory', async () => {
    const userId = 'user-clear';
    await history.addToHistory(userId, 'assistant', 'answer');

    await history.clearHistory(userId);

    expect(await history.getChatHistory(userId)).toEqual([]);
  });
});

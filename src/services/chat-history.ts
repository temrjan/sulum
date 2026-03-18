import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// TTL: 2 hours (7200 seconds)
const HISTORY_TTL = 7200;
const MAX_MESSAGES = 20;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Get chat history for a user session
 */
export async function getChatHistory(userId: string): Promise<ChatMessage[]> {
  const key = `chat:history:${userId}`;
  const data = await redis.get(key);
  
  if (!data) return [];
  
  try {
    const messages = JSON.parse(data) as ChatMessage[];
    // Refresh TTL on access
    await redis.expire(key, HISTORY_TTL);
    return messages.slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

/**
 * Add message to chat history
 */
export async function addToHistory(
  userId: string, 
  role: 'user' | 'assistant', 
  content: string
): Promise<void> {
  const key = `chat:history:${userId}`;
  
  // Get existing history
  const history = await getChatHistory(userId);
  
  // Add new message
  history.push({
    role,
    content,
    timestamp: Date.now()
  });
  
  // Keep only last N messages
  const trimmed = history.slice(-MAX_MESSAGES);
  
  // Save with TTL
  await redis.setex(key, HISTORY_TTL, JSON.stringify(trimmed));
}

/**
 * Clear chat history (start new session)
 */
export async function clearHistory(userId: string): Promise<void> {
  const key = `chat:history:${userId}`;
  await redis.del(key);
}

/**
 * Get history TTL remaining (for debugging)
 */
export async function getHistoryTTL(userId: string): Promise<number> {
  const key = `chat:history:${userId}`;
  return await redis.ttl(key);
}

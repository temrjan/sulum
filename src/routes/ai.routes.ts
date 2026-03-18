import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { queryRag } from '../services/rag-client';
import { SYSTEM_PROMPT } from '../config/system-prompt';
import { getChatHistory, addToHistory, clearHistory } from '../services/chat-history';

const router = Router();

// Request body types
interface ChatBody {
  question: string;
  user_id?: string;
  new_session?: boolean;
}

interface ClearHistoryBody {
  user_id: string;
}

// AI Chat endpoint with Redis-based history
router.post('/chat', async (req: Request<unknown, unknown, ChatBody>, res: Response) => {
  try {
    const { question, user_id, new_session } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({
        error: 'Question is required and must be a string'
      });
    }

    let chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // If user_id provided, use Redis for history
    if (user_id) {
      // Clear history if new session requested
      if (new_session) {
        await clearHistory(user_id);
      }
      
      // Get existing history
      chatHistory = await getChatHistory(user_id);
      
      // Save user message
      await addToHistory(user_id, 'user', question);
    }

    // Get answer from RAG system with history
    const result = await queryRag(question, chatHistory, "ru", SYSTEM_PROMPT);

    // Save assistant response
    if (user_id) {
      await addToHistory(user_id, 'assistant', result.answer);
    }

    res.json({
      answer: result.answer,
      sources: result.sources,
      history_length: chatHistory.length + 2, // including current exchange
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('AI Chat error:', error);
    res.status(500).json({
      error: 'Failed to process your question',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear chat history (start new session)
router.post('/chat/clear', async (req: Request<unknown, unknown, ClearHistoryBody>, res: Response) => {
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      res.status(400).json({ error: 'user_id is required' });
    }
    
    await clearHistory(user_id);
    res.json({ success: true, message: 'Chat history cleared' });
  } catch {
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

export { router as aiRouter };

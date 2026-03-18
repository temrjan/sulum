import { Context, SessionFlavor } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';
import { I18nFlavor } from '@grammyjs/i18n';

// Chat message for history
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Session data interface
export interface SessionData {
  language: string;
  userId?: string;
  currentStep?: string;
  tempData?: Record<string, unknown>;
  // Chat memory
  chatHistory: ChatMessage[];
  messageCount: number;
  // Bot message IDs for cleanup
  botMessageIds: number[];
  // Last menu message ID (to delete on next menu click)
  lastMenuMessageId?: number;
}

// Context type with all flavors
export type MyContext =
  Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context> &
  I18nFlavor;

// User state enum
export enum UserState {
  IDLE = 'idle',
  REGISTRATION = 'registration',
  PROFILE_SETUP = 'profile_setup',
  WAITING_FOR_INPUT = 'waiting_for_input'
}

// Callback data types
export interface CallbackData {
  action: string;
  data?: Record<string, unknown>;
}

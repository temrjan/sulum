import { logger } from '../utils/logger';
import OpenAI from 'openai';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface VoiceProcessResult {
  transcript: string;
  response: string;
  audioResponse: Buffer;
}


/**
 * Service for voice message processing (STT + TTS).
 */
export class VoiceService {
  private readonly tempDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp');
    void this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    if (!existsSync(this.tempDir)) {
      await mkdir(this.tempDir, { recursive: true });
    }
  }

  /**
   * Speech-to-Text: Convert voice to text via Whisper API.
   */
  async transcribeVoice(audioBuffer: Buffer, userId: string): Promise<string> {
    const tempFilePath = path.join(this.tempDir, `voice_${userId}_${Date.now()}.ogg`);

    try {
      await writeFile(tempFilePath, audioBuffer);

      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'text',
      });

      return transcription.trim();
    } catch (error: unknown) {
      logger.error('[VoiceService] Transcription error:', error);
      throw new Error('Failed to transcribe voice');
    } finally {
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Text-to-Speech: Convert text to voice via OpenAI TTS.
   */
  async synthesizeSpeech(text: string): Promise<Buffer> {
    try {
      const mp3Response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: text,
        speed: 1.0,
      });

      const buffer = Buffer.from(await mp3Response.arrayBuffer());
      return buffer;
    } catch (error: unknown) {
      logger.error('[VoiceService] TTS error:', error);
      throw new Error('Failed to synthesize speech');
    }
  }

  /**
   * Full voice message processing pipeline.
   */
  async processVoiceMessage(
    audioBuffer: Buffer,
    userId: string,
    ragCallback: (text: string) => Promise<string>,
  ): Promise<VoiceProcessResult> {
    const startTime = Date.now();

    // 1. Transcribe voice
    logger.info(`[Voice] Transcribing for user ${userId}...`);
    const transcript = await this.transcribeVoice(audioBuffer, userId);
    logger.info(`[Voice] Transcript (${transcript.length} chars): ${transcript.substring(0, 100)}...`);

    // 2. Get RAG response
    logger.info('[Voice] Getting RAG response...');
    const response = await ragCallback(transcript);
    logger.info(`[Voice] Response (${response.length} chars): ${response.substring(0, 100)}...`);

    // 3. Synthesize speech
    logger.info('[Voice] Synthesizing speech...');
    const audioResponse = await this.synthesizeSpeech(response);

    const processingTime = Date.now() - startTime;
    logger.info(`[Voice] Processing completed in ${processingTime}ms`);

    return {
      transcript,
      response,
      audioResponse,
    };
  }

  /**
   * Detect language in voice message.
   */
  async detectLanguage(audioBuffer: Buffer, userId: string): Promise<'ru' | 'uz'> {
    const tempFilePath = path.join(this.tempDir, `detect_${userId}_${Date.now()}.ogg`);

    try {
      await writeFile(tempFilePath, audioBuffer);

      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'verbose_json',
      });

      const result = transcription as unknown as { language?: string };
      return result.language === 'uz' ? 'uz' : 'ru';
    } catch (error: unknown) {
      logger.error('[VoiceService] Language detection error:', error);
      return 'ru';
    } finally {
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Cleanup old temporary files.
   */
  async cleanupOldFiles(olderThanMinutes: number = 60): Promise<void> {
    const now = Date.now();
    const fs = await import('fs');

    try {
      const files = fs.readdirSync(this.tempDir);

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        const ageMinutes = (now - stats.mtimeMs) / 1000 / 60;

        if (ageMinutes > olderThanMinutes) {
          await unlink(filePath);
          logger.info(`[VoiceService] Cleaned up old file: ${file}`);
        }
      }
    } catch (error: unknown) {
      logger.error('[VoiceService] Cleanup error:', error);
    }
  }
}

export const voiceService = new VoiceService();

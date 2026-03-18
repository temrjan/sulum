/**
 * RAG Service HTTP client.
 *
 * Replaces local Qdrant + LangChain + LLM logic with a single
 * HTTP call to the shared RAG Service.
 */

import { logger } from "../utils/logger";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://rag-service:8000";
const RAG_SERVICE_API_KEY = process.env.RAG_SERVICE_API_KEY || "";
const PRODUCT_ID = process.env.PRODUCT_ID || "sulum";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RagSource {
  text: string;
  score: number;
  source_file: string;
}

interface RagResponse {
  answer: string;
  sources: RagSource[];
  model: string;
}

export async function queryRag(
  query: string,
  chatHistory: ChatMessage[] = [],
  lang: string = "ru",
  systemPrompt: string = "",
): Promise<RagResponse> {
  const url = `${RAG_SERVICE_URL}/api/v1/query`;

  const body = {
    product_id: PRODUCT_ID,
    query,
    top_k: 5,
    lang,
    chat_history: chatHistory.map((m) => ({ role: m.role, content: m.content })),
    system_prompt: systemPrompt,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAG_SERVICE_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(`RAG Service error ${res.status}: ${text}`);
    throw new Error(`RAG Service returned ${res.status}`);
  }

  return (await res.json()) as RagResponse;
}

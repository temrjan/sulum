/**
 * Document ingestion script.
 *
 * Reads .md/.txt files from documents/ or documents_uz/ and sends them
 * to the RAG Service /api/v1/ingest endpoint.
 *
 * Usage:
 *   npx tsx src/load-documents.ts             # Russian docs
 *   npx tsx src/load-documents.ts --lang=uz   # Uzbek docs
 */

import { logger } from "./utils/logger";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://rag-service:8000";
const RAG_SERVICE_API_KEY = process.env.RAG_SERVICE_API_KEY || "";
const PRODUCT_ID = process.env.PRODUCT_ID || "sulum";

const args = process.argv.slice(2);
const langArg = args.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1] : "ru";

const DOCUMENTS_DIR =
  LANG === "uz"
    ? path.join(process.cwd(), "documents_uz")
    : path.join(process.cwd(), "documents");

interface IngestDocument {
  text: string;
  metadata: Record<string, string | number>;
}

async function ingest(documents: IngestDocument[]): Promise<void> {
  const url = `${RAG_SERVICE_URL}/api/v1/ingest`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAG_SERVICE_API_KEY}`,
    },
    body: JSON.stringify({
      product_id: PRODUCT_ID,
      documents,
      lang: LANG,
      chunk_size: 1024,
      chunk_overlap: 200,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ingest failed ${res.status}: ${text}`);
  }

  const result = (await res.json()) as { ingested: number; collection: string };
  logger.info(`Ingested ${result.ingested} chunks into ${result.collection}`);
}

async function main(): Promise<void> {
  logger.info(`Loading documents (${LANG}) from ${DOCUMENTS_DIR}`);

  if (!fs.existsSync(DOCUMENTS_DIR)) {
    logger.error(`Directory not found: ${DOCUMENTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DOCUMENTS_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return [".txt", ".md"].includes(ext);
  });

  if (files.length === 0) {
    logger.error("No .txt/.md files found");
    process.exit(1);
  }

  logger.info(`Found ${files.length} files`);

  const documents: IngestDocument[] = files.map((file) => {
    const filePath = path.join(DOCUMENTS_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    logger.info(`  ${file} (${content.length} chars)`);
    return {
      text: content,
      metadata: { source_file: file, lang: LANG },
    };
  });

  await ingest(documents);
  logger.info("Done!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error("Error:", err);
    process.exit(1);
  });

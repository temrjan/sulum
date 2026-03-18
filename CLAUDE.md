# Sulum — AI Psychology Consultant

## Stack

| Component | Tech |
|-----------|------|
| Bot | grammyJS + TypeScript |
| API | Express.js + TypeScript |
| DB | Prisma + PostgreSQL (shared on 7demo) |
| RAG | rag-service (shared on 7demo) |
| Deploy | Docker + docker-compose + Caddy |

## Commands

```bash
npm install
npm run dev            # tsx watch
npx tsc --noEmit       # type check
```

## Server

- Host: 7demo (62.169.20.2:9281)
- Path: /root/server/products/product-sulum
- Container: product-sulum
- Domain: sulum.7demo.uz (Caddy)

## Rules

- Follow Codex standards (~/Codex/standards/)
- No code editing on server — only through pipeline
- TypeScript strict, no `any`

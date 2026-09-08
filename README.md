# Sulum — AI Psychological Consultant

AI-консультант по психологии в Telegram: RAG на базе корпуса текстов классиков
психотерапии. Отвечает строго в рамках базы знаний — модель не импровизирует
за её пределами. Русский и узбекский языки.

**Живой бот:** [@Sulum_bot](https://t.me/Sulum_bot)

## Knowledge base

Корпус из 12 школ психотерапии, в двух языковых редакциях (`documents/` — RU,
`documents_uz/` — UZ): Frankl (logotherapy), Rogers (client-centered), Beck (CBT),
Ellis (REBT), Yalom (existential), Linehan (DBT), Erickson, Bowlby (attachment),
Perls (gestalt), Hayes (ACT), Satir (family). Плюс манифест проекта, протоколы
ответов и RAG-индекс.

## Stack

- **Bot:** [grammY](https://grammy.dev) + conversations + i18n (RU/UZ)
- **Backend:** Express 5, thin client over a RAG core
- **AI:** OpenAI (chat + embeddings)
- **Data:** PostgreSQL (Prisma 6), Redis
- **Security:** helmet, express-rate-limit, bcrypt, JWT, zod-валидация
- **Tests/CI:** vitest, GitHub Actions
- **Deploy:** Docker, docker-compose

## Development

```bash
npm install
cp .env.example .env          # configure tokens and DB
npm run prisma:migrate
npm run load-docs             # load knowledge base (RU)
npm run load-docs:uz          # load knowledge base (UZ)
npm run bot:dev               # run the Telegram bot in watch mode
npm test                      # vitest
```

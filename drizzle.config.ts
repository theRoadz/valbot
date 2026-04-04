import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit always runs from project root via npm scripts
const dbPath = process.env.VALBOT_DB_PATH || path.resolve(process.cwd(), 'valbot.db');

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dbCredentials: {
    url: dbPath,
  },
});

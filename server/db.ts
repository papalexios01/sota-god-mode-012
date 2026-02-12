// server/db.ts
// SOTA God Mode - Database Connection v3.0

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    pool.on("error", (err) => {
      console.error("[DB] Unexpected pool error:", err.message);
    });

    db = drizzle(pool, { schema });
    console.log("[DB] ✅ PostgreSQL pool created");
  } catch (err) {
    console.error("[DB] ❌ Failed to create pool:", err);
    pool = null;
    db = null;
  }
} else {
  console.warn(
    "[DB] DATABASE_URL not set. Blog post API routes will be disabled. Using Supabase client for persistence.",
  );
}

export { pool, db };

import "reflect-metadata";
import { DataSource, Logger as OrmLogger, QueryRunner } from "typeorm";
import { ALL_MODELS } from "../models";
import { scoped } from "../utils/logger";
import { env } from "./env";

const log = scoped("db");
const short = (q: string) => q.replace(/\s+/g, " ").slice(0, 500);

/** Sends TypeORM output to the app logger: errors always, slow queries as warnings, every query only when DB_LOGGING=true. */
class DbLogger implements OrmLogger {
  logQuery(query: string, parameters?: unknown[], _qr?: QueryRunner) {
    if (env.db.logging) log.debug(short(query), { params: parameters?.length });
  }
  logQueryError(
    error: string | Error,
    query: string,
    _parameters?: unknown[],
    _qr?: QueryRunner,
  ) {
    log.error("Query failed", {
      error: error instanceof Error ? error.message : error,
      query: short(query),
    });
  }
  logQuerySlow(
    time: number,
    query: string,
    _parameters?: unknown[],
    _qr?: QueryRunner,
  ) {
    log.warn(`Slow query (${time}ms)`, {
      durationMs: time,
      query: short(query),
    });
  }
  logSchemaBuild(message: string) {
    log.debug(message);
  }
  logMigration(message: string) {
    log.info(message);
  }
  log(level: "log" | "info" | "warn", message: unknown) {
    log.log(level === "log" ? "debug" : level, String(message));
  }
}

export const AppDataSource = new DataSource({
  type: "postgres",

  // Use Neon when DATABASE_URL is configured; otherwise use local PostgreSQL.
  ...(env.db.url
    ? { url: env.db.url }
    : {
        host: env.db.host,
        port: env.db.port,
        username: env.db.user,
        password: env.db.password,
        database: env.db.name,
      }),

  ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
  entities: ALL_MODELS,
  synchronize: env.db.sync,
  logging: true,
  logger: new DbLogger(),
  maxQueryExecutionTime: env.db.slowQueryMs,
});

/** Shorthand for a model's repository. */
export const repo = AppDataSource.getRepository.bind(AppDataSource);

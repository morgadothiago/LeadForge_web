import { assertTestDatabase } from "./db-guard";

// Roda antes de qualquer teste: aborta a suíte se DATABASE_URL não for de um banco *_test.
assertTestDatabase(process.env.DATABASE_URL);

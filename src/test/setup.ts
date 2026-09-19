import { vi } from "vitest";
import { testHeaders, testCookies } from "@/lib/auth/test-helpers";

// next/headers só funciona em request; nos testes usamos um jar explícito (ver test-helpers).
vi.mock("next/headers", () => ({
  cookies: async () => testCookies,
  headers: async () => testHeaders.current,
}));

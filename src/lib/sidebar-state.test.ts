import { describe, expect, it } from "vitest";
import { parseSidebarDefaultOpen } from "./sidebar-state";

describe("parseSidebarDefaultOpen", () => {
  it("true por padrão (cookie ausente) e com 'true'", () => {
    expect(parseSidebarDefaultOpen(undefined)).toBe(true);
    expect(parseSidebarDefaultOpen("true")).toBe(true);
  });
  it("false apenas com 'false'", () => {
    expect(parseSidebarDefaultOpen("false")).toBe(false);
  });
});

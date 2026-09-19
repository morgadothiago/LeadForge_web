import { describe, expect, it } from "vitest";
import { connectionTransition, decideDisconnectPause } from "./health";

const T0 = new Date("2026-06-10T13:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const GRACE = 10 * 60_000;

describe("máquina de estados da conexão (pura)", () => {
  it("queda simples: marca o início, sem pausa imediata", () => {
    const t = connectionTransition({ status: "connected", disconnectedAt: null }, "disconnected", T0);
    expect(t).toEqual({ disconnectedAt: T0 });
  });
  it("blip de 2 min não pausa; 15 min pausa", () => {
    const inst = { status: "disconnected", disconnectedAt: T0 };
    expect(decideDisconnectPause(inst, at(2), GRACE)).toBeNull();
    expect(decideDisconnectPause(inst, at(9), GRACE)).toBeNull();
    expect(decideDisconnectPause(inst, at(15), GRACE)).toMatchObject({ hours: 48 });
  });
  it("logout confirmado pausa na hora (48 h)", () => {
    const t = connectionTransition({ status: "connected", disconnectedAt: null }, "disconnected", T0, true);
    expect(t.pauseNow).toMatchObject({ hours: 48 });
  });
  it("reconectou antes: zera, sem pausa, 1 warning; reconexão sem queda registrada não avisa", () => {
    expect(connectionTransition({ status: "disconnected", disconnectedAt: T0 }, "connected", at(3))).toEqual({ disconnectedAt: null, warnReconnected: true });
    expect(connectionTransition({ status: "connected", disconnectedAt: null }, "connected", at(4)).warnReconnected).toBe(false);
    expect(decideDisconnectPause({ status: "connected", disconnectedAt: null }, at(60), GRACE)).toBeNull();
  });
  it("eventos repetidos não reiniciam o relógio; não-conectada -> desconectada não inicia queda", () => {
    expect(connectionTransition({ status: "disconnected", disconnectedAt: T0 }, "disconnected", at(5))).toEqual({ disconnectedAt: T0 });
    expect(connectionTransition({ status: "connecting", disconnectedAt: null }, "disconnected", T0).disconnectedAt).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventStore } from "./store.js";
import type { Mailer } from "./mailer.js";

function testEnv() {
  const store = new EventStore();
  const sent: { to: string; name: string }[] = [];
  const mailer: Mailer = {
    async sendPromotion(m) {
      sent.push({ to: m.to, name: m.name });
    },
  };
  const { app } = createApp({ store, mailer });
  store.createEvent("e1", "テスト会場", 1);
  return { app, sent };
}

describe("Hono キャンセル待ちAPI", () => {
  it("要件1: 定員超過は待機になる (参加+未定どちらも椅子消費)", async () => {
    const { app } = testEnv();
    const r1 = await app.request("/api/events/e1/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", email: "a@e.com", intent: "maybe" }),
    });
    expect(r1.status).toBe(201);
    expect((await r1.json()) as { status: string }).toMatchObject({ status: "confirmed" });

    const r2 = await app.request("/api/events/e1/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "B", email: "b@e.com", intent: "attending" }),
    });
    const b = (await r2.json()) as { status: string; position: number };
    expect(b.status).toBe("waitlisted");
    expect(b.position).toBe(1);
  });

  it("要件2+3: キャンセルで先頭繰り上げ+メール送信", async () => {
    const { app, sent } = testEnv();
    const a = (await (await app.request("/api/events/e1/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", email: "a@e.com", intent: "attending" }),
    })).json()) as { participant: { id: string } };
    await app.request("/api/events/e1/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "B", email: "b@e.com", intent: "maybe" }),
    });

    const del = await app.request(`/api/events/e1/rsvps/${a.participant.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const body = (await del.json()) as {
      promotions: { email: string }[];
      chairsNeeded: number;
    };
    expect(body.promotions.map((p) => p.email)).toEqual(["b@e.com"]);
    expect(sent.map((s) => s.to)).toEqual(["b@e.com"]);

    const state = (await (await app.request("/api/events/e1")).json()) as {
      chairsNeeded: number;
      confirmed: { email: string }[];
      waitlist: unknown[];
    };
    expect(state.confirmed.map((p) => p.email)).toEqual(["b@e.com"]);
    expect(state.waitlist).toEqual([]);
    expect(state.chairsNeeded).toBe(1);
  });

  it("バリデーション: 不正な intent / email は 400", async () => {
    const { app } = testEnv();
    const bad = await app.request("/api/events/e1/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "not-an-email", intent: "attending" }),
    });
    expect(bad.status).toBe(400);
  });
});

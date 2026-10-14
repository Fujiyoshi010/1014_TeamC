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

describe("03 一覧と集計", () => {
  function datedEnv(eventDate: string) {
    const store = new EventStore();
    const sent: { to: string; name: string }[] = [];
    const mailer: Mailer = {
      async sendPromotion(m) {
        sent.push({ to: m.to, name: m.name });
      },
    };
    const { app } = createApp({ store, mailer });
    store.createEvent("e2", "定例会", 10, eventDate);
    return { app, sent };
  }

  it("要件1: 集計は参加のみ。未定は数えない（椅子数とは別）", async () => {
    const { app } = datedEnv("2099-12-20");
    for (const [name, email, intent] of [
      ["A", "a@e.com", "attending"],
      ["B", "b@e.com", "attending"],
      ["C", "c@e.com", "maybe"],
    ]) {
      await app.request("/api/events/e2/rsvps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, intent }),
      });
    }
    const s = (await (await app.request("/api/events/e2/summary")).json()) as {
      attendingCount: number;
      maybeCount: number;
      chairsNeeded: number;
      participants: { name: string }[];
    };
    expect(s.attendingCount).toBe(2);
    expect(s.maybeCount).toBe(1);
    expect(s.chairsNeeded).toBe(3);
    expect(s.participants.map((p) => p.name).sort()).toEqual(["A", "B"]);
  });

  it("要件2: 変更履歴が全件残る（いつ・誰が・何に変えたか）", async () => {
    const { app } = datedEnv("2099-12-20");
    await app.request("/api/events/e2/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", email: "a@e.com", intent: "maybe" }),
    });
    const h = (await (await app.request("/api/events/e2/history")).json()) as {
      actor: string;
      from: string | null;
      to: string;
      at: string;
    }[];
    expect(h).toHaveLength(1);
    expect(h[0].actor).toBe("A");
    expect(h[0].from).toBeNull();
    expect(h[0].to).toContain("maybe");
    expect(typeof h[0].at).toBe("string");
  });

  it("要件3: 締切（開催日前日23:59）後は確定し、変更・繰り上げなし", async () => {
    const { app } = datedEnv("2000-01-02");
    const s = (await (await app.request("/api/events/e2/summary")).json()) as {
      fixedClosed: boolean;
      finalized: boolean;
      participants: unknown[];
    };
    expect(s.fixedClosed).toBe(true);
    expect(s.finalized).toBe(true);
    const post = await app.request("/api/events/e2/rsvps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Z", email: "z@e.com", intent: "attending" }),
    });
    expect(post.status).toBe(403);
  });
});

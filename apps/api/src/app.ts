import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  applyCapacityChange,
  cancelParticipant,
  countChairs,
  getWaitlist,
  registerParticipant,
  type Participant,
  type RsvpIntent,
} from "@opencd/waitlist";
import { EventStore } from "./store.js";
import { InMemoryMailer, type Mailer } from "./mailer.js";

export interface AppEnv {
  store: EventStore;
  mailer: Mailer;
}

export function createApp(env?: Partial<AppEnv>) {
  const store = env?.store ?? new EventStore();
  const mailer = env?.mailer ?? new InMemoryMailer();
  const app = new Hono();

  app.use("*", cors());

  const isIntent = (v: unknown): v is RsvpIntent =>
    v === "attending" || v === "maybe";
  const isEmail = (v: unknown): v is string =>
    typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // デモ用 seed (GET前に叩かれても冪等)
  store.createEvent("demo", "会場イベント (定員2)", 2);

  /** イベント状態: 椅子数・確定・待機列をまとめて返す (React表示用) */
  app.get("/api/events/:eventId", (c) => {
    try {
      const e = store.getOrThrow(c.req.param("eventId"));
      const chairs = countChairs(e.participants);
      const waitlist = getWaitlist(e.participants);
      return c.json({
        id: e.id,
        name: e.name,
        capacity: e.capacity,
        chairsNeeded: chairs,
        freeSeats: Math.max(0, e.capacity - chairs),
        confirmed: e.participants.filter((p) => p.status === "confirmed"),
        waitlist: waitlist.map((p, i) => ({ ...p, position: i + 1 })),
      });
    } catch {
      return c.json({ error: "event not found" }, 404);
    }
  });

  app.post("/api/events", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { id, name, capacity } = body as {
      id?: string;
      name?: string;
      capacity?: number;
    };
    if (!id || !name || !Number.isInteger(capacity) || (capacity as number) < 0) {
      return c.json({ error: "id, name, capacity(non-negative int) required" }, 400);
    }
    try {
      const e = store.createEvent(id, name, capacity as number);
      return c.json(e, 201);
    } catch {
      return c.json({ error: "event already exists" }, 409);
    }
  });

  /**
   * 要件1: 申込受付。
   * 確定椅子数(参加+未定) < 定員 → confirmed、そうでなければ waitlisted(+position)。
   */
  app.post("/api/events/:eventId/rsvps", async (c) => {
    const eventId = c.req.param("eventId");
    const body = await c.req.json().catch(() => ({}));
    const { name, email, intent } = body as {
      name?: string;
      email?: string;
      intent?: string;
    };
    if (!name || !isEmail(email) || !isIntent(intent)) {
      return c.json(
        { error: "name, valid email, intent(attending|maybe) required" },
        400,
      );
    }
    try {
      const result = await store.withLock(eventId, () => {
        const e = store.getOrThrow(eventId);
        const r = registerParticipant(e.participants, e.capacity, {
          id: crypto.randomUUID(),
          name,
          email,
          intent,
          createdAt: new Date().toISOString(),
          seq: store.nextSeq(e),
        });
        e.participants = [...e.participants, r.participant];
        return r;
      });
      if (result.outcome === "confirmed") {
        return c.json({ status: "confirmed", participant: result.participant }, 201);
      }
      return c.json(
        {
          status: "waitlisted",
          participant: result.participant,
          position: result.position,
        },
        201,
      );
    } catch {
      return c.json({ error: "event not found" }, 404);
    }
  });

  /**
   * 要件2+3: キャンセル → 空きが出れば先頭を自動繰り上げ → メール通知。
   * メール送信失敗時は 500 ではなく participants の繰り上げ自体は確定させ、
   * warnings に積んで返す (繰り上げの取り消しはしない)。
   */
  app.delete("/api/events/:eventId/rsvps/:rsvpId", async (c) => {
    const eventId = c.req.param("eventId");
    const rsvpId = c.req.param("rsvpId");
    try {
      const out = await store.withLock(eventId, async () => {
        const e = store.getOrThrow(eventId);
        const r = cancelParticipant(e.participants, rsvpId, new Date().toISOString());
        e.participants = r.participants;
        const warnings: string[] = [];
        for (const pr of r.promotions) {
          try {
            await mailer.sendPromotion({
              to: pr.email,
              name: pr.name,
              eventId: e.id,
              eventName: e.name,
            });
          } catch (err) {
            warnings.push(
              `promotion mail failed for ${pr.email}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return { result: r, event: e, warnings };
      });
      if (!out.result.cancelled) return c.json({ error: "rsvp not found" }, 404);
      return c.json({
        cancelled: out.result.cancelled,
        promotions: out.result.promotions,
        warnings: out.warnings,
        chairsNeeded: countChairs(out.event.participants),
      });
    } catch {
      return c.json({ error: "event not found" }, 404);
    }
  });

  /** 管理用: 定員変更 → 増加分だけ自動繰り上げ+通知 */
  app.patch("/api/events/:eventId/capacity", async (c) => {
    const eventId = c.req.param("eventId");
    const body = await c.req.json().catch(() => ({}));
    const { capacity } = body as { capacity?: number };
    if (!Number.isInteger(capacity) || (capacity as number) < 0) {
      return c.json({ error: "capacity(non-negative int) required" }, 400);
    }
    try {
      const out = await store.withLock(eventId, async () => {
        const e = store.getOrThrow(eventId);
        const r = applyCapacityChange(
          e.participants,
          capacity as number,
          new Date().toISOString(),
        );
        e.participants = r.participants;
        e.capacity = capacity as number;
        for (const pr of r.promotions) {
          await mailer.sendPromotion({
            to: pr.email,
            name: pr.name,
            eventId: e.id,
            eventName: e.name,
          });
        }
        return r;
      });
      return c.json({ capacity, promotions: out.promotions });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("event not found"))
        return c.json({ error: "event not found" }, 404);
      throw e;
    }
  });

  return { app, store, mailer };
}

export type ApiApp = ReturnType<typeof createApp>["app"];

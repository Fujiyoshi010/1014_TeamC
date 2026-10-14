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

// ===== 03 一覧と集計（追加・04互換維持） =====

/** 開催日(YYYY-MM-DD)の前日23:59:59を締切とする。JST固定 */
export function getFixedDeadline(eventDate: string): Date {
  const midnightJst = new Date(`${eventDate}T00:00:00+09:00`);
  return new Date(midnightJst.getTime() - 24 * 3600 * 1000 + (23 * 3600 + 59 * 60 + 59) * 1000);
}

/** eventDate未設定 → 締切なし（false）。04既存イベントは影響なし */
export function isFixedClosed(eventDate: string | undefined, now = Date.now()): boolean {
  if (!eventDate) return false;
  return now > getFixedDeadline(eventDate).getTime();
}

/** 03-1: 集計は「参加」(attending確定)のみ。「未定」は数えない（椅子数とは別指標） */
export function countAttending(participants: readonly Participant[]): number {
  return participants.filter((p) => p.status === "confirmed" && p.intent === "attending").length;
}

export function countMaybeConfirmed(participants: readonly Participant[]): number {
  return participants.filter((p) => p.status === "confirmed" && p.intent === "maybe").length;
}

/** 03-3: 確定名簿。締切後はこのスナップショットで固定し、繰り上げしない */
export function attendingRoster(participants: readonly Participant[]): Participant[] {
  return participants
    .filter((p) => p.status === "confirmed" && p.intent === "attending")
    .sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.seq - b.seq,
    );
}

function isValidEventDate(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(`${v}T00:00:00+09:00`))
  );
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
        // 03追加（既存フィールドは無変更）
        ...(e.eventDate ? { eventDate: e.eventDate } : {}),
        fixedDeadline: e.eventDate ? getFixedDeadline(e.eventDate).toISOString() : null,
        fixedClosed: isFixedClosed(e.eventDate),
        attendingCount: countAttending(e.participants),
      });
    } catch {
      return c.json({ error: "event not found" }, 404);
    }
  });

  app.post("/api/events", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { id, name, capacity, eventDate } = body as {
      id?: string;
      name?: string;
      capacity?: number;
      eventDate?: unknown;
    };
    if (!id || !name || !Number.isInteger(capacity) || (capacity as number) < 0) {
      return c.json({ error: "id, name, capacity(non-negative int) required" }, 400);
    }
    if (eventDate !== undefined && !isValidEventDate(eventDate)) {
      return c.json({ error: "eventDate must be YYYY-MM-DD" }, 400);
    }
    try {
      const e = store.createEvent(
        id,
        name,
        capacity as number,
        eventDate !== undefined ? (eventDate as string) : undefined,
      );
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
      // 03-3: 開催日設定済みで締切後は名簿確定のため受付しない（未設定は従来通り）
      const existing = store.getOrThrow(eventId);
      if (isFixedClosed(existing.eventDate)) {
        return c.json({ error: "closed: 名簿は確定済みです（繰り上げなし）" }, 403);
      }
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
        // 03-2: 変更履歴に追記（いつ・誰が・何に変えたか）
        e.history.push({
          id: crypto.randomUUID(),
          eventId: e.id,
          at: new Date().toISOString(),
          actor: name,
          actorEmail: email,
          kind: "register",
          from: null,
          to: `${intent}(${r.outcome})`,
          detail: r.outcome === "waitlisted" ? `position ${r.position}` : undefined,
        });
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
      // 03-3: 締切後（開催日設定済みのみ）は名簿確定のため変更不可
      if (isFixedClosed(store.getOrThrow(eventId).eventDate)) {
        return c.json({ error: "closed: 名簿は確定済みです（繰り上げなし）" }, 403);
      }
      const out = await store.withLock(eventId, async () => {
        const e = store.getOrThrow(eventId);
        const r = cancelParticipant(e.participants, rsvpId, new Date().toISOString());
        e.participants = r.participants;
        const warnings: string[] = [];
        if (r.cancelled) {
          e.history.push({
            id: crypto.randomUUID(),
            eventId: e.id,
            at: new Date().toISOString(),
            actor: r.cancelled.name,
            actorEmail: r.cancelled.email,
            kind: "cancel",
            from: `${r.cancelled.intent}(${r.cancelled.status})`,
            to: "cancelled",
          });
        }
        for (const pr of r.promotions) {
          e.history.push({
            id: crypto.randomUUID(),
            eventId: e.id,
            at: new Date().toISOString(),
            actor: pr.name,
            actorEmail: pr.email,
            kind: "promote",
            from: "waitlisted",
            to: "confirmed",
          });
        }
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
        // 03-3: 締切後は定員変更も不可（名簿確定）
        if (isFixedClosed(e.eventDate)) {
          throw new Error("closed");
        }
        const r = applyCapacityChange(
          e.participants,
          capacity as number,
          new Date().toISOString(),
        );
        e.participants = r.participants;
        e.capacity = capacity as number;
        e.history.push({
          id: crypto.randomUUID(),
          eventId: e.id,
          at: new Date().toISOString(),
          actor: "organizer",
          kind: "capacity",
          from: null,
          to: `capacity=${capacity}`,
        });
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
      if (e instanceof Error && e.message === "closed")
        return c.json({ error: "closed: 名簿は確定済みです（繰り上げなし）" }, 403);
      if (e instanceof Error && e.message.startsWith("event not found"))
        return c.json({ error: "event not found" }, 404);
      throw e;
    }
  });

  // ===== 03 一覧と集計: 追加API（既存APIは無変更） =====

  /** 変更履歴: いつ・誰が・何に変えたか（新順） */
  app.get("/api/events/:eventId/history", (c) => {
    try {
      const e = store.getOrThrow(c.req.param("eventId"));
      return c.json([...e.history].sort((a, b) => b.at.localeCompare(a.at)));
    } catch {
      return c.json({ error: "event not found" }, 404);
    }
  });

  /**
   * 一覧+集計:
   * - attendingCount は「参加」確定のみ（未定は数えない）
   * - chairsNeeded は04互換（参加+未定の椅子数）のまま併記
   * - fixedClosed後は participants を確定名簿として返し、繰り上げしない
   */
  app.get("/api/events/:eventId/summary", (c) => {
    try {
      const e = store.getOrThrow(c.req.param("eventId"));
      const fixedClosed = isFixedClosed(e.eventDate);
      return c.json({
        id: e.id,
        name: e.name,
        capacity: e.capacity,
        ...(e.eventDate ? { eventDate: e.eventDate } : {}),
        fixedDeadline: e.eventDate ? getFixedDeadline(e.eventDate).toISOString() : null,
        fixedClosed,
        finalized: fixedClosed,
        attendingCount: countAttending(e.participants),
        maybeCount: countMaybeConfirmed(e.participants),
        chairsNeeded: countChairs(e.participants),
        participants: attendingRoster(e.participants),
        confirmed: e.participants.filter((p) => p.status === "confirmed"),
        waitlist: getWaitlist(e.participants),
      });
    } catch {
      return c.json({ error: "event not found" }, 404);
    }
  });

  return { app, store, mailer };
}

export type ApiApp = ReturnType<typeof createApp>["app"];

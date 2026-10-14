import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";

// ===== 型定義 =====

export type RsvpStatus = "attend" | "decline" | "maybe";

export interface Rsvp {
  name: string;
  status: RsvpStatus;
  updatedAt: string;
}

export interface EventItem {
  id: string;
  title: string;
  /** 開催日時 (ISO 8601) */
  datetime: string;
  /** 定員 */
  capacity: number;
  /** 回答締め切り (ISO 8601)。主催者がイベントごとに自由に決める */
  deadline: string;
  createdAt: string;
  /** 名前 -> 回答。名前だけで回答し、最後の回答で上書きする */
  rsvps: Record<string, Rsvp>;
}

const STATUSES: RsvpStatus[] = ["attend", "decline", "maybe"];

function isValidStatus(s: unknown): s is RsvpStatus {
  return typeof s === "string" && (STATUSES as string[]).includes(s);
}

function isValidDateString(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function countsOf(event: EventItem) {
  const list = Object.values(event.rsvps);
  return {
    attend: list.filter((r) => r.status === "attend").length,
    decline: list.filter((r) => r.status === "decline").length,
    maybe: list.filter((r) => r.status === "maybe").length,
    total: list.length,
  };
}

function toPublic(event: EventItem) {
  return {
    id: event.id,
    title: event.title,
    datetime: event.datetime,
    capacity: event.capacity,
    deadline: event.deadline,
    createdAt: event.createdAt,
    counts: countsOf(event),
    isClosed: Date.now() > Date.parse(event.deadline),
  };
}

function toDetail(event: EventItem) {
  return {
    ...toPublic(event),
    rsvps: Object.values(event.rsvps).sort((a, b) =>
      a.name.localeCompare(b.name, "ja"),
    ),
  };
}

// インメモリストア (プロセス内保持)
const events = new Map<string, EventItem>();

export const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

// ===== 01 イベントを作る =====

// 一覧
app.get("/api/events", (c) => {
  const list = [...events.values()]
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))
    .map(toPublic);
  return c.json(list);
});

// 作成: タイトル・開催日時・定員 (+ 締め切りは主催者が自由に決める)
app.post("/api/events", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { title, datetime, capacity, deadline } = body as {
    title?: unknown;
    datetime?: unknown;
    capacity?: unknown;
    deadline?: unknown;
  };

  if (typeof title !== "string" || title.trim() === "") {
    return c.json({ message: "タイトルは必須です" }, 400);
  }
  if (!isValidDateString(datetime)) {
    return c.json({ message: "開催日時は有効な日時を指定してください" }, 400);
  }
  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < 1
  ) {
    return c.json({ message: "定員は1以上の整数を指定してください" }, 400);
  }
  if (!isValidDateString(deadline)) {
    return c.json({ message: "締め切りは有効な日時を指定してください" }, 400);
  }

  const event: EventItem = {
    id: randomUUID(),
    title: title.trim(),
    datetime: new Date(datetime).toISOString(),
    capacity,
    deadline: new Date(deadline).toISOString(),
    createdAt: new Date().toISOString(),
    rsvps: {},
  };
  events.set(event.id, event);
  return c.json(toDetail(event), 201);
});

// 詳細
app.get("/api/events/:id", (c) => {
  const event = events.get(c.req.param("id"));
  if (!event) return c.json({ message: "イベントが見つかりません" }, 404);
  return c.json(toDetail(event));
});

// 定員変更: あとから増やせる。減らすことは不可にする
app.patch("/api/events/:id", async (c) => {
  const event = events.get(c.req.param("id"));
  if (!event) return c.json({ message: "イベントが見つかりません" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const { capacity } = body as { capacity?: unknown };

  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < 1
  ) {
    return c.json({ message: "定員は1以上の整数を指定してください" }, 400);
  }
  if (capacity < event.capacity) {
    return c.json(
      { message: `定員は減らせません (現在 ${event.capacity} 名)` },
      400,
    );
  }
  event.capacity = capacity;
  return c.json(toDetail(event));
});

// ===== 02 出欠を回答する =====

// 回答の登録・変更: 名前だけ。参加/不参加/未定の3択。締め切りまでは何度でも上書き可
app.post("/api/events/:id/rsvps", async (c) => {
  const event = events.get(c.req.param("id"));
  if (!event) return c.json({ message: "イベントが見つかりません" }, 404);

  if (Date.now() > Date.parse(event.deadline)) {
    return c.json({ message: "回答締め切りを過ぎているため変更できません" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const { name, status } = body as { name?: unknown; status?: unknown };

  if (typeof name !== "string" || name.trim() === "") {
    return c.json({ message: "名前は必須です" }, 400);
  }
  if (!isValidStatus(status)) {
    return c.json(
      { message: "参加・不参加・未定のいずれかを選んでください" },
      400,
    );
  }

  const key = name.trim();
  // 同じ名前なら最後の回答で上書き
  event.rsvps[key] = {
    name: key,
    status,
    updatedAt: new Date().toISOString(),
  };
  return c.json(toDetail(event));
});

const port = Number(process.env.PORT ?? 3001);

// テスト時に import されても listen しない
if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  });
}

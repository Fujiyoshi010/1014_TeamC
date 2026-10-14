export type RsvpStatus = "attend" | "decline" | "maybe";

export interface EventSummary {
  id: string;
  title: string;
  datetime: string;
  capacity: number;
  deadline: string;
  createdAt: string;
  counts: { attend: number; decline: number; maybe: number; total: number };
  isClosed: boolean;
}

export interface Rsvp {
  name: string;
  status: RsvpStatus;
  updatedAt: string;
}

export interface EventDetail extends EventSummary {
  rsvps: Rsvp[];
}

export interface HistoryEntry {
  id: string;
  eventId: string;
  name: string;
  from: RsvpStatus | null;
  to: RsvpStatus;
  at: string;
  actor: string;
}

export interface EventSummary03 extends EventDetail {
  fixedDeadline: string;
  fixedClosed: boolean;
  participants: Rsvp[];
  finalized: boolean;
}

export const STATUS_LABEL: Record<RsvpStatus, string> = {
  attend: "参加",
  decline: "不参加",
  maybe: "未定",
};

const BASE = import.meta.env.VITE_API_URL ?? "";

async function handle(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? "エラーが発生しました");
  }
  return data;
}

export const api = {
  listEvents: (): Promise<EventSummary[]> =>
    fetch(`${BASE}/api/events`).then(handle),
  getEvent: (id: string): Promise<EventDetail> =>
    fetch(`${BASE}/api/events/${id}`).then(handle),
  createEvent: (input: {
    title: string;
    datetime: string;
    capacity: number;
    deadline: string;
  }): Promise<EventDetail> =>
    fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(handle),
  updateCapacity: (id: string, capacity: number): Promise<EventDetail> =>
    fetch(`${BASE}/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity }),
    }).then(handle),
  answer: (
    id: string,
    input: { name: string; status: RsvpStatus },
  ): Promise<EventDetail> =>
    fetch(`${BASE}/api/events/${id}/rsvps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(handle),
  // 03 一覧と集計（追加・既存無変更）
  getHistory: (id: string): Promise<HistoryEntry[]> =>
    fetch(`${BASE}/api/events/${id}/history`).then(handle),
  getSummary03: (id: string): Promise<EventSummary03> =>
    fetch(`${BASE}/api/events/${id}/summary`).then(handle),
};

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** datetime-local の値を ISO に変換 */
export function localToISO(local: string): string {
  return new Date(local).toISOString();
}

/** ISO を datetime-local の初期値用に変換 */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

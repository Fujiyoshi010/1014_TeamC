import type { Participant } from "@opencd/waitlist";

export interface VenueEvent {
  id: string;
  name: string;
  capacity: number;
  participants: Participant[];
  seq: number;
  /** 開催日 (YYYY-MM-DD)。未設定の場合は締切なしとして扱う（04互換） */
  eventDate?: string;
  /** 03: 変更履歴（いつ・誰が・何に変えたか）。追記のみ */
  history: HistoryEntry[];
}

/** 03: 回答の変更履歴1件 */
export interface HistoryEntry {
  id: string;
  eventId: string;
  /** ISO8601 */
  at: string;
  /** 操作者名 */
  actor: string;
  actorEmail?: string;
  kind: "register" | "cancel" | "promote" | "capacity";
  /** 変更前（初回は null） */
  from: string | null;
  /** 変更後 */
  to: string;
  detail?: string;
}

export class EventStore {
  private events = new Map<string, VenueEvent>();

  getOrThrow(eventId: string): VenueEvent {
    const e = this.events.get(eventId);
    if (!e) throw new Error(`event not found: ${eventId}`);
    return e;
  }

  get(eventId: string): VenueEvent | undefined {
    return this.events.get(eventId);
  }

  createEvent(id: string, name: string, capacity: number, eventDate?: string): VenueEvent {
    if (this.events.has(id)) throw new Error(`event already exists: ${id}`);
    const e: VenueEvent = { id, name, capacity, participants: [], seq: 0, history: [] };
    if (eventDate) e.eventDate = eventDate;
    this.events.set(id, e);
    return e;
  }

  /** 単一イベント内の一連の então 読み書きを直列化するための簡易ロック */
  private locks = new Map<string, Promise<void>>();

  async withLock<T>(eventId: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.locks.get(eventId) ?? Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((r) => (release = r));
    this.locks.set(eventId, prev.then(() => cur));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(eventId) === cur) this.locks.delete(eventId);
    }
  }

  nextSeq(event: VenueEvent): number {
    event.seq += 1;
    return event.seq;
  }
}

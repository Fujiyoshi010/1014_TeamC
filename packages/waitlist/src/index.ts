/**
 * 04 キャンセル待ち ドメインロジック
 *
 * 要件:
 * 1. 椅子は「参加」と「未定」の合計で用意する。この合計が定員を超えたらキャンセル待ち。
 * 2. 空きが出たら、キャンセル待ちの先頭を自動で繰り上げ。
 * 3. 繰り上がった人にはメールで通知。
 *
 * このパッケージは要件1・2の純粋な状態遷移を担当する。
 * 要件3のメール送信は呼び出し側 (Hono) が `Promotion` 結果を受けて行う。
 */

/** 申込時の意思表示: 参加 / 未定 (いずれも椅子を1脚消費する) */
export type RsvpIntent = "attending" | "maybe";

/** 管理上の状態 */
export type ParticipantStatus = "confirmed" | "waitlisted" | "cancelled";

export interface Participant {
  id: string;
  name: string;
  email: string;
  /** 参加 or 未定 */
  intent: RsvpIntent;
  status: ParticipantStatus;
  /** FIFO順の基準。ISO8601 + 同時刻タイブレーク用の連番でソートする */
  createdAt: string;
  seq: number;
  promotedAt?: string;
}

export interface RegisterInput {
  id: string;
  name: string;
  email: string;
  intent: RsvpIntent;
  createdAt: string;
  seq: number;
}

export interface Promotion {
  participantId: string;
  email: string;
  name: string;
}

/** 椅子を消費する意思かどうか。要件1: 参加 + 未定 = 椅子数 */
export function consumesChair(intent: RsvpIntent): boolean {
  return intent === "attending" || intent === "maybe";
}

export function countChairs(participants: readonly Participant[]): number {
  return participants.filter(
    (p) => p.status === "confirmed" && consumesChair(p.intent),
  ).length;
}

export function getWaitlist(participants: readonly Participant[]): Participant[] {
  return [...participants]
    .filter((p) => p.status === "waitlisted")
    .sort((a, b) =>
      a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : a.seq - b.seq,
    );
}

export function getConfirmed(
  participants: readonly Participant[],
): Participant[] {
  return participants.filter((p) => p.status === "confirmed");
}

export type RegisterResult =
  | { outcome: "confirmed"; participant: Participant }
  | { outcome: "waitlisted"; participant: Participant; position: number };

/**
 * 要件1: 新規申込の振り分け。
 * confirmed の椅子数 (=参加+未定) が capacity 未満なら確定、そうでなければ末尾に待機。
 */
export function registerParticipant(
  participants: readonly Participant[],
  capacity: number,
  input: RegisterInput,
): RegisterResult {
  assertValidCapacity(capacity);
  const chairs = countChairs(participants);
  const base: Participant = {
    id: input.id,
    name: input.name,
    email: input.email,
    intent: input.intent,
    createdAt: input.createdAt,
    seq: input.seq,
    status: chairs < capacity ? "confirmed" : "waitlisted",
  };
  if (base.status === "confirmed") {
    return { outcome: "confirmed", participant: base };
  }
  const position = getWaitlist(participants).length + 1;
  return { outcome: "waitlisted", participant: base, position };
}

export interface CancelResult {
  participants: Participant[];
  /** 繰り上げ発生順 (先頭から)。呼び出し側はこの順でメール送信すること (要件3) */
  promotions: Promotion[];
  cancelled: Participant | undefined;
}

/**
 * 要件2: キャンセルによる空きの自動繰り上げ。
 * - 指定 id を cancelled にする (既に cancelled / 不明なら何もしない)
 * - キャンセル者が confirmed で椅子を消費していた場合のみ、先頭から1名を繰り上げ
 * - 繰り上げ対象は waitlisted の先頭 (createdAt, seq の昇順)
 *
 * 注意: intent が椅子を消費しない将来拡張に備え、consumesChair で判定している。
 * 現状 attending/maybe はどちらも true のため、confirmed のキャンセルは必ず1枠空ける。
 */
export function cancelParticipant(
  participants: readonly Participant[],
  id: string,
  nowIso: string,
): CancelResult {
  const target = participants.find((p) => p.id === id);
  if (!target || target.status === "cancelled") {
    return {
      participants: [...participants],
      promotions: [],
      cancelled: undefined,
    };
  }

  const freedChair =
    target.status === "confirmed" && consumesChair(target.intent);

  let next: Participant[] = participants.map((p) =>
    p.id === id ? { ...p, status: "cancelled" as const } : { ...p },
  );

  const promotions: Promotion[] = [];
  if (freedChair) {
    const head = getWaitlist(next)[0];
    if (head) {
      next = next.map((p) =>
        p.id === head.id
          ? { ...p, status: "confirmed" as const, promotedAt: nowIso }
          : p,
      );
      promotions.push({
        participantId: head.id,
        email: head.email,
        name: head.name,
      });
    }
  }

  const cancelled = next.find((p) => p.id === id);
  return { participants: next, promotions, cancelled };
}

export interface CapacityChangeResult {
  participants: Participant[];
  promotions: Promotion[];
}

/**
 * 定員変更時の再計算 (拡張用)。
 * capacity が増えた分だけ先頭から繰り上げ、減っても確定者は維持する
 * (椅子数が定員を上回る状態を許容し、新規のみ待機に回す)。
 */
export function applyCapacityChange(
  participants: readonly Participant[],
  newCapacity: number,
  nowIso: string,
): CapacityChangeResult {
  assertValidCapacity(newCapacity);
  let next = participants.map((p) => ({ ...p }));
  const promotions: Promotion[] = [];
  // 空きがある限り先頭から繰り上げ
  for (;;) {
    if (countChairs(next) >= newCapacity) break;
    const head = getWaitlist(next)[0];
    if (!head) break;
    next = next.map((p) =>
      p.id === head.id
        ? { ...p, status: "confirmed" as const, promotedAt: nowIso }
        : p,
    );
    promotions.push({
      participantId: head.id,
      email: head.email,
      name: head.name,
    });
  }
  return { participants: next, promotions };
}

/**
 * 意思変更 (参加 <-> 未定): 椅子消費量は変わらないため待機列に影響しない。
 * 将来「不参加」等の椅子を消費しない intent が増えた場合は、
 * 椅子を手放す変更 = cancelParticipant と同等の繰り上げが必要になるため、
 * この関数ではなく cancel + register で扱うこと。
 */
export function changeIntent(
  participants: readonly Participant[],
  id: string,
  intent: RsvpIntent,
): Participant[] {
  return participants.map((p) => (p.id === id ? { ...p, intent } : { ...p }));
}

function assertValidCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new Error(`capacity must be a non-negative integer, got ${capacity}`);
  }
}

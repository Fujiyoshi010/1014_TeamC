import { describe, expect, it } from "vitest";
import {
  applyCapacityChange,
  cancelParticipant,
  changeIntent,
  countChairs,
  getWaitlist,
  registerParticipant,
  type Participant,
} from "./index.js";

function p(
  over: Partial<Participant> & { id: string },
  seq = 0,
): Participant {
  return {
    name: `user-${over.id}`,
    email: `${over.id}@example.com`,
    intent: "attending",
    status: "confirmed",
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    seq,
    ...over,
  };
}

describe("要件1: 参加+未定の合計で椅子を用意し、定員超過は待機", () => {
  it("未定も1脚消費する", () => {
    const list = [p({ id: "a", intent: "maybe" }), p({ id: "b", intent: "attending" })];
    expect(countChairs(list)).toBe(2);
  });

  it("定員内なら確定、超過分は末尾に待機し position を返す", () => {
    const capacity = 2;
    let list: Participant[] = [];
    const r1 = registerParticipant(list, capacity, {
      id: "a", name: "A", email: "a@e.com", intent: "attending",
      createdAt: "2026-01-01T00:00:00Z", seq: 1,
    });
    expect(r1.outcome).toBe("confirmed");
    if (r1.outcome === "confirmed") list = [...list, r1.participant];

    const r2 = registerParticipant(list, capacity, {
      id: "b", name: "B", email: "b@e.com", intent: "maybe",
      createdAt: "2026-01-01T00:00:01Z", seq: 2,
    });
    expect(r2.outcome).toBe("confirmed");
    if (r2.outcome === "confirmed") list = [...list, r2.participant];

    // 未定でも満席なので次は待機
    const r3 = registerParticipant(list, capacity, {
      id: "c", name: "C", email: "c@e.com", intent: "maybe",
      createdAt: "2026-01-01T00:00:02Z", seq: 3,
    });
    expect(r3.outcome).toBe("waitlisted");
    if (r3.outcome === "waitlisted") {
      expect(r3.position).toBe(1);
      list = [...list, r3.participant];
    }
    const r4 = registerParticipant(list, capacity, {
      id: "d", name: "D", email: "d@e.com", intent: "attending",
      createdAt: "2026-01-01T00:00:03Z", seq: 4,
    });
    if (r4.outcome === "waitlisted") expect(r4.position).toBe(2);
    else throw new Error("expected waitlisted");
  });

  it("定員0なら全員待機", () => {
    const r = registerParticipant([], 0, {
      id: "a", name: "A", email: "a@e.com", intent: "attending",
      createdAt: "2026-01-01T00:00:00Z", seq: 1,
    });
    expect(r.outcome).toBe("waitlisted");
  });
});

describe("要件2: 空きが出たら先頭を自動繰り上げ", () => {
  it("確定のキャンセルで先頭1名だけ繰り上がる", () => {
    const list: Participant[] = [
      p({ id: "a" }, 1),
      p({ id: "b" }, 2),
      p({ id: "w1", status: "waitlisted" }, 3),
      p({ id: "w2", status: "waitlisted" }, 4),
    ];
    const r = cancelParticipant(list, "a", "2026-02-01T00:00:00Z");
    expect(r.promotions.map((x) => x.participantId)).toEqual(["w1"]);
    const w1 = r.participants.find((x) => x.id === "w1");
    expect(w1?.status).toBe("confirmed");
    expect(w1?.promotedAt).toBe("2026-02-01T00:00:00Z");
    expect(r.participants.find((x) => x.id === "w2")?.status).toBe("waitlisted");
    // 椅子数は維持される
    expect(countChairs(r.participants)).toBe(2);
  });

  it("待機者のキャンセルでは繰り上げない", () => {
    const list: Participant[] = [
      p({ id: "a" }, 1),
      p({ id: "w1", status: "waitlisted" }, 2),
    ];
    const r = cancelParticipant(list, "w1", "2026-02-01T00:00:00Z");
    expect(r.promotions).toEqual([]);
  });

  it("FIFO順: createdAt→seq の昇順で先頭を決める", () => {
    const list: Participant[] = [
      p({ id: "a" }, 1),
      // 作成順が逆でも createdAt が早い方が先頭
      p({ id: "w-late", status: "waitlisted", createdAt: "2026-01-02T00:00:00Z", seq: 5 }, 5),
      p({ id: "w-early", status: "waitlisted", createdAt: "2026-01-01T00:00:00Z", seq: 9 }, 9),
    ];
    expect(getWaitlist(list).map((x) => x.id)).toEqual(["w-early", "w-late"]);
    const r = cancelParticipant(list, "a", "2026-02-01T00:00:00Z");
    expect(r.promotions[0]?.participantId).toBe("w-early");
  });

  it("存在しないid・二重キャンセルは何もしない", () => {
    const list = [p({ id: "a" }, 1)];
    expect(cancelParticipant(list, "nope", "2026-02-01T00:00:00Z").promotions).toEqual([]);
    const cancelled = cancelParticipant(list, "a", "2026-02-01T00:00:00Z");
    const again = cancelParticipant(cancelled.participants, "a", "2026-02-01T00:00:01Z");
    expect(again.promotions).toEqual([]);
    expect(again.cancelled).toBeUndefined();
  });
});

describe("定員変更・意思変更", () => {
  it("定員増で空き分だけ繰り上がる", () => {
    const list: Participant[] = [
      p({ id: "a" }, 1),
      p({ id: "w1", status: "waitlisted" }, 2),
      p({ id: "w2", status: "waitlisted" }, 3),
    ];
    const r = applyCapacityChange(list, 3, "2026-03-01T00:00:00Z");
    expect(r.promotions.map((x) => x.participantId)).toEqual(["w1", "w2"]);
  });

  it("参加<->未定の変更は椅子数に影響しない", () => {
    const list = [p({ id: "a", intent: "maybe" }, 1)];
    expect(countChairs(changeIntent(list, "a", "attending"))).toBe(1);
  });
});

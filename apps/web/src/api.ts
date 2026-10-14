export type RsvpIntent = "attending" | "maybe";

export interface Participant {
  id: string;
  name: string;
  email: string;
  intent: RsvpIntent;
  status: "confirmed" | "waitlisted" | "cancelled";
  position?: number;
}

export interface EventState {
  id: string;
  name: string;
  capacity: number;
  chairsNeeded: number;
  freeSeats: number;
  confirmed: Participant[];
  waitlist: (Participant & { position: number })[];
}

export const intentLabel: Record<RsvpIntent, string> = {
  attending: "参加",
  maybe: "未定",
};

export async function fetchEvent(eventId: string): Promise<EventState> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`);
  if (!res.ok) throw new Error(`failed to load event (${res.status})`);
  return res.json();
}

export async function postRsvp(
  eventId: string,
  input: { name: string; email: string; intent: RsvpIntent },
): Promise<{ status: "confirmed" | "waitlisted"; position?: number }> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/rsvps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `rsvp failed (${res.status})`);
  }
  return res.json();
}

export async function cancelRsvp(
  eventId: string,
  rsvpId: string,
): Promise<{ promotions: { email: string }[] }> {
  const res = await fetch(
    `/api/events/${encodeURIComponent(eventId)}/rsvps/${encodeURIComponent(rsvpId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`cancel failed (${res.status})`);
  return res.json();
}

/**
 * Reading what Monday.com posts at us.
 *
 * Monday signs webhooks only for apps that register a signing secret through the developer
 * platform; a board-level "Integrate → Webhooks" recipe, which is what this is, sends an
 * unsigned POST. So authentication is the same shape as the TimelinesAI webhook: a long secret
 * in the URL path compared in constant time, with `verifyWebhookToken` shared between the two
 * rather than copied.
 */

/** Monday's URL-verification handshake: echo the challenge back or the webhook is never saved. */
export interface MondayChallenge {
  kind: "challenge";
  challenge: string;
}

export interface MondayItemEvent {
  kind: "event";
  /** Monday's own delivery id. Unique per event, which is what makes a retry detectable. */
  eventId: string | null;
  boardId: string | null;
  itemId: string | null;
  /** `create_item`, `create_pulse`, `change_column_value`, … */
  type: string | null;
  /** The board group the item landed in, when the payload carries it. */
  groupId: string | null;
  itemName: string | null;
}

export type MondayEvent = MondayChallenge | MondayItemEvent | { kind: "unknown" };

type Unknown = Record<string, unknown>;
const obj = (v: unknown): Unknown => (v && typeof v === "object" && !Array.isArray(v) ? (v as Unknown) : {});
const str = (v: unknown): string | null => {
  if (typeof v === "number") return String(v); // board and item ids arrive as numbers
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/**
 * Normalises the two things Monday can post.
 *
 * The challenge arrives once, when the webhook is saved, as a bare `{ "challenge": "..." }`.
 * Everything after that is `{ "event": { ... } }`. A flat body is tolerated as well, because
 * Monday's own docs show both over time and the cost of guessing wrong is a client silently
 * never being created.
 *
 * The group id key differs by event: `create_item` carries `groupId`, older `create_pulse`
 * deliveries carry `groupName`/`groupId` nested under `group`. All three are read.
 */
export function normaliseMondayEvent(raw: unknown): MondayEvent {
  const body = obj(raw);

  const challenge = str(body.challenge);
  if (challenge) return { kind: "challenge", challenge };

  const event = Object.keys(obj(body.event)).length ? obj(body.event) : body;
  const type = str(event.type) ?? str(event.event_type);
  const itemId = str(event.pulseId) ?? str(event.itemId) ?? str(event.pulse_id) ?? str(event.item_id);
  const boardId = str(event.boardId) ?? str(event.board_id);
  if (!type && !itemId) return { kind: "unknown" };

  return {
    kind: "event",
    // triggerUuid is Monday's per-delivery id; a retry of the same event reuses it, which is
    // exactly the property the dedupe index in 0026 needs.
    eventId: str(event.triggerUuid) ?? str(event.trigger_uuid) ?? str(event.id),
    boardId,
    itemId,
    type,
    groupId: str(event.groupId) ?? str(event.group_id) ?? str(obj(event.group).id),
    itemName: str(event.pulseName) ?? str(event.itemName) ?? str(event.pulse_name),
  };
}

/** The event types that mean "a new client row exists". Monday renamed pulses to items. */
const CREATE_EVENTS = new Set(["create_item", "create_pulse"]);

export function isItemCreated(event: MondayItemEvent): boolean {
  return event.type !== null && CREATE_EVENTS.has(event.type);
}

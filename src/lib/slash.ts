/** Slash commands available in the composer. `args` is the placeholder shown in the picker. */
export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
  /** Team only. */
  team?: boolean;
  /** Not in direct messages. */
  channelOnly?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "shrug", args: "[message]", description: "Append ¯\\_(ツ)_/¯ to your message" },
  { name: "status", args: "[text]", description: "Set (or clear) your status" },
  { name: "dnd", args: "30m | 1h | 2h | off", description: "Pause notifications" },
  { name: "away", args: "[1h | today | off]", description: "Set yourself away and stop all notifications" },
  { name: "mute", description: "Mute or unmute this conversation" },
  { name: "dm", args: "@name [message]", description: "Open a direct message" },
  { name: "search", args: "text", description: "Search Stayful", team: true },
  { name: "topic", args: "text", description: "Set the group topic", team: true, channelOnly: true },
  { name: "invite", description: "Add people to this group", team: true, channelOnly: true },
  { name: "leave", description: "Leave this group", team: true, channelOnly: true },
  { name: "collapse", description: "Close the thread panel" },
];

/** Splits "/name rest of text" into its parts, or null when the text is not a command. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? "").trim() };
}

export function availableCommands(opts: { isTeam: boolean; isDm: boolean }): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => (!c.team || opts.isTeam) && (!c.channelOnly || !opts.isDm));
}

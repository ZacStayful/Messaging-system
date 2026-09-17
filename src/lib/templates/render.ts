/**
 * {{placeholder}} substitution for the message templates in `message_templates` (0023).
 *
 * The TypeScript twin of the SQL `render_message_template`. Both exist because the webhook is
 * already holding the values and should not make a round trip to render a string, while the SQL
 * one keeps the same template renderable from MCP or n8n later. Keep them behaving identically:
 * the tests in `tests/templates.test.ts` are written against this one.
 *
 * Substitution and nothing else — no conditionals, no loops, no expressions. A template that a
 * non-developer edits in a textarea should not be able to fail at render time.
 */

/** Values a template can interpolate. Anything nullish renders as an empty string. */
export type TemplateVars = Record<string, string | null | undefined>;

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * An unknown placeholder is left in the output on purpose.
 *
 * Blanking it silently hides the typo until a customer reads the message with a sentence missing;
 * leaving `{{proprty_address}}` visible in the preview does not. The admin editing the template
 * sees exactly what went out.
 */
export function renderTemplate(body: string, vars: TemplateVars = {}): string {
  return body.replace(PLACEHOLDER, (whole, name: string) => {
    const key = name.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return whole;
    return vars[key] ?? "";
  });
}

/** The placeholder names a body actually uses, in order of first appearance, de-duplicated. */
export function placeholdersIn(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) seen.add(m[1].toLowerCase());
  return [...seen];
}

/**
 * The placeholders the welcome template is documented to support. Shown beside the editor so
 * whoever is rewriting the message knows what they can reach for, and used by the editor to
 * flag a placeholder that will not be substituted.
 */
export const KNOWN_PLACEHOLDERS = ["customer_name", "first_name", "property_address", "account_manager"] as const;

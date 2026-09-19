/**
 * Does src/lib/database.types.ts still describe what the migrations build?
 *
 *   pnpm exec tsx scripts/verify-types-fresh.ts <inventory.json> <database.types.ts>
 *
 * Run by scripts/verify-migrations.sh against the throwaway cluster it has just applied every
 * migration to, so CI can answer the question with no secret, no network and no Supabase CLI.
 *
 * Why this exists: `pnpm db:types` is safe to run now, but nothing made anyone run it. Stale types
 * fail nothing — `tsc` is perfectly happy with a table it has never heard of, because nothing
 * references it. The drift is invisible until someone writes the query that needs the missing
 * column. 0033 added topic_internal_conversation_id and the committed types went eight migrations
 * without it; six tables carried empty Relationships for as long.
 *
 * What it compares is deliberately narrow: names, nullability, write-shape and foreign keys. It
 * says nothing
 * about how a Postgres type maps to a TypeScript one, because that mapping is a large table inside
 * the generator and rebuilding it here would be a second implementation — one that drifts, and
 * whose drift shows up as a failing build on a correct change, which is the fastest way to get a
 * check ignored.
 *
 * So a pass does not mean the file is byte-identical to what `pnpm db:types` produces. It means
 * nothing has been added, removed, made nullable, made required or re-pointed without the types
 * being regenerated, and that the hand corrections are still in place.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { CORRECTIONS } from "./types-corrections";

/** What Insert must say about a column; Update uses only the `never` part. */
type InsertRule = "required" | "optional" | "never";
/** `n` = nullable, for Row. `i` = the Insert rule; absent for a view, which has no Insert. */
type ColumnInfo = { n: boolean; i?: InsertRule };

interface Inventory {
  tables: Record<string, Record<string, ColumnInfo>>;
  views: Record<string, Record<string, boolean>>;
  foreign_keys: { name: string; table: string; columns: string[]; referenced_table: string }[];
  functions: string[];
  enums: Record<string, string[]>;
}

const [, , inventoryPath, typesPath] = process.argv;
if (!inventoryPath || !typesPath) {
  console.error("usage: verify-types-fresh.ts <inventory.json> <database.types.ts>");
  process.exit(2);
}

const db: Inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const source = readFileSync(typesPath, "utf8");
const file = ts.createSourceFile(typesPath, source, ts.ScriptTarget.Latest, true);

const problems: string[] = [];
const report = (what: string) => problems.push(what);

const nameOf = (n: ts.PropertyName) => (ts.isStringLiteral(n) ? n.text : n.getText(file));

/**
 * The members of a type literal, or `[]` for a mapped type.
 *
 * The distinction matters: the generator writes an empty section as `{ [_ in never]: never }`, a
 * MappedTypeNode rather than a TypeLiteralNode. Treating that as unreadable rather than as empty
 * would make an empty `Views` look like "every view is missing".
 */
function members(node: ts.Node | undefined): readonly ts.TypeElement[] | null {
  if (!node) return null;
  let t = node;
  for (;;) {
    if (ts.isArrayTypeNode(t)) t = t.elementType;
    else if (ts.isParenthesizedTypeNode(t)) t = t.type;
    else break;
  }
  if (ts.isMappedTypeNode(t)) return [];
  return ts.isTypeLiteralNode(t) ? t.members : null;
}

function child(list: readonly ts.TypeElement[] | null, name: string): ts.PropertySignature | null {
  return list?.find((m): m is ts.PropertySignature => ts.isPropertySignature(m) && nameOf(m.name) === name) ?? null;
}

const props = (list: readonly ts.TypeElement[] | null) => (list ?? []).filter(ts.isPropertySignature);
const names = (list: readonly ts.TypeElement[] | null) => props(list).map((m) => nameOf(m.name));

/** The `public` schema literal inside `export type Database = {...}`. */
function publicSchema(): readonly ts.TypeElement[] {
  for (const stmt of file.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== "Database") continue;
    const found = members(child(members(stmt.type), "public")?.type);
    if (found) return found;
  }
  // Reported rather than thrown: an uncaught throw exits non-zero and the shell announces that the
  // types are out of date, which would be a lie about a file that is unreadable or not generator
  // output at all.
  report(`${typesPath}: no \`export type Database\` with a \`public\` schema — is this generator output?`);
  return [];
}

const pub = publicSchema();

// Paths a CORRECTIONS entry owns. The schema-derived expectation is skipped for these, because by
// design they disagree with the generator — conversation_members.member_side is required according
// to the column definition and optional in the types, since a trigger fills it. The corrections
// check below asserts the hand-applied value instead, so the column is still covered, once.
// Keyed on the full correction path rather than the column name, so a correction added elsewhere
// cannot silently widen the exemption.
const correctedPaths = new Set(CORRECTIONS.map((c) => c.path));

/** Set comparison, phrased from the schema's side: the migrations are right, the file is not. */
function compare(kind: string, inDb: readonly string[], inTypes: readonly string[]) {
  for (const n of inDb) if (!inTypes.includes(n)) report(`${kind} \`${n}\` is missing from the types`);
  for (const n of inTypes) if (!inDb.includes(n)) report(`${kind} \`${n}\` is in the types but not in the schema`);
}

/**
 * Columns of one relation, in both directions, plus nullability.
 *
 * Nullability is skipped when the declared type is exactly `unknown` or `any`. That is the
 * generator's own rule inverted — generateNullableUnionTsType() in @supabase/postgres-meta omits
 * `| null` for those two because both already include null. A Postgres type with no entry in its
 * map renders as `unknown`, which is why messages.body_tsv (tsvector) looks NOT NULL here and is
 * not. Keying on the declared text rather than on, say, generated columns means this covers every
 * unmapped type — inet, ltree, ranges, xml, PostGIS — present and future.
 *
 * The equality is exact on purpose: `(unknown)[]` and `Record<string, unknown>` do get `| null`
 * from the generator, and so should be checked here. `NonNullable<Json>`, which newer generators
 * emit for a NOT NULL json column, correctly reads as non-null.
 */
function compareColumns(kind: string, relation: string, columns: Record<string, ColumnInfo>, section: string) {
  const container = child(members(child(pub, section)?.type), relation);
  const rowProps = members(child(members(container?.type), "Row")?.type);
  if (!rowProps) {
    // Not "already reported above": the relation key can be present while Row is unreadable, and
    // continuing silently would skip every one of its columns with nothing said.
    if (container) report(`${kind} \`${relation}\` has no readable \`Row\` in the types`);
    return;
  }

  const qualify = (c: string) => `${relation}.${c}`;
  compare("column", Object.keys(columns).map(qualify), names(rowProps).map(qualify));

  for (const prop of props(rowProps)) {
    const column = nameOf(prop.name);
    const info = columns[column];
    if (!info) continue;
    const declared = prop.type?.getText(file) ?? "";
    if (declared === "unknown" || declared === "any") continue;
    const nullableInTypes = /\|\s*null\b/.test(declared);
    if (info.n !== nullableInTypes) {
      report(
        info.n
          ? `column \`${relation}.${column}\` is nullable in the schema but not in the types`
          : `column \`${relation}.${column}\` is NOT NULL in the schema but nullable in the types`,
      );
    }
  }

  // Insert and Update. `| null` inside them is not compared: it follows Row, which is compared
  // above, and checking twice would report one schema change as two problems.
  for (const write of ["Insert", "Update"] as const) {
    const writeProps = members(child(members(container?.type), write)?.type);
    if (!writeProps) {
      report(`${kind} \`${relation}\` has no readable \`${write}\` in the types`);
      continue;
    }
    compare(`${write} field`, Object.keys(columns).map(qualify), names(writeProps).map(qualify));

    for (const prop of props(writeProps)) {
      const column = nameOf(prop.name);
      const rule = columns[column]?.i;
      if (!rule) continue;
      if (correctedPaths.has(`Tables.${relation}.${write}.${column}`)) continue;

      // Update makes everything optional; only Insert distinguishes required from optional.
      const mustBeOptional = write === "Update" || rule !== "required";
      if (mustBeOptional !== Boolean(prop.questionToken)) {
        report(
          mustBeOptional
            ? `${write} field \`${relation}.${column}\` should be optional in the types but is required`
            : `${write} field \`${relation}.${column}\` should be required in the types but is optional`,
        );
      }

      const isNever = (prop.type?.getText(file) ?? "").trim() === "never";
      if ((rule === "never") !== isNever) {
        report(
          rule === "never"
            ? `${write} field \`${relation}.${column}\` is GENERATED ALWAYS AS IDENTITY and should be typed \`never\``
            : `${write} field \`${relation}.${column}\` is typed \`never\` but can be written`,
        );
      }
    }
  }
}

// --- tables and views ---------------------------------------------------------------------------
compare("table", Object.keys(db.tables), names(members(child(pub, "Tables")?.type)));
for (const [table, columns] of Object.entries(db.tables)) compareColumns("table", table, columns, "Tables");

compare("view", Object.keys(db.views), names(members(child(pub, "Views")?.type)));
for (const [view, columns] of Object.entries(db.views)) {
  // A view has a Row and nothing else, so its columns carry no Insert rule.
  const asInfo = Object.fromEntries(Object.entries(columns).map(([c, n]) => [c, { n }]));
  compareColumns("view", view, asInfo, "Views");
}

// --- foreign keys -------------------------------------------------------------------------------
// Compared as `constraint -> referenced table`, which is what the generated Relationships entries
// carry and enough to catch the failure that happened: a table added by hand with `Relationships: []`.
const typeRelationships = new Map<string, string>();
for (const table of props(members(child(pub, "Tables")?.type))) {
  const rels = child(members(table.type), "Relationships");
  const tuple = rels?.type;
  if (!tuple || !ts.isTupleTypeNode(tuple)) continue;
  for (const entry of tuple.elements) {
    const e = members(entry);
    const name = child(e, "foreignKeyName")
      ?.type?.getText(file)
      .replace(/^["']|["']$/g, "");
    const to = child(e, "referencedRelation")
      ?.type?.getText(file)
      .replace(/^["']|["']$/g, "");
    if (name && to) typeRelationships.set(name, to);
  }
}
for (const fk of db.foreign_keys) {
  const to = typeRelationships.get(fk.name);
  if (to === undefined) report(`foreign key \`${fk.name}\` on \`${fk.table}\` is missing from Relationships`);
  else if (to !== fk.referenced_table)
    report(`foreign key \`${fk.name}\` points at \`${fk.referenced_table}\` but the types say \`${to}\``);
}
for (const name of typeRelationships.keys())
  if (!db.foreign_keys.some((f) => f.name === name))
    report(`Relationships names \`${name}\`, which is not a foreign key in the schema`);

// --- functions and enums ------------------------------------------------------------------------
compare("function", db.functions, names(members(child(pub, "Functions")?.type)));

const enumProps = props(members(child(pub, "Enums")?.type));
compare(
  "enum",
  Object.keys(db.enums),
  enumProps.map((m) => nameOf(m.name)),
);
for (const prop of enumProps) {
  const name = nameOf(prop.name);
  const expected = db.enums[name];
  if (!expected) continue;
  // Membership, not order: `alter type ... add value ... before ...` changes the emitted union's
  // order without changing what it accepts.
  const declared = (prop.type?.getText(file) ?? "").match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const missing = expected.filter((v) => !declared.includes(v));
  const extra = declared.filter((v) => !expected.includes(v));
  if (missing.length) report(`enum \`${name}\` is missing ${missing.map((v) => `\`${v}\``).join(", ")}`);
  if (extra.length) report(`enum \`${name}\` has ${extra.map((v) => `\`${v}\``).join(", ")} the schema does not`);
}

// --- the hand corrections -----------------------------------------------------------------------
// Every correction lives in Functions.*.Args, Functions.*.Returns or Tables.*.Insert — all outside
// the region compared above. So a regeneration that dropped the whole of types-corrections.ts would
// otherwise pass this check clean, which is precisely the accident that led to the list existing.
// Needs no database, so it runs regardless of the rest.
for (const c of CORRECTIONS) {
  let list: readonly ts.TypeElement[] | null = pub;
  let prop: ts.PropertySignature | null = null;
  for (const step of c.path.split(".")) {
    prop = child(list, step);
    if (!prop) break;
    list = members(prop.type);
  }
  if (!prop) {
    report(`correction \`${c.path}\` no longer resolves in the types — has \`pnpm db:types\` been run?`);
    continue;
  }
  const declared = (prop.type?.getText(file) ?? "").replace(/\s+/g, " ").trim();
  if (declared !== c.to.replace(/\s+/g, " ").trim())
    report(`correction \`${c.path}\` should read \`${c.to}\` but reads \`${declared}\``);
  if (c.optional && !prop.questionToken) report(`correction \`${c.path}\` should be optional but is not`);
}

// --- verdict -------------------------------------------------------------------------------------
if (problems.length) {
  console.error(`FAILED  src/lib/database.types.ts does not match the migrations`);
  for (const p of problems) console.error(`        ${p}`);
  console.error(
    `\n        ${problems.length} difference${problems.length === 1 ? "" : "s"}. Either the types are stale —\n` +
      "        run `pnpm db:types` and commit the result — or the hosted project has drifted from\n" +
      "        supabase/migrations, in which case regenerating reproduces the drift and the\n" +
      "        migrations are what need to catch up.",
  );
  process.exit(1);
}

const columns = Object.values(db.tables).reduce((n, c) => n + Object.keys(c).length, 0);
console.log(
  `  ok  types match the schema (${Object.keys(db.tables).length} tables, ${columns} columns ` +
    `incl. Insert/Update, ${db.foreign_keys.length} foreign keys, ${db.functions.length} functions, ` +
    `${Object.keys(db.enums).length} enums, ${CORRECTIONS.length} corrections)`,
);

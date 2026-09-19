/**
 * Applies CORRECTIONS to freshly generated Supabase types.
 *
 *   pnpm exec tsx scripts/apply-types-corrections.ts <raw.ts> <out.ts>
 *
 * Reads the generator's output, rewrites the properties listed in scripts/types-corrections.ts,
 * prepends HEADER and appends ALIASES, and writes the result. It never touches
 * src/lib/database.types.ts — gen-types.sh decides whether the result is good enough to land.
 *
 * It resolves each correction through the TypeScript AST rather than by matching text. That is
 * the whole reason this is a program and not a sed script: the generator's quoting, indentation
 * and line wrapping change between versions, and a pattern that silently stops matching would
 * drop a correction without anyone noticing — which is the failure this work exists to end. A
 * path either resolves to exactly one property or it is an error.
 *
 * Every failure is reported before exiting, so the list can be fixed in one pass rather than one
 * run per mistake.
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { ALIASES, CORRECTIONS, HEADER, type Correction } from "./types-corrections";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: apply-types-corrections.ts <raw.ts> <out.ts>");
  process.exit(2);
}

const source = readFileSync(inPath, "utf8");
const file = ts.createSourceFile(inPath, source, ts.ScriptTarget.Latest, true);

/** Whitespace is not meaningful in a type; a wrapped type reference must compare equal. */
const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

function membersOf(node: ts.Node | undefined): ts.NodeArray<ts.TypeElement> | null {
  if (!node) return null;
  // `Returns: {...}[]` (a RETURNS TABLE function) and `Returns: {...}` (a row return) should be
  // reachable by the same path, so the array and any parentheses are unwrapped here.
  let t = node;
  for (;;) {
    if (ts.isArrayTypeNode(t)) t = t.elementType;
    else if (ts.isParenthesizedTypeNode(t)) t = t.type;
    else break;
  }
  return ts.isTypeLiteralNode(t) ? t.members : null;
}

/** The `public` schema literal inside `export type Database = {...}`. */
function publicSchema(): ts.NodeArray<ts.TypeElement> {
  for (const stmt of file.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== "Database") continue;
    const root = membersOf(stmt.type);
    const pub = root?.find((m) => ts.isPropertySignature(m) && m.name.getText() === "public");
    const members = pub && ts.isPropertySignature(pub) ? membersOf(pub.type) : null;
    if (members) return members;
  }
  throw new Error(`${inPath}: no \`export type Database\` with a \`public\` schema — not generator output?`);
}

function findProperty(path: string): ts.PropertySignature | string {
  const steps = path.split(".");
  let members: ts.NodeArray<ts.TypeElement> | null = publicSchema();
  let prop: ts.PropertySignature | null = null;

  for (const step of steps) {
    if (!members) return `\`${steps.slice(0, steps.indexOf(step)).join(".")}\` is not an object`;
    const hits = members.filter(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) && m.name.getText().replace(/^["']|["']$/g, "") === step,
    );
    if (hits.length === 0) return "no such property";
    if (hits.length > 1) return `resolves to ${hits.length} properties, not one`;
    prop = hits[0];
    members = membersOf(prop.type);
  }
  return prop ?? "empty path";
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const edits: Edit[] = [];
const failures: { correction: Correction; reason: string }[] = [];

for (const c of CORRECTIONS) {
  const found = findProperty(c.path);
  if (typeof found === "string") {
    failures.push({ correction: c, reason: found });
    continue;
  }
  if (!found.type) {
    failures.push({ correction: c, reason: "property has no type annotation" });
    continue;
  }

  const current = normalise(found.type.getText(file));
  if (current !== normalise(c.from)) {
    // Told apart deliberately: "already correct" means retire the entry, anything else means the
    // schema moved under it. Same symptom, opposite remedies.
    failures.push({
      correction: c,
      reason:
        current === normalise(c.to)
          ? "already correct in the generator's output; retire this correction"
          : `expected \`${c.from}\`, found \`${found.type.getText(file)}\``,
    });
    continue;
  }

  if (c.to !== c.from) edits.push({ start: found.type.getStart(file), end: found.type.getEnd(), text: c.to });
  if (c.optional && !found.questionToken) {
    const at = found.name.getEnd();
    edits.push({ start: at, end: at, text: "?" });
  }
}

if (failures.length) {
  for (const { correction, reason } of failures) {
    console.error(`FAILED  ${correction.path} — ${reason}`);
    console.error(`        why it is here: ${correction.why}`);
  }
  console.error(
    `\n${failures.length} of ${CORRECTIONS.length} corrections did not apply. Nothing was written.\n` +
      "Fix them in scripts/types-corrections.ts; a correction that no longer applies is a signal, not an obstacle.",
  );
  process.exit(1);
}

// Overlapping edits would corrupt the output, and the only way to get them is two entries naming
// the same property — worth catching here rather than producing a file that looks plausible.
const sorted = [...edits].sort((a, b) => a.start - b.start);
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].start < sorted[i - 1].end) {
    console.error("FAILED  two corrections overlap; check for a duplicated path in CORRECTIONS");
    process.exit(1);
  }
}

// Applied back to front so earlier offsets stay valid.
let out = source;
for (const e of [...edits].sort((a, b) => b.start - a.start)) {
  out = out.slice(0, e.start) + e.text + out.slice(e.end);
}

writeFileSync(outPath, `${HEADER}${out.replace(/\s*$/, "\n")}\n${ALIASES}`);
console.log(`  ok  ${CORRECTIONS.length} corrections applied`);
console.log(`  ok  ${ALIASES.trimEnd().split("\n").length} aliases appended`);

// Test titles for the AC checker (scripts/checks/ac-manifest.py, docs/11-TESTING.md section 4). A test
// title is the first argument of a `test`, `it` or `describe` call, including chained forms such as
// `test.describe.serial`, `it.skip` or `describe.skipIf(condition)`. The files are parsed with the
// TypeScript compiler, so an AC ID in a comment, a string elsewhere or any other text never counts.
// Usage: node scripts/checks/test-titles.ts <file>...   prints { "<file>": ["title", ...] } as JSON.
import { readFileSync } from "node:fs";
import ts from "typescript";

const TEST_FUNCTIONS = new Set(["test", "it", "describe"]);

/** The identifier a call chain starts from: `test` for `test.describe.serial(...)` or `it.each(x)(...)`. */
function chainRoot(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return chainRoot(expression.expression);
  if (ts.isCallExpression(expression)) return chainRoot(expression.expression);
  return null;
}

/** The text of a title argument: string literals, templates (with ${...} kept) and their sums. */
function titleText(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (text, span) => `${text}\${${span.expression.getText()}}${span.literal.text}`,
      node.head.text,
    );
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = titleText(node.left);
    const right = titleText(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isParenthesizedExpression(node)) return titleText(node.expression);
  return null;
}

export function testTitles(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const root = chainRoot(node.expression);
      const first = node.arguments[0];
      if (root !== null && TEST_FUNCTIONS.has(root) && first) {
        const title = titleText(first);
        if (title !== null) titles.push(title);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return titles;
}

if (import.meta.main) {
  const result: Record<string, string[]> = {};
  for (const path of process.argv.slice(2))
    result[path] = testTitles(path, readFileSync(path, "utf8"));
  process.stdout.write(JSON.stringify(result));
}

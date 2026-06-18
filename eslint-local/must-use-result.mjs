/**
 * Custom type-aware ESLint rule: a returned `Result` must be consumed.
 *
 * Our `Result<T>` is a plain discriminated union (not neverthrow). TypeScript
 * already blocks reading `.data` without narrowing, and `no-floating-promises`
 * catches un-awaited calls. The remaining gap this rule closes: awaiting (or
 * synchronously calling) something that returns a `Result` and then ignoring it
 * entirely, which silently swallows a failure (e.g. a mutation whose error is
 * never checked).
 *
 * Opt out of an intentional discard by prefixing the call with `void`, which
 * makes the statement a UnaryExpression and is not flagged.
 */

import { ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/2bTwist/baasdk#result-must-be-used",
);

/** True when `type` (or an awaited Promise of it) is our `Result` alias. */
function isResultType(type) {
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  return symbol?.getName() === "Result";
}

export const mustUseResult = createRule({
  name: "must-use-result",
  meta: {
    type: "problem",
    docs: {
      description: "A returned Result must be consumed, not silently ignored.",
    },
    messages: {
      unused:
        "This Result is ignored, so a failure would be swallowed silently. Check it (`if (!r.ok) ...`), assign it, or prefix the call with `void` to discard intentionally.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);

    return {
      ExpressionStatement(node) {
        const expr = node.expression;
        // Only bare call statements. `await foo()` -> AwaitExpression whose type
        // is the awaited Result. `void foo()` -> UnaryExpression, exempt.
        const isCallish =
          expr.type === "CallExpression" ||
          (expr.type === "AwaitExpression" && expr.argument.type === "CallExpression") ||
          expr.type === "ChainExpression";
        if (!isCallish) return;

        const type = services.getTypeAtLocation(expr);
        if (isResultType(type)) {
          context.report({ node, messageId: "unused" });
        }
      },
    };
  },
});

export default { rules: { "must-use-result": mustUseResult } };

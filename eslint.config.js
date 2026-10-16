import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // The code uses "!" to state a fact that the types cannot show. A guard in its place adds a check that cannot fail.
      "@typescript-eslint/no-non-null-assertion": "off",
      // tsconfig.json does not set noUncheckedIndexedAccess, so the types say that an array element or a regex group
      // is always present. The rule then reports a real check of a missing value as unnecessary.
      "@typescript-eslint/no-unnecessary-condition": "off",
      // An async function without await turns a throw into a rejected promise, and the callers depend on this.
      "@typescript-eslint/require-await": "off",
      // The code uses an empty function as an intended no-op (a function that does nothing).
      "@typescript-eslint/no-empty-function": "off",
      // A number in a template literal prints its digits.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowAny: false,
          allowBoolean: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
          allowNever: false,
        },
      ],
      // Almost all hits are an arrow function shorthand that returns a void call. The callers do not use the value.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // The code passes on a caught value without a change.
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
      // The code passes on a caught value without a change.
      "@typescript-eslint/only-throw-error": ["error", { allowThrowingAny: true, allowThrowingUnknown: true }],
    },
  },
  {
    files: ["test/**"],
    rules: {
      // The tests use values of type any on purpose: raw invalid input for the code under test, and the output of
      // JSON.parse. The assertions of the test then check the shape.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  // Temporary: each rule in this block still reports problems. A later commit fixes the code for one rule and
  // removes that rule from this block.
  {
    rules: {
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/prefer-includes": "off",
      "@typescript-eslint/no-unnecessary-template-expression": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
    },
  },
  // The JavaScript files are outside tsconfig.json, so they get no type information. This block must come after the
  // blocks that set rules with options.
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  eslintConfigPrettier,
);

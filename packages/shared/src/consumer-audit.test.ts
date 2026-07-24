import { glob, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const allowedLocalPresentationTypes = new Map([
  [
    "apps/cloud/src/landing/fixtures.ts",
    "static landing-page visual fixtures; never a transport contract",
  ],
  ["apps/cloud/src/landing/types.ts", "landing-only render props; never a transport contract"],
  [
    "apps/web/src/saas/feature-fixtures.ts",
    "prototype-only visual fixtures mapped from future shared read models",
  ],
  ["apps/web/src/saas/types.ts", "local route, reducer, and presentation state; never a wire DTO"],
]);

const protocolNames = [
  "AgentEventEnvelope",
  "AgentRuntimeEvent",
  "AgentUiEvent",
  "ApiErrorResponse",
  "ApprovalDecision",
  "ApprovalSnapshot",
  "GlobalSnapshot",
  "MessageSnapshot",
  "ProviderCapabilitySnapshot",
  "ReplayGapErrorResponse",
  "SessionSnapshot",
  "TurnSnapshot",
  "TurnStatus",
] as const;

const presentationNamesRestrictedToAllowlist = ["AgentMessage", "RuntimePresentation"] as const;

async function sourceFiles(): Promise<readonly string[]> {
  const paths: string[] = [];
  for await (const path of glob("{apps,packages,tests}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", {
    cwd: workspaceRoot,
    exclude: ["**/dist/**", "**/node_modules/**", "**/worker-configuration.d.ts"],
  })) {
    if (path.endsWith("/worker-configuration.d.ts")) continue;
    paths.push(path);
  }
  return paths.sort();
}

const identityFingerprintFields = [
  "eventId",
  "seq",
  "sessionId",
  "turnId",
  "clientRequestId",
  "snapshotSeq",
  "sessionSnapshotSeq",
] as const;
const errorFingerprintFields = ["code", "message", "details"] as const;
const fingerprintFields = new Set<string>([
  ...identityFingerprintFields,
  ...errorFingerprintFields,
]);

interface SourceAnalysis {
  readonly declarationNames: ReadonlySet<string>;
  readonly hasLocalContractFingerprint: boolean;
  readonly hasProtocolFingerprint: boolean;
  readonly importsOfficialAcp: boolean;
  readonly usesImportedSharedSymbol: boolean;
}

interface AuditedSource {
  readonly analysis: SourceAnalysis | null;
  readonly path: string;
  readonly source: string;
}

let auditedSources: readonly AuditedSource[] = [];

function scriptKindForPath(path: string): ts.ScriptKind {
  if (/\.tsx$/u.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(path)) return ts.ScriptKind.JSX;
  if (/\.(?:cjs|js|mjs)$/u.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseAuditSource(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKindForPath(path));
}

function createAuditProgram(
  path: string,
  source: string,
): {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
} {
  const sourceFile = parseAuditSource(path, source);
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const host: ts.CompilerHost = {
    fileExists: (fileName) => fileName === path,
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "lib.d.ts",
    getNewLine: () => "\n",
    getSourceFile: (fileName) => (fileName === path ? sourceFile : undefined),
    readFile: (fileName) => (fileName === path ? source : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  const program = ts.createProgram([path], options, host);
  return { checker: program.getTypeChecker(), sourceFile };
}

function isStringModuleSpecifier(node: ts.Node | undefined, packageName: string): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === packageName
  );
}

function isModuleLoader(node: ts.Expression, packageName: string): boolean {
  let current = node;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return (
    ts.isCallExpression(current) &&
    current.arguments.length === 1 &&
    isStringModuleSpecifier(current.arguments[0], packageName) &&
    (current.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(current.expression) && current.expression.text === "require"))
  );
}

function addBindingIdentifiers(name: ts.BindingName, bindings: Set<ts.Identifier>): void {
  if (ts.isIdentifier(name)) {
    bindings.add(name);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      addBindingIdentifiers(element.name, bindings);
    }
  }
}

function collectSharedBindings(sourceFile: ts.SourceFile): ReadonlySet<ts.Identifier> {
  const bindings = new Set<ts.Identifier>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      isStringModuleSpecifier(node.moduleSpecifier, "@dougoos/shared") &&
      node.importClause !== undefined
    ) {
      if (node.importClause.name !== undefined) bindings.add(node.importClause.name);
      const namedBindings = node.importClause.namedBindings;
      if (namedBindings !== undefined) {
        if (ts.isNamespaceImport(namedBindings)) {
          bindings.add(namedBindings.name);
        } else {
          for (const element of namedBindings.elements) bindings.add(element.name);
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isStringModuleSpecifier(node.moduleReference.expression, "@dougoos/shared")
    ) {
      bindings.add(node.name);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      isModuleLoader(node.initializer, "@dougoos/shared")
    ) {
      addBindingIdentifiers(node.name, bindings);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function isTestSource(path: string): boolean {
  return path.startsWith("tests/") || /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path);
}

function hasProtocolFingerprint(fields: ReadonlySet<string>): boolean {
  return (
    identityFingerprintFields.filter((field) => fields.has(field)).length >= 3 ||
    errorFingerprintFields.every((field) => fields.has(field))
  );
}

function propertyNameText(node: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  return undefined;
}

function collectFingerprintFields(node: ts.Node): ReadonlySet<string> {
  const fields = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && fingerprintFields.has(child.text)) {
      fields.add(child.text);
    } else if (
      (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) &&
      child.parent !== undefined &&
      "name" in child.parent &&
      child.parent.name === child &&
      fingerprintFields.has(child.text)
    ) {
      fields.add(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return fields;
}

const runtimeValidationMethods = new Set(["parse", "parseAsync", "safeParse", "safeParseAsync"]);
const zodShapeBuilderNames = new Set(["object", "strictObject"]);
const zodShapeExtensionNames = new Set(["extend", "safeExtend"]);
const zodSchemaCompositionNames = new Set(["and", "merge"]);
const zodStaticCompositionNames = new Set(["intersection"]);
const zodSubrootNames = new Set(["coerce", "iso"]);

type DataflowFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;
type DataflowEnvironment = ReadonlyMap<ts.Symbol, DataflowValue>;
type DataflowValue =
  | { readonly items: readonly DataflowValue[]; readonly kind: "array" }
  | {
      readonly baseFields: ReadonlySet<string>;
      readonly input: "schema" | "shape";
      readonly kind: "builder";
    }
  | {
      readonly captured: DataflowEnvironment;
      readonly kind: "closure";
      readonly node: DataflowFunction;
    }
  | {
      readonly fields: ReadonlySet<string>;
      readonly kind: "method";
      readonly result: "schema" | "validator";
    }
  | { readonly kind: "object"; readonly properties: ReadonlyMap<string, DataflowValue> }
  | { readonly fields: ReadonlySet<string>; readonly kind: "schema" }
  | { readonly kind: "unknown" }
  | { readonly kind: "validator" }
  | { readonly kind: "validator_factory" }
  | { readonly kind: "zod_namespace" }
  | { readonly kind: "zod_root" };

interface DataflowContext {
  readonly depth: number;
  readonly environment: DataflowEnvironment;
  readonly onShape: (fields: ReadonlySet<string>) => void;
  readonly resolving: ReadonlySet<ts.Symbol>;
}

const UNKNOWN_VALUE = { kind: "unknown" } as const satisfies DataflowValue;
const VALIDATOR_VALUE = { kind: "validator" } as const satisfies DataflowValue;
const VALIDATOR_FACTORY_VALUE = {
  kind: "validator_factory",
} as const satisfies DataflowValue;
const ZOD_NAMESPACE_VALUE = {
  kind: "zod_namespace",
} as const satisfies DataflowValue;
const ZOD_ROOT_VALUE = { kind: "zod_root" } as const satisfies DataflowValue;

function combinedFields(...sets: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const combined = new Set<string>();
  for (const set of sets) {
    for (const field of set) combined.add(field);
  }
  return combined;
}

function builderValue(
  input: "schema" | "shape",
  baseFields: ReadonlySet<string> = new Set(),
): DataflowValue {
  return { baseFields: new Set(baseFields), input, kind: "builder" };
}

function schemaValue(fields: ReadonlySet<string> = new Set()): DataflowValue {
  return { fields: new Set(fields), kind: "schema" };
}

/**
 * This bounded, symbol-aware scan is a CI guard for explicit local contract
 * copies. It follows common Zod aliases and wrappers; it is not a proof over
 * arbitrary JavaScript execution.
 */
class ZodContractDataflow {
  readonly #checker: ts.TypeChecker;

  constructor(checker: ts.TypeChecker) {
    this.#checker = checker;
  }

  contractFields(initializer: ts.Expression): ReadonlySet<string> {
    const contractFields = new Set<string>();
    const context: DataflowContext = {
      depth: 0,
      environment: new Map(),
      onShape: (fields) => {
        if (!hasProtocolFingerprint(fields)) return;
        for (const field of fields) contractFields.add(field);
      },
      resolving: new Set(),
    };
    this.#evaluate(initializer, context);
    return contractFields;
  }

  #nextContext(
    context: DataflowContext,
    changes: {
      readonly environment?: DataflowEnvironment;
      readonly resolving?: ReadonlySet<ts.Symbol>;
    } = {},
  ): DataflowContext {
    return {
      depth: context.depth + 1,
      environment: changes.environment ?? context.environment,
      onShape: context.onShape,
      resolving: changes.resolving ?? context.resolving,
    };
  }

  #evaluate(node: ts.Expression, context: DataflowContext): DataflowValue {
    if (context.depth > 80) return UNKNOWN_VALUE;
    let current = node;
    while (
      ts.isAwaitExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }
    if (isModuleLoader(current, "zod")) return ZOD_NAMESPACE_VALUE;
    if (ts.isIdentifier(current)) return this.#resolveIdentifier(current, context);
    if (ts.isObjectLiteralExpression(current)) return this.#evaluateObject(current, context);
    if (ts.isArrayLiteralExpression(current)) return this.#evaluateArray(current, context);
    if (ts.isSpreadElement(current)) {
      return this.#evaluate(current.expression, this.#nextContext(context));
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      return {
        captured: new Map(context.environment),
        kind: "closure",
        node: current,
      };
    }
    if (ts.isPropertyAccessExpression(current)) {
      const receiver = this.#evaluate(current.expression, this.#nextContext(context));
      return this.#propertyValue(receiver, current.name.text, current.name, context);
    }
    if (
      ts.isElementAccessExpression(current) &&
      current.argumentExpression !== undefined &&
      (ts.isStringLiteral(current.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(current.argumentExpression))
    ) {
      const receiver = this.#evaluate(current.expression, this.#nextContext(context));
      return this.#propertyValue(
        receiver,
        current.argumentExpression.text,
        current.argumentExpression,
        context,
      );
    }
    if (ts.isCallExpression(current)) return this.#evaluateCall(current, context);
    if (ts.isConditionalExpression(current)) {
      const whenTrue = this.#evaluate(current.whenTrue, this.#nextContext(context));
      const whenFalse = this.#evaluate(current.whenFalse, this.#nextContext(context));
      return whenTrue.kind === "unknown" ? whenFalse : whenTrue;
    }
    if (
      ts.isBinaryExpression(current) &&
      (current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const left = this.#evaluate(current.left, this.#nextContext(context));
      return left.kind === "unknown"
        ? this.#evaluate(current.right, this.#nextContext(context))
        : left;
    }
    return UNKNOWN_VALUE;
  }

  #evaluateCall(node: ts.CallExpression, context: DataflowContext): DataflowValue {
    if (isModuleLoader(node, "zod")) return ZOD_NAMESPACE_VALUE;
    const callee = this.#evaluate(node.expression, this.#nextContext(context));
    const arguments_ = this.#evaluateArguments(node.arguments, context);
    if (callee.kind === "builder") {
      let fields = new Set(callee.baseFields);
      for (const argument of arguments_) {
        fields = new Set(
          combinedFields(
            fields,
            callee.input === "shape" ? this.#shapeFields(argument) : this.#schemaFields(argument),
          ),
        );
      }
      if (hasProtocolFingerprint(fields)) context.onShape(fields);
      return schemaValue(fields);
    }
    if (callee.kind === "validator_factory") {
      return VALIDATOR_VALUE;
    }
    if (callee.kind === "method") {
      return callee.result === "schema" ? schemaValue(callee.fields) : VALIDATOR_VALUE;
    }
    if (callee.kind === "closure") {
      return this.#invokeClosure(callee, arguments_, context);
    }
    return UNKNOWN_VALUE;
  }

  #evaluateArguments(
    arguments_: readonly ts.Expression[],
    context: DataflowContext,
  ): readonly DataflowValue[] {
    const values: DataflowValue[] = [];
    for (const argument of arguments_) {
      if (ts.isSpreadElement(argument)) {
        const spread = this.#evaluate(argument.expression, this.#nextContext(context));
        if (spread.kind === "array") {
          values.push(...spread.items);
        } else {
          values.push(UNKNOWN_VALUE);
        }
      } else {
        values.push(this.#evaluate(argument, this.#nextContext(context)));
      }
    }
    return values;
  }

  #evaluateArray(node: ts.ArrayLiteralExpression, context: DataflowContext): DataflowValue {
    const items: DataflowValue[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = this.#evaluate(element.expression, this.#nextContext(context));
        if (spread.kind === "array") items.push(...spread.items);
      } else {
        items.push(this.#evaluate(element, this.#nextContext(context)));
      }
    }
    return { items, kind: "array" };
  }

  #evaluateObject(node: ts.ObjectLiteralExpression, context: DataflowContext): DataflowValue {
    const properties = new Map<string, DataflowValue>();
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = this.#evaluate(property.expression, this.#nextContext(context));
        if (spread.kind === "object") {
          for (const [name, value] of spread.properties) properties.set(name, value);
        }
      } else if (ts.isPropertyAssignment(property)) {
        const name = propertyNameText(property.name);
        if (name !== undefined) {
          properties.set(name, this.#evaluate(property.initializer, this.#nextContext(context)));
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        properties.set(
          property.name.text,
          this.#resolveIdentifier(property.name, this.#nextContext(context)),
        );
      } else if (ts.isMethodDeclaration(property)) {
        const name = propertyNameText(property.name);
        if (name !== undefined) {
          properties.set(name, {
            captured: new Map(context.environment),
            kind: "closure",
            node: property,
          });
        }
      }
    }
    return { kind: "object", properties };
  }

  #shapeFields(value: DataflowValue): ReadonlySet<string> {
    const fields = new Set<string>();
    if (value.kind !== "object") return fields;
    for (const [name, fieldValue] of value.properties) {
      if (
        fingerprintFields.has(name) &&
        (fieldValue.kind === "schema" || fieldValue.kind === "validator")
      ) {
        fields.add(name);
      }
    }
    return fields;
  }

  #schemaFields(value: DataflowValue): ReadonlySet<string> {
    if (value.kind === "schema") return value.fields;
    if (value.kind !== "array") return new Set();
    return combinedFields(...value.items.map((item) => this.#schemaFields(item)));
  }

  #propertyValue(
    receiver: DataflowValue,
    name: string,
    location: ts.Node,
    context: DataflowContext,
  ): DataflowValue {
    if (receiver.kind === "object") return receiver.properties.get(name) ?? UNKNOWN_VALUE;
    if (receiver.kind === "zod_namespace" || receiver.kind === "zod_root") {
      if (name === "z" || zodSubrootNames.has(name)) return ZOD_ROOT_VALUE;
      if (zodShapeBuilderNames.has(name)) return builderValue("shape");
      if (zodStaticCompositionNames.has(name)) return builderValue("schema");
      return VALIDATOR_FACTORY_VALUE;
    }
    if (receiver.kind === "schema") {
      if (runtimeValidationMethods.has(name)) return UNKNOWN_VALUE;
      if (zodShapeExtensionNames.has(name)) return builderValue("shape", receiver.fields);
      if (zodSchemaCompositionNames.has(name)) return builderValue("schema", receiver.fields);
      return { fields: receiver.fields, kind: "method", result: "schema" };
    }
    if (receiver.kind === "validator") {
      if (runtimeValidationMethods.has(name)) return UNKNOWN_VALUE;
      return { fields: new Set(), kind: "method", result: "validator" };
    }
    const symbol = this.#checker.getSymbolAtLocation(location);
    return symbol === undefined ? UNKNOWN_VALUE : this.#resolveSymbol(symbol, context);
  }

  #resolveIdentifier(node: ts.Identifier, context: DataflowContext): DataflowValue {
    const symbol = this.#checker.getSymbolAtLocation(node);
    if (symbol === undefined) return UNKNOWN_VALUE;
    return context.environment.get(symbol) ?? this.#resolveSymbol(symbol, context);
  }

  #resolveSymbol(symbol: ts.Symbol, context: DataflowContext): DataflowValue {
    const environmentValue = context.environment.get(symbol);
    if (environmentValue !== undefined) return environmentValue;
    if (context.resolving.has(symbol)) return UNKNOWN_VALUE;
    const resolving = new Set(context.resolving);
    resolving.add(symbol);
    const next = this.#nextContext(context, { resolving });
    for (const declaration of symbol.declarations ?? []) {
      const importValue = this.#importValue(declaration);
      if (importValue.kind !== "unknown") return importValue;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        return this.#evaluate(declaration.initializer, next);
      }
      if (ts.isBindingElement(declaration)) {
        const variable = this.#ancestorVariableDeclaration(declaration);
        if (variable?.initializer !== undefined) {
          const receiver = this.#evaluate(variable.initializer, next);
          const propertyName =
            declaration.propertyName === undefined
              ? ts.isIdentifier(declaration.name)
                ? declaration.name.text
                : undefined
              : propertyNameText(declaration.propertyName);
          if (propertyName !== undefined) {
            return this.#propertyValue(receiver, propertyName, declaration, next);
          }
        }
      }
      if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) {
        return {
          captured: new Map(context.environment),
          kind: "closure",
          node: declaration,
        };
      }
      if (ts.isPropertyAssignment(declaration)) {
        return this.#evaluate(declaration.initializer, next);
      }
      if (ts.isMethodDeclaration(declaration) && declaration.body !== undefined) {
        return {
          captured: new Map(context.environment),
          kind: "closure",
          node: declaration,
        };
      }
    }
    return UNKNOWN_VALUE;
  }

  #importValue(declaration: ts.Declaration): DataflowValue {
    let current: ts.Node | undefined = declaration;
    while (current !== undefined && !ts.isImportDeclaration(current)) current = current.parent;
    if (current !== undefined && ts.isImportDeclaration(current)) {
      if (!isStringModuleSpecifier(current.moduleSpecifier, "zod")) return UNKNOWN_VALUE;
      if (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) {
        return ZOD_NAMESPACE_VALUE;
      }
      if (ts.isImportSpecifier(declaration)) {
        const importedName = declaration.propertyName?.text ?? declaration.name.text;
        if (importedName === "z") return ZOD_ROOT_VALUE;
        if (zodShapeBuilderNames.has(importedName)) return builderValue("shape");
        if (zodStaticCompositionNames.has(importedName)) return builderValue("schema");
        return VALIDATOR_FACTORY_VALUE;
      }
    }
    if (
      ts.isImportEqualsDeclaration(declaration) &&
      ts.isExternalModuleReference(declaration.moduleReference) &&
      isStringModuleSpecifier(declaration.moduleReference.expression, "zod")
    ) {
      return ZOD_NAMESPACE_VALUE;
    }
    return UNKNOWN_VALUE;
  }

  #ancestorVariableDeclaration(node: ts.Node): ts.VariableDeclaration | null {
    let current: ts.Node | undefined = node.parent;
    while (current !== undefined && !ts.isVariableDeclaration(current)) current = current.parent;
    return current !== undefined && ts.isVariableDeclaration(current) ? current : null;
  }

  #bindName(
    name: ts.BindingName,
    value: DataflowValue,
    environment: Map<ts.Symbol, DataflowValue>,
    context: DataflowContext,
  ): void {
    if (ts.isIdentifier(name)) {
      const symbol = this.#checker.getSymbolAtLocation(name);
      if (symbol !== undefined) environment.set(symbol, value);
      return;
    }
    if (ts.isArrayBindingPattern(name)) {
      name.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) return;
        const item = value.kind === "array" ? (value.items[index] ?? UNKNOWN_VALUE) : UNKNOWN_VALUE;
        this.#bindName(element.name, item, environment, context);
      });
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const propertyName =
        element.propertyName === undefined
          ? ts.isIdentifier(element.name)
            ? element.name.text
            : undefined
          : propertyNameText(element.propertyName);
      const propertyValue =
        propertyName === undefined
          ? UNKNOWN_VALUE
          : this.#propertyValue(value, propertyName, element, context);
      this.#bindName(element.name, propertyValue, environment, context);
    }
  }

  #invokeClosure(
    closure: Extract<DataflowValue, { readonly kind: "closure" }>,
    arguments_: readonly DataflowValue[],
    context: DataflowContext,
  ): DataflowValue {
    const environment = new Map(closure.captured);
    let argumentIndex = 0;
    for (const parameter of closure.node.parameters) {
      if (parameter.dotDotDotToken !== undefined) {
        this.#bindName(
          parameter.name,
          { items: arguments_.slice(argumentIndex), kind: "array" },
          environment,
          context,
        );
        argumentIndex = arguments_.length;
      } else {
        this.#bindName(
          parameter.name,
          arguments_[argumentIndex] ?? UNKNOWN_VALUE,
          environment,
          context,
        );
        argumentIndex += 1;
      }
    }
    const bodyContext = this.#nextContext(context, { environment });
    const body = closure.node.body;
    if (body === undefined) return UNKNOWN_VALUE;
    if (!ts.isBlock(body)) return this.#evaluate(body, bodyContext);

    let result: DataflowValue = UNKNOWN_VALUE;
    const visit = (node: ts.Node): void => {
      if (
        node !== body &&
        (ts.isArrowFunction(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isMethodDeclaration(node))
      ) {
        return;
      }
      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        const returned = this.#evaluate(node.expression, bodyContext);
        if (result.kind === "unknown" && returned.kind !== "unknown") result = returned;
        return;
      }
      if (ts.isCallExpression(node)) {
        this.#evaluateCall(node, bodyContext);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    return result;
  }
}

function localContractFields(
  node: ts.Node,
  dataflow: ZodContractDataflow,
): ReadonlySet<string> | null {
  if (ts.isInterfaceDeclaration(node)) {
    return collectFingerprintFields(node);
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return collectFingerprintFields(node.type);
  }
  if (ts.isClassDeclaration(node)) {
    const fields = new Set<string>();
    for (const member of node.members) {
      if (ts.isPropertyDeclaration(member)) {
        const name = propertyNameText(member.name);
        if (name !== undefined && fingerprintFields.has(name)) fields.add(name);
      }
    }
    return fields;
  }
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
    return dataflow.contractFields(node.initializer);
  }
  return null;
}

function moduleSpecifierText(node: ts.Expression | undefined): string | null {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function importsOfficialAcp(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const isOfficial = (value: string | null): boolean =>
    value === "@agentclientprotocol/sdk" || value?.startsWith("@agentclientprotocol/sdk/") === true;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) && isOfficial(moduleSpecifierText(node.moduleSpecifier))) ||
      (ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        isOfficial(moduleSpecifierText(node.moduleReference.expression))) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        isOfficial(moduleSpecifierText(node.arguments[0])))
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function analyzeSource(path: string, source: string): SourceAnalysis {
  const { checker, sourceFile } = createAuditProgram(path, source);
  const dataflow = new ZodContractDataflow(checker);
  const declarationNames = new Set<string>();
  const allFields = collectFingerprintFields(sourceFile);
  let hasLocalContractFingerprint = false;
  const visitDeclarations = (node: ts.Node): void => {
    if (
      (ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name !== undefined
    ) {
      declarationNames.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarationNames.add(node.name.text);
    }
    const fields = localContractFields(node, dataflow);
    if (fields !== null && hasProtocolFingerprint(fields)) {
      hasLocalContractFingerprint = true;
    }
    ts.forEachChild(node, visitDeclarations);
  };
  visitDeclarations(sourceFile);

  const bindingNodes = collectSharedBindings(sourceFile);
  const bindingSymbols = new Set(
    [...bindingNodes]
      .map((node) => checker.getSymbolAtLocation(node))
      .filter((symbol): symbol is ts.Symbol => symbol !== undefined),
  );
  let usesImportedSharedSymbol = false;
  const visitReferences = (node: ts.Node): void => {
    if (usesImportedSharedSymbol) return;
    if (ts.isShorthandPropertyAssignment(node)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(node);
      if (symbol !== undefined && bindingSymbols.has(symbol)) {
        usesImportedSharedSymbol = true;
        return;
      }
    } else if (ts.isIdentifier(node) && !bindingNodes.has(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && bindingSymbols.has(symbol)) {
        usesImportedSharedSymbol = true;
        return;
      }
    }
    ts.forEachChild(node, visitReferences);
  };
  visitReferences(sourceFile);

  return {
    declarationNames,
    hasLocalContractFingerprint,
    hasProtocolFingerprint: hasProtocolFingerprint(allFields),
    importsOfficialAcp: importsOfficialAcp(sourceFile),
    usesImportedSharedSymbol,
  };
}

function fingerprintViolation(path: string, source: string): boolean {
  if (isTestSource(path) || allowedLocalPresentationTypes.has(path)) return false;
  const analysis = analyzeSource(path, source);
  return (
    analysis.hasLocalContractFingerprint ||
    (analysis.hasProtocolFingerprint && !analysis.usesImportedSharedSymbol)
  );
}

describe("workspace shared-contract consumer audit", () => {
  beforeAll(async () => {
    const paths = await sourceFiles();
    const sources = await Promise.all(
      paths.map(async (path) => ({
        path,
        source: await readFile(resolve(workspaceRoot, path), "utf8"),
      })),
    );
    auditedSources = sources.map(({ path, source }) => ({
      analysis: path.startsWith("packages/shared/src/") ? null : analyzeSource(path, source),
      path,
      source,
    }));
  }, 30_000);

  it("keeps wire protocol declarations exclusively in @dougoos/shared", () => {
    const violations: string[] = [];
    for (const { analysis, path } of auditedSources) {
      if (analysis === null) continue;
      if (protocolNames.some((name) => analysis.declarationNames.has(name))) {
        violations.push(`${path}: redeclares a shared protocol name`);
      }
      if (
        !isTestSource(path) &&
        !allowedLocalPresentationTypes.has(path) &&
        (analysis.hasLocalContractFingerprint ||
          (analysis.hasProtocolFingerprint && !analysis.usesImportedSharedSymbol))
      ) {
        violations.push(`${path}: protocol field fingerprint without shared import`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("allows named presentation/fixture types only in explicit reviewed files", () => {
    const violations: string[] = [];
    for (const { analysis, path } of auditedSources) {
      if (analysis === null) continue;
      if (
        presentationNamesRestrictedToAllowlist.some((name) =>
          analysis.declarationNames.has(name),
        ) &&
        !allowedLocalPresentationTypes.has(path)
      ) {
        violations.push(`${path}: local presentation type is not allowlisted`);
      }
    }
    expect(violations).toEqual([]);
    expect([...allowedLocalPresentationTypes.values()].every((reason) => reason.length > 20)).toBe(
      true,
    );
  });

  it("requires package imports and contains official ACP types inside the acp package", () => {
    const violations: string[] = [];
    for (const { analysis, path, source } of auditedSources) {
      if (/from\s+["'][^"']*packages\/shared\/src|from\s+["'][^"']*shared\/src/u.test(source)) {
        violations.push(`${path}: bypasses @dougoos/shared package exports`);
      }
      if (
        path !== "packages/shared/src/consumer-audit.test.ts" &&
        (analysis?.importsOfficialAcp ?? importsOfficialAcp(parseAuditSource(path, source))) &&
        !path.startsWith("packages/acp/")
      ) {
        violations.push(`${path}: imports official ACP protocol types outside packages/acp`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("catches renamed schema/class copies and every ACP module-loading form", () => {
    const renamedCopies = [
      `
        const CopiedEnvelopeSchema = z.object({
          eventId: z.string(), seq: z.number(), sessionId: z.string(), turnId: z.string()
        });
      `,
      `
        class RenamedSnapshot {
          eventId!: string;
          seq!: number;
          sessionId!: string;
        }
      `,
      `
        const RenamedError = z.object({
          code: z.string(), message: z.string(), details: z.object({})
        });
      `,
    ];
    for (const source of renamedCopies) {
      expect(fingerprintViolation("packages/rogue/src/copied.cjs", source)).toBe(true);
      expect(
        fingerprintViolation(
          "packages/rogue/src/copied.cjs",
          `${source}\nconst shared = require("@dougoos/shared");`,
        ),
      ).toBe(true);
    }
    const copiedBuilderAliases = [
      `
        import { z as schema } from "zod";
        const CopiedEnvelope = schema.object({
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
      `
        import * as Zod from "zod";
        const CopiedEnvelope = Zod.z.strictObject({
          eventId: Zod.z.string(), seq: Zod.z.number(),
          sessionId: Zod.z.string(), turnId: Zod.z.string()
        }).superRefine(() => undefined);
      `,
      `
        const { z: schema } = require("zod");
        const CopiedEnvelope = schema.object({
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        }).strict();
      `,
      `
        import { z } from "zod";
        const schema = z;
        const CopiedEnvelope = schema.object({
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
      `
        import { z as schema } from "zod";
        const objectBuilder = schema.object;
        const CopiedEnvelope = objectBuilder({
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
      `
        import { z as schema } from "zod";
        const wrapper = { define: schema.object };
        const CopiedEnvelope = wrapper.define({
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
    ];
    for (const source of copiedBuilderAliases) {
      expect(
        fingerprintViolation(
          "packages/rogue/src/copied.ts",
          `
            import { AgentEventEnvelopeSchema } from "@dougoos/shared";
            AgentEventEnvelopeSchema.parse(input);
            ${source}
          `,
        ),
      ).toBe(true);
    }
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          const projected = { eventId, seq, sessionId, turnId };
        `,
      ),
    ).toBe(true);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          const metadata = { AgentEventEnvelopeSchema: "schema" };
          const projected = { eventId, seq, sessionId, turnId };
        `,
      ),
    ).toBe(true);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          function inspect(AgentEventEnvelopeSchema: { parse(value: unknown): void }) {
            AgentEventEnvelopeSchema.parse(input);
          }
          const projected = { eventId, seq, sessionId, turnId };
        `,
      ),
    ).toBe(true);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          AgentEventEnvelopeSchema.parse({ eventId, seq, sessionId, turnId });
        `,
      ),
    ).toBe(false);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          AgentEventEnvelopeSchema.parse(input);
          const projected = buildProjection({
            eventId: makeEventId(),
            seq: nextSequence(),
            sessionId: currentSessionId(),
            turnId: currentTurnId()
          });
        `,
      ),
    ).toBe(false);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          AgentEventEnvelopeSchema.parse({
            eventId: makeEventId(),
            seq: nextSequence(),
            sessionId: currentSessionId(),
            turnId: currentTurnId()
          });
        `,
      ),
    ).toBe(false);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.cjs",
        `
          const { AgentEventEnvelopeSchema } = require("@dougoos/shared");
          AgentEventEnvelopeSchema.parse({ eventId, seq, sessionId, turnId });
        `,
      ),
    ).toBe(false);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.mjs",
        `
          const shared = await import("@dougoos/shared");
          shared.AgentEventEnvelopeSchema.parse({ eventId, seq, sessionId, turnId });
        `,
      ),
    ).toBe(false);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          // AgentEventEnvelopeSchema
          const note = "AgentEventEnvelopeSchema";
          const projected = { eventId, seq, sessionId, turnId };
        `,
      ),
    ).toBe(true);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          const { AgentEventEnvelopeSchema } = await import("@dougoos/shared");
          AgentEventEnvelopeSchema.parse({ eventId, seq, sessionId, turnId });
        `,
      ),
    ).toBe(false);
    expect(
      fingerprintViolation(
        "packages/core/src/projector.ts",
        `
          import { AgentEventEnvelopeSchema } from "@dougoos/shared";
          import { z } from "zod";
          AgentEventEnvelopeSchema.parse(input);
          const CopiedEnvelopeSchema = z.object({
            eventId: z.string(), seq: z.number(), sessionId: z.string(), turnId: z.string()
          });
        `,
      ),
    ).toBe(true);
    for (const source of [
      `import "@agentclientprotocol/sdk";`,
      `await import("@agentclientprotocol/sdk");`,
      `require("@agentclientprotocol/sdk");`,
    ]) {
      expect(analyzeSource("packages/rogue/src/acp.ts", source).importsOfficialAcp).toBe(true);
    }
  });

  it("tracks Zod builder, shape, validator, wrapper, and chain dataflow without name guessing", () => {
    const sharedUse = `
      import { AgentEventEnvelopeSchema } from "@dougoos/shared";
      AgentEventEnvelopeSchema.parse(input);
    `;
    const copiedContracts = [
      `
        import { z as schema } from "zod";
        const shape = {
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        };
        const Copied = schema.object(shape);
      `,
      `
        import { z as schema } from "zod";
        const text = schema.string();
        const num = schema.number();
        const wrapper = { define: schema.object };
        const Copied = wrapper.define({
          eventId: text, seq: num, sessionId: text, turnId: text
        });
      `,
      `
        import * as Zod from "zod";
        const root = Zod.z;
        const make = root.object;
        const textFactory = root.string;
        const text = textFactory();
        const base = { eventId: text, seq: root.number() };
        const tail = { sessionId: text, turnId: text };
        const shape = { ...base, ...tail };
        const Copied = make(shape).strict().superRefine(() => undefined);
      `,
      `
        const { z: schema } = require("zod");
        const wrap = (builder) => ({ define: builder });
        const wrapper = wrap(schema.object);
        const text = schema.string();
        const Copied = wrapper.define({
          eventId: text, seq: schema.number(), sessionId: text, turnId: text
        });
      `,
      `
        import { z as schema } from "zod";
        const wrap = (builder) => (shape) => builder(shape);
        const define = wrap(schema.object);
        const text = schema.string();
        const Copied = define({
          eventId: text, seq: schema.number(), sessionId: text, turnId: text
        });
      `,
      `
        import { z as schema } from "zod";
        const text = schema.string();
        const shape = {
          eventId: text, seq: schema.number(), sessionId: text, turnId: text
        };
        const Base = schema.object({});
        const Copied = Base.extend(shape);
      `,
      `
        import { z as schema } from "zod";
        const Base = schema.object({
          eventId: schema.string(), seq: schema.number()
        });
        const Copied = Base.extend({
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
      `
        import { z as schema } from "zod";
        const A = schema.object({
          eventId: schema.string(), seq: schema.number()
        });
        const B = schema.object({
          sessionId: schema.string(), turnId: schema.string()
        });
        const Copied = schema.intersection(A, B);
      `,
      `
        import { z as schema } from "zod";
        const A = schema.object({
          eventId: schema.string(), seq: schema.number()
        });
        const B = schema.object({
          sessionId: schema.string(), turnId: schema.string()
        });
        const Copied = A.merge(B).strict();
      `,
      `
        import { z as schema } from "zod";
        const A = schema.object({
          eventId: schema.string(), seq: schema.number()
        });
        const B = schema.object({
          sessionId: schema.string(), turnId: schema.string()
        });
        const Copied = A.and(B);
      `,
      `
        import { z as schema } from "zod";
        const Base = schema.object({
          eventId: schema.string(), seq: schema.number()
        });
        const Copied = Base.safeExtend({
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
      `
        import { z as schema } from "zod";
        const wrap = (builder) => (...args) => builder(...args);
        const define = wrap(schema.object);
        const Copied = define({
          eventId: schema.string(), seq: schema.number(),
          sessionId: schema.string(), turnId: schema.string()
        });
      `,
    ];
    for (const source of copiedContracts) {
      expect(
        fingerprintViolation("packages/rogue/src/dataflow-copy.ts", `${sharedUse}\n${source}`),
      ).toBe(true);
    }

    const legitimateProjections = [
      `
        import { z as unusedSchema } from "zod";
        function object(value) { return value; }
        const projected = object({
          eventId: makeEventId(), seq: nextSequence(),
          sessionId: currentSessionId(), turnId: currentTurnId()
        });
      `,
      `
        const wrap = (builder) => ({ define: builder });
        const buildProjection = (value) => value;
        const projected = wrap(buildProjection).define({
          eventId: makeEventId(), seq: nextSequence(),
          sessionId: currentSessionId(), turnId: currentTurnId()
        });
      `,
      `
        import { z as schema } from "zod";
        const buildProjection = (value) => value;
        const helper = { object: buildProjection };
        const projected = helper.object({
          eventId: makeEventId(), seq: nextSequence(),
          sessionId: currentSessionId(), turnId: currentTurnId()
        });
      `,
      `
        import { z as schema } from "zod";
        const runtime = { object: (value) => value };
        function project(schema) {
          return schema.object({
            eventId: makeEventId(), seq: nextSequence(),
            sessionId: currentSessionId(), turnId: currentTurnId()
          });
        }
        const projected = project(runtime);
      `,
      `
        import { z as schema } from "zod";
        const UnrelatedA = schema.object({
          eventId: schema.string(), seq: schema.number()
        });
        const UnrelatedB = schema.object({
          sessionId: schema.string(), turnId: schema.string()
        });
        const unrelatedSchemas = [UnrelatedA, UnrelatedB];
      `,
    ];
    for (const source of legitimateProjections) {
      expect(
        fingerprintViolation("packages/core/src/dataflow-projection.ts", `${sharedUse}\n${source}`),
      ).toBe(false);
    }
  });
});

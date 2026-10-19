// A small JSON Schema (draft 2020-12) evaluator covering the keywords used by
// schema/scenario.schema.json. No dependencies. Unknown keywords are ignored,
// so keep the schema to this subset: type, enum, const, pattern, minLength,
// maxLength, minimum, maximum, required, properties, additionalProperties,
// items, minItems, contains, $ref (local #/$defs only), allOf, if/then/else, not.

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
};

const matchesType = (v, t) => t === typeOf(v) || (t === "number" && typeof v === "number");

export function validateSchema(root, value) {
  const errors = [];
  const regexCache = new Map();
  const re = (p) => {
    if (!regexCache.has(p)) regexCache.set(p, new RegExp(p, "u"));
    return regexCache.get(p);
  };
  const resolve = (ref) => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
    return ref.slice(2).split("/").reduce((node, key) => node[key], root);
  };

  function check(schema, v, path, out) {
    if (schema === true) return;
    if (schema === false) return out.push(`${path}: not allowed`);
    if (schema.$ref) check(resolve(schema.$ref), v, path, out);
    if (schema.type && ![].concat(schema.type).some((t) => matchesType(v, t))) {
      return out.push(`${path}: must be ${[].concat(schema.type).join(" or ")}`);
    }
    if ("const" in schema && v !== schema.const) out.push(`${path}: must be ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.includes(v)) out.push(`${path}: must be one of ${schema.enum.join(", ")}`);
    if (typeof v === "string") {
      if (schema.minLength !== undefined && [...v].length < schema.minLength) out.push(`${path}: too short`);
      if (schema.maxLength !== undefined && [...v].length > schema.maxLength) out.push(`${path}: too long`);
      if (schema.pattern && !re(schema.pattern).test(v)) out.push(`${path}: does not match ${schema.pattern}`);
    }
    if (typeof v === "number") {
      if (schema.minimum !== undefined && v < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
      if (schema.maximum !== undefined && v > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
    }
    if (typeOf(v) === "object") {
      for (const k of schema.required ?? []) if (!(k in v)) out.push(`${path}: missing "${k}"`);
      for (const [k, val] of Object.entries(v)) {
        if (schema.properties && k in schema.properties) check(schema.properties[k], val, `${path}.${k}`, out);
        else if (schema.additionalProperties !== undefined) check(schema.additionalProperties, val, `${path}.${k}`, out);
      }
    }
    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems) out.push(`${path}: needs at least ${schema.minItems} item(s)`);
      if (schema.items) v.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, out));
      if (schema.contains && !v.some((item) => { const e = []; check(schema.contains, item, path, e); return e.length === 0; })) {
        out.push(`${path}: no item matches the required "contains" rule`);
      }
    }
    for (const sub of schema.allOf ?? []) check(sub, v, path, out);
    if (schema.if) {
      const e = [];
      check(schema.if, v, path, e);
      if (e.length === 0 && schema.then) check(schema.then, v, path, out);
      if (e.length > 0 && schema.else) check(schema.else, v, path, out);
    }
    if (schema.not) {
      const e = [];
      check(schema.not, v, path, e);
      if (e.length === 0) out.push(`${path}: matches a forbidden shape`);
    }
  }

  check(root, value, "$", errors);
  return errors;
}

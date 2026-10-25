// A small JSON Schema (2020-12) checker for the keywords the Lab dispatch schemas use: type (one or a list), const,
// required, properties, additionalProperties (false or a schema), pattern, minLength, maxLength, minimum, items (one
// schema for every item), minItems, uniqueItems, allOf, oneOf and if/then. The repo installs no schema library (the lockfile is frozen), and a keyword this checker
// does not know is an error, never a silent pass, so a schema that grows past this subset fails closed.
const KNOWN = new Set(['$schema', '$id', '$comment', 'title', 'description', 'type', 'const', 'required', 'properties',
  'additionalProperties', 'pattern', 'minLength', 'maxLength', 'minimum', 'items', 'minItems', 'uniqueItems', 'allOf', 'oneOf', 'if', 'then']);

const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array'
  : Number.isInteger(value) ? 'integer' : typeof value;
const isType = (value, type) => type === 'number' ? typeof value === 'number' : typeOf(value) === type;
const pointer = (at, key) => `${at}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

/** Every way `value` breaks `schema`, as "<json pointer>: <reason>" lines; an empty list when it conforms. */
export function validate(schema, value, at = '') {
  const unknown = Object.keys(schema).filter(key => !KNOWN.has(key));
  if (unknown.length) return [`${at || '/'}: the schema uses a keyword this checker does not know: ${unknown.join(', ')}`];
  // A keyword in a form this checker does not apply is refused the same way, never half-applied.
  const forms = [['additionalProperties', v => v === false || v === true || (v !== null && typeof v === 'object' && !Array.isArray(v))],
    ['items', v => v !== null && typeof v === 'object' && !Array.isArray(v)], ['minItems', Number.isInteger]];
  const badForm = forms.filter(([key, ok]) => key in schema && !ok(schema[key])).map(([key]) => key);
  if (badForm.length) return [`${at || '/'}: the schema uses a form of ${badForm.join(', ')} this checker does not apply`];
  const problems = [];
  const types = schema.type === undefined ? null : [schema.type].flat();
  if (types && !types.some(type => isType(value, type))) return [`${at || '/'}: expected ${types.join(' or ')}, found ${typeOf(value)}`];
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) problems.push(`${at || '/'}: must be ${JSON.stringify(schema.const)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) problems.push(`${at || '/'}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) problems.push(`${at || '/'}: longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) problems.push(`${at || '/'}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) problems.push(`${at || '/'}: below ${schema.minimum}`);
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${at || '/'}: missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties && key in schema.properties) problems.push(...validate(schema.properties[key], child, pointer(at, key)));
      else if (schema.additionalProperties === false) problems.push(`${pointer(at, key)}: not allowed`);
      else if (typeof schema.additionalProperties === 'object') problems.push(...validate(schema.additionalProperties, child, pointer(at, key)));
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at || '/'}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, index) => problems.push(...validate(schema.items, item, pointer(at, index))));
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) problems.push(`${at || '/'}: items are not unique`);
  }
  for (const part of schema.allOf ?? []) problems.push(...validate(part, value, at));
  if (schema.if && validate(schema.if, value, at).length === 0 && schema.then) problems.push(...validate(schema.then, value, at));
  if (schema.oneOf) {
    const passing = schema.oneOf.filter(part => validate(part, value, at).length === 0).length;
    if (passing !== 1) problems.push(`${at || '/'}: matches ${passing} of the oneOf branches, expected exactly 1`);
  }
  return problems;
}

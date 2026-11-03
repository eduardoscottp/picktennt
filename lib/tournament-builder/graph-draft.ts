import { graphNodeSchemas, type DefinitionJsonSchema } from './definition-schema';
import type { ValidationResult } from './definition';

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Check supplied graph vocabulary and collect missing decisions before semantic graph validation. */
export function checkGraphDraft(nodes: unknown, result: ValidationResult): void {
  function missingDiscriminator(value: unknown, variants: DefinitionJsonSchema[], discriminator: string, required: string[], path: string) {
    const compatible = object(value) ? variants.filter(v => Object.keys(value).every(key => Object.hasOwn(v.properties!, key))) : [];
    const properties = compatible[0]?.properties ?? Object.assign({}, ...variants.map(v => v.properties));
    check(value, { type: 'object', properties: { ...properties, [discriminator]: { enum: variants.flatMap(v => v.properties![discriminator].enum!) } }, required }, path);
  }
  function check(value: unknown, schema: DefinitionJsonSchema, path: string) {
    if (value === undefined) { result.missing_fields.push({ code: 'MISSING_FIELD', field_path: path, message: `Specify ${path}.`, constraints: schema }); return; }
    const invalid = () => result.errors.push({ code: 'UNSUPPORTED_RULE', field_path: path, message: `Value does not match the block contract for ${path}.`, constraints: schema });
    if (schema.enum) { if (!schema.enum.includes(value)) invalid(); return; }
    if (schema.type === 'object') {
      if (!object(value)) { invalid(); return; }
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties!, key)) result.errors.push({ code: 'UNSUPPORTED_RULE', field_path: `${path}.${key}`, message: 'Unknown block field.' });
      for (const [key, rule] of Object.entries(schema.properties!)) if (Object.hasOwn(value, key) || schema.required?.includes(key)) check(value[key], rule, `${path}.${key}`);
    } else if (schema.type === 'array') {
      if (!Array.isArray(value) || value.length > schema.maxItems! || value.length < schema.minItems!) { invalid(); return; }
      value.forEach((item, i) => {
        const variants = schema.items!.oneOf;
        if (!variants) { check(item, schema.items!, `${path}[${i}]`); return; }
        if (!object(item) || item.kind === undefined) { missingDiscriminator(item, variants, 'kind', ['kind'], `${path}[${i}]`); return; }
        const variant = variants.find(v => v.properties!.kind.enum!.includes(item.kind));
        if (variant) check(item, variant, `${path}[${i}]`); else result.errors.push({ code: 'UNSUPPORTED_RULE', field_path: `${path}[${i}].kind`, message: 'Unknown source kind.' });
      });
    } else if (schema.type === 'integer') {
      if (!Number.isInteger(value) || Number(value) < schema.minimum! || Number(value) > schema.maximum!) invalid();
    } else if (schema.type === 'string' && (typeof value !== 'string' || !new RegExp(schema.pattern!).test(value) || value.length > schema.maxLength!)) invalid();
  }
  if (nodes === undefined || Array.isArray(nodes) && nodes.length === 0) { result.missing_fields.push({ code: 'MISSING_FIELD', field_path: 'nodes', message: 'Specify tournament blocks and connections.' }); return; }
  if (!Array.isArray(nodes) || nodes.length > 64) { result.errors.push({ code: 'UNSUPPORTED_RULE', field_path: 'nodes', message: 'Use at most 64 blocks.' }); return; }
  const shapes = graphNodeSchemas();
  nodes.forEach((node, i) => {
    if (!object(node) || node.module === undefined) { missingDiscriminator(node, shapes, 'module', ['id', 'module'], `nodes[${i}]`); return; }
    const shape = shapes.find(s => s.properties!.module.enum!.includes(node.module));
    if (shape) check(node, shape, `nodes[${i}]`); else result.errors.push({ code: 'UNSUPPORTED_MODULE', field_path: `nodes[${i}].module`, message: 'Unknown graph module.' });
  });
}

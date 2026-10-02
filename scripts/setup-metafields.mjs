#!/usr/bin/env node
/**
 * Creates the metaobject and product metafield definitions this theme reads.
 * Safe to re-run: definitions that already exist are reported and skipped.
 *
 * Requires a custom app Admin API token with:
 *   write_metaobject_definitions, write_products
 *
 * Usage:
 *   SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx npm run setup:metafields
 */

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

if (!STORE || !TOKEN) {
  console.error('Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN first.');
  process.exit(1);
}

const IMAGE_ONLY = [{ name: 'file_type_options', value: JSON.stringify(['Image']) }];

const METAOBJECTS = [
  {
    type: 'spec_sheet',
    name: 'Spec sheet',
    description: 'Reusable size / capacity / specification table. Many products can share one sheet.',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      {
        key: 'table',
        name: 'Table',
        type: 'multi_line_text_field',
        required: true,
        description: 'First line is the header row. One row per line, cells separated by | (e.g. "Size | Capacity | Height").',
      },
      { key: 'notes', name: 'Notes', type: 'multi_line_text_field', description: 'Shown under the table, e.g. how it was measured.' },
      { key: 'diagram', name: 'Diagram', type: 'file_reference', validations: IMAGE_ONLY },
    ],
  },
  {
    type: 'brew_guide',
    name: 'Brew guide',
    description: 'Recipe card rendered on product pages and blog posts.',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'method', name: 'Method', type: 'single_line_text_field', description: 'e.g. Pour-over, French press' },
      { key: 'dose_g', name: 'Coffee dose (g)', type: 'number_decimal' },
      { key: 'water_g', name: 'Water (g)', type: 'number_integer' },
      { key: 'temperature_c', name: 'Water temperature (°C)', type: 'number_integer' },
      { key: 'grind', name: 'Grind size', type: 'single_line_text_field' },
      { key: 'total_time', name: 'Total time', type: 'single_line_text_field', description: 'e.g. 3:30' },
      { key: 'steps', name: 'Steps', type: 'list.single_line_text_field' },
      { key: 'image', name: 'Image', type: 'file_reference', validations: IMAGE_ONLY },
    ],
  },
  {
    type: 'faq_item',
    name: 'FAQ item',
    description: 'Question and answer, reusable across products and the FAQ page.',
    displayNameKey: 'question',
    fieldDefinitions: [
      { key: 'question', name: 'Question', type: 'single_line_text_field', required: true },
      { key: 'answer', name: 'Answer', type: 'rich_text_field', required: true },
    ],
  },
];

// `metaobject` is resolved to a definition GID after the metaobjects are created.
const PRODUCT_METAFIELDS = [
  { key: 'highlights', name: 'Highlights', type: 'list.single_line_text_field', description: 'Short selling points shown under the price. Keep each under ~60 characters.' },
  { key: 'spec_sheet', name: 'Spec sheet', type: 'metaobject_reference', metaobject: 'spec_sheet' },
  { key: 'brew_guide', name: 'Brew guide', type: 'metaobject_reference', metaobject: 'brew_guide' },
  { key: 'faqs', name: 'FAQs', type: 'list.metaobject_reference', metaobject: 'faq_item' },
  { key: 'bundle_products', name: 'Complete the set', type: 'list.product_reference', description: 'Products offered as add-ons on this product page.' },
  { key: 'material', name: 'Material', type: 'single_line_text_field' },
  { key: 'capacity_ml', name: 'Capacity (ml)', type: 'number_integer' },
  { key: 'dishwasher_safe', name: 'Dishwasher safe', type: 'boolean' },
  { key: 'warranty_years', name: 'Warranty (years)', type: 'number_integer' },
];

async function gql(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors, null, 2));
  return body.data;
}

const isTaken = (errors) => errors.some((e) => e.code === 'TAKEN');

async function ensureMetaobject(def) {
  const data = await gql(
    `mutation ($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id type }
        userErrors { field message code }
      }
    }`,
    { definition: { ...def, access: { storefront: 'PUBLIC_READ' } } },
  );
  const { metaobjectDefinition, userErrors } = data.metaobjectDefinitionCreate;
  if (metaobjectDefinition) {
    console.log(`  created  metaobject ${def.type}`);
    return metaobjectDefinition.id;
  }
  if (!isTaken(userErrors)) throw new Error(`${def.type}: ${JSON.stringify(userErrors)}`);

  const existing = await gql(`query ($type: String!) { metaobjectDefinitionByType(type: $type) { id } }`, { type: def.type });
  console.log(`  exists   metaobject ${def.type}`);
  return existing.metaobjectDefinitionByType.id;
}

async function ensureProductMetafield({ metaobject, ...def }, metaobjectIds) {
  const validations = metaobject ? [{ name: 'metaobject_definition_id', value: metaobjectIds[metaobject] }] : [];
  const data = await gql(
    `mutation ($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }`,
    {
      definition: {
        ...def,
        namespace: 'custom',
        ownerType: 'PRODUCT',
        validations,
        pin: true,
        access: { storefront: 'PUBLIC_READ' },
      },
    },
  );
  const { createdDefinition, userErrors } = data.metafieldDefinitionCreate;
  if (createdDefinition) return console.log(`  created  product.metafields.custom.${def.key}`);
  if (isTaken(userErrors)) return console.log(`  exists   product.metafields.custom.${def.key}`);
  throw new Error(`custom.${def.key}: ${JSON.stringify(userErrors)}`);
}

console.log(`Setting up definitions on ${STORE} (API ${API_VERSION})`);
const metaobjectIds = {};
for (const def of METAOBJECTS) metaobjectIds[def.type] = await ensureMetaobject(def);
for (const def of PRODUCT_METAFIELDS) await ensureProductMetafield(def, metaobjectIds);
console.log('Done.');

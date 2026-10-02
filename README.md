# Hearth & Brew theme

A custom Online Store 2.0 theme for Hearth & Brew, a small coffee-gear brand. It is a fork of
[Dawn 16.0.0](https://github.com/Shopify/dawn) with a custom design layer, merchant-editable
sections and a structured product data model built on metafields and metaobjects.

Everything custom is prefixed `hb` so it stays easy to tell apart from Dawn when merging upstream
changes.

## What's custom

### Sections

All sections have clear labels, presets and color-scheme/padding settings, so they can be added
and arranged from the theme editor on any page.

| Section | Purpose |
| --- | --- |
| `hb-hero` | Split hero with eyebrow, two buttons and a trust line. Ships with a default image. |
| `hb-value-props` | Up to four icon + text selling points. |
| `hb-brew-guide` | Renders a `brew_guide` metaobject: dose, water, ratio (computed), temperature, grind, time and numbered steps. |
| `hb-comparison` | Compares 2–4 products. Rows read product metafields (material, capacity, dishwasher safe, warranty or any `custom.*` key). |
| `hb-bundle` | "Frequently bought together": checkbox list with a live total, adds all selected items in one Cart AJAX call and refreshes the cart drawer through the Section Rendering API. |
| `hb-testimonials` | Review cards with star rating, verified badge and linked product. Swipeable on mobile. |
| `hb-faq` | Accordion fed by `faq_item` metaobjects and/or blocks, with optional FAQPage JSON-LD. |
| `hb-story` | Brand story with image and an ordered milestone timeline. |
| `hb-contact-info` | Email, phone, hours and address with `mailto:`/`tel:` links. |

### Product page blocks

Added to Dawn's `main-product` section:

- **Highlights** (`hb_highlights`) – short bullet list from `custom.highlights`.
- **Spec sheet** (`hb_spec_sheet`) – table from a `spec_sheet` metaobject, opened in a native `<dialog>`.

### Cart

- Free-shipping progress bar in the cart drawer and cart page. Threshold is set in
  **Theme settings > Free shipping bar**; it hides itself for other currencies.

### Empty states

No section renders an empty shell on the storefront. If its data is missing (no metaobject linked,
fewer than two products to compare, all blocks blank), it outputs nothing for shoppers and shows a
short hint only inside the theme editor (`request.design_mode`).

## Data model

`scripts/setup-metafields.mjs` creates these definitions (safe to re-run):

**Metaobjects**

- `spec_sheet` – rows of label/value pairs for the spec table
- `brew_guide` – method, dose, water, temperature, grind, time, steps, image
- `faq_item` – question and rich-text answer

**Product metafields** (namespace `custom`)

`highlights`, `spec_sheet`, `brew_guide`, `faqs`, `bundle_products`, `material`, `capacity_ml`,
`dishwasher_safe`, `warranty_years`

`templates/product.json` connects them as dynamic sources, e.g.
`"{{ product.metafields.custom.brew_guide.value }}"`, so each product shows its own guide, FAQ and
bundle without per-product templates.

## Templates

| Template | Content |
| --- | --- |
| `index.json` | Hero, value props, featured collection, brew guide, comparison, testimonials, FAQ |
| `product.json` | Main product with highlights and spec sheet, bundle, brew guide, FAQ, related products |
| `page.about.json` | Brand story and timeline, value props |
| `page.faq.json` | Page content plus FAQ with structured data |
| `page.contact.json` | Contact details plus Dawn's contact form |

## Getting started

Requires Node 20+ and a Shopify store (a free Partner development store works).

```bash
npm install
npx shopify auth login

# Create metafield and metaobject definitions
# (custom app token with write_metaobject_definitions and write_products)
SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx npm run setup:metafields

npm run dev -- --store your-store       # local preview with hot reload
npm run check                           # Theme Check, fails on errors
npm run push:unpublished -- --store your-store
```

On Windows PowerShell set the variables with `$env:SHOPIFY_STORE="..."` before running the script.

## Migrating from WooCommerce

`scripts/woo-redirects.mjs` turns the old site's URLs into a Shopify redirect import file so search
rankings and old links survive the move.

```bash
npm run redirects:woo -- --urls product-sitemap.xml --urls old-urls.txt \
  --products products_export.csv --blog news --out redirects.csv
```

- `--urls` accepts sitemap XML or a plain list, and can be repeated.
- `--products` (the Shopify products export) makes sure product redirects only point at handles
  that exist.
- Product, category, tag, blog post, shop, cart and account URLs are mapped automatically. Archive
  pages, missing products and unknown patterns go to `redirects-unmatched.csv` for a manual decision.

Import `redirects.csv` under **Online Store > Navigation > URL redirects > Import**.

## License

Based on Dawn, copyright (c) 2021-present Shopify Inc. See [LICENSE](/LICENSE.md).

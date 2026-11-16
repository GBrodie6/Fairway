# Assets

Every external asset is listed here with its source, URL, and license. The table is generated
by `npm run assets` from `scripts/assets/catalog.mjs` plus the license metadata fetched from
each source API at download time. Raw downloads go to `asset-src/` and processed files to
`public/assets/`; both are ignored by git and rebuilt by the pipeline.

Nothing external is used yet at Stage 0. The app icons in `public/icons/` are drawn
procedurally by `scripts/icons.mjs` (original work, no third-party art).

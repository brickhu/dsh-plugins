# DSH plugin market index

This directory is a [DSH plugin market](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market.md)
index (format 1) for the plugins in this repository.

## Add it to DSH

1. Plugins → **More** (Experimental plugins) → enable **Custom plugin markets**.
2. Plugins → **Discover** → **Add index source**.
3. Enter:

   ```
   https://raw.githubusercontent.com/brickhu/dsh-plugins/main/market/index.json
   ```

Or set it directly in the profile's `cordis.patch.yml`:

```yaml
- id: plugin-market
  config:
    indexes:
      - https://raw.githubusercontent.com/brickhu/dsh-plugins/main/market/index.json
```

## Contents

- `index.json` — the market index; one entry per plugin, listing exact published npm versions.
- Update the `versions` array (version + real npm publish timestamp) whenever a plugin is released.

The index is validated by DSH with `@deepseek-ai/dsh-plugin-market-index`; a malformed file is
rejected as a whole, so keep `engines.dsh` and the npm version list in sync with `package.json`.

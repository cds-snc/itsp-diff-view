# ITSP.10.033 Control Diff Viewer

This project builds a local static website for reviewing changes between the existing ITSG-33 YAML catalogue and the March 2026 Canadian Centre for Cyber Security ITSP.10.033 control catalogue.

The viewer provides a searchable table of controls, activities, and enhancements, with filters for change status, family, and type. Selecting a row shows the old text, new text, and a word-level diff where available.

## Data Sources

- Existing local source: `ITSG-33a.yaml`
- Updated Cyber Centre source: <https://www.cyber.gc.ca/en/guidance/cyber-security-privacy-risk-management/itsp10033>

The Cyber Centre catalogue is split across multiple family pages. The data build script fetches those pages, extracts controls and enhancements, normalizes IDs, and computes a diff against the local YAML file.

## Generated Data

Running the data build creates:

- `data/itsg33a-normalized.json` - normalized version of the existing YAML
- `data/itsp10033.json` - normalized new catalogue
- `data/itsp10033.yaml` - YAML version of the new catalogue
- `data/diff.json` - full diff data
- `public/data/catalogue.json` - compact dataset used by the static website
- `data/snapshots/` - downloaded Cyber Centre API responses used as local snapshots

## Local Development

Build or rebuild the data:

```bash
npm run build:data
```

Start the local static server:

```bash
npm run serve
```

Then open:

```text
http://127.0.0.1:4173
```

## GitHub Pages

The workflow at `.github/workflows/pages.yml` publishes the static site to GitHub Pages.

It runs on:

- pushes to `main`
- manual workflow dispatch

The workflow rebuilds the data and uploads the `public/` directory as the Pages artifact.

## Notes

- No frontend build step is required.
- The site is plain HTML, CSS, and JavaScript.
- If Cyber Centre pages are unavailable during a rebuild, existing files under `data/snapshots/` can be used by the build script.

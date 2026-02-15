---
sidebar_position: 13
---

# serve

Serve the generated static site locally.

## Usage

```bash
./ritual serve [options]
```

## Options

| Option                | Description      | Default |
| --------------------- | ---------------- | ------- |
| `-p, --port <number>` | Port to serve on | `3000`  |

## Examples

Serve on default port (3000):

```bash
./ritual serve
```

Serve on a custom port:

```bash
./ritual serve --port 8080
```

## Typical Workflow

1. Build the site:

```bash
./ritual build-site
```

2. Serve it:

```bash
./ritual serve
```

3. Open http://localhost:3000 in your browser

## Notes

- The serve command serves files from the `dist/` directory
- Make sure to run `build-site` first to generate the content
- Press `Ctrl+C` to stop the server

---
sidebar_position: 4
---

# login

Login to a supported website to save authentication tokens for future requests.

## Usage

```bash
./ritual login <site>
```

## Arguments

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `<site>` | The site to login to | Yes      |

## Supported Sites

| Site        | Description                                |
| ----------- | ------------------------------------------ |
| `archidekt` | Login to Archidekt for private deck access |

## Examples

Login to Archidekt:

```bash
./ritual login archidekt
```

## Notes

:::note Moxfield Login

Moxfield login is currently not supported due to an explicit lack of support from Moxfield. You can still import decks from Moxfield using the `import` command, but you cannot upload data to your Moxfield account or access private decks.

:::

## Token Storage

Authentication tokens are stored locally in the `.logins/` directory and are used automatically for subsequent requests.

# cdai - cd with intent

`cd` that understands you. Deterministic and instant 95% of the time, AI only when it helps.

```console
$ cdai bella
→ ~/Dropbox/clients/petalworks

$ cdai latest petalworks folder
→ ~/Dropbox/clients/petalworks/petalworks-2026

$ cdai that client with the flowers
cdai: thinking... (claude sonnet)
cdai: ~/Dropbox/clients/petalworks/petalworks-2026 (petalworks = flower shop client) [Y/n]
→ ~/Dropbox/clients/petalworks/petalworks-2026
```

Measured on a laptop: about 2,500 indexed directories, exact hit in **50ms** end to end,
including Node startup. The AI tier only runs when the deterministic tier is genuinely unsure.

## Demo

![cdai demo](docs/demo.gif)

Recorded with [vhs](https://github.com/charmbracelet/vhs) against the fictional tree built by
`docs/demo-fixture.sh` - reproduce it with `sh docs/demo-fixture.sh && vhs docs/demo.tape`.

## Install

```bash
npm i -g github:franzenzenhofer/cdai
cdai setup                       # detects your project roots, writes the config
echo 'eval "$(cdai init zsh)"' >> ~/.zshrc
exec zsh
```

Or from a clone: `git clone https://github.com/franzenzenhofer/cdai && cd cdai && npm i -g .`

bash: `eval "$(cdai init bash)"` in `~/.bashrc`.
fish: `cdai init fish | source` in `~/.config/fish/config.fish`.
Windows is not supported in v1.

Already using [zoxide](https://github.com/ajeetdsouza/zoxide)? Bring your history along:

```bash
cdai import zoxide
```

## How it works

```
        cdai latest petalworks folder
                    │
                    ▼
        ┌───────────────────────┐
        │ tokenize              │  operators: latest/oldest, 2026, "in dev"
        │                       │  stopwords: folder, dir, the, project, go, to, my
        └───────────┬───────────┘
                    ▼
        ┌───────────────────────┐        ┌──────────────────┐
        │ tier 1: deterministic │◀───────│ index.json  dirs │  rebuilt on miss, TTL 60min
        │ fuzzy + frecency      │◀───────│ db.json frecency │  fed by the shell hook
        └───────────┬───────────┘        └──────────────────┘
                    │
      score >= 550  │  2+ candidates       nothing convincing
      and gap >= 200│  >= 400              │
                    ▼         ▼            ▼
               ┌────────┐ ┌────────┐ ┌──────────────────────┐
               │  jump  │ │ picker │ │ tier 2: ai (optional)│ claude -p, 45s cap,
               │  exit 0│ │  fzf   │ │ answer must exist    │ answer validated against
               └────┬───┘ └───┬────┘ └──────────┬───────────┘ the index before use
                    ▼         ▼                 ▼
              stdout: /the/path        stderr: → ~/the/path
```

**Tier 1 is the product.** Every directory name gets a match class - exact 1000, prefix 800,
word boundary 600, substring 400, fuzzy up to 380 - plus `100 * log2(1 + frecency)` and a small
bonus for living under your current directory. All tokens must match (AND). A directory and its
own parent are collapsed into one answer, because they are the same place, not two options.

**Tier 2 only sees queries tier 1 could not answer.** It gets the query, the top fuzzy
candidates and your most frecent paths, and must reply with one JSON object. The returned path
has to exist on disk *and* sit under a configured root, otherwise it is discarded. A missing
backend, a timeout, or chatty output degrades to fuzzy suggestions, never to a wrong `cd`.

### Deterministic operators

| You type | You get |
|---|---|
| `cdai bella` | best match by fuzzy score and frecency |
| `cdai latest petalworks folder` | newest child directory of the match, by mtime |
| `cdai oldest petalworks` | oldest child directory |
| `cdai petalworks 2025` | year token is a required substring |
| `cdai squash in dev` | `in <root>` restricts the search to one root |
| `cdai ~/some/dir` | plain `cd`, no magic, no lookup |
| `cdai -` | plain `cd -`, back to the previous directory |
| `cdai` | plain `cd ~`, muscle memory stays intact |

## Works without AI

Set `ai.enabled` to `false` in `~/.config/cdai/config.json` and cdai is a fast fuzzy jumper with
frecency, nothing else. Nothing is sent anywhere, no network call is ever made by tier 1, and
every test in this repo except the AI tier ones passes with no backend installed.

`ai.command` is just a command line, so any prompt capable CLI works:

```json
{
  "ai": { "enabled": true, "command": "claude", "model": "sonnet", "timeoutMs": 45000 }
}
```

## cdai vs zoxide

|  | zoxide | cdai |
|---|---|---|
| frecency ranking | yes | yes, same aging formula |
| learns from your shell | yes | yes, chpwd hook, zero subprocesses |
| indexes directories you have never visited | no | yes, configurable roots and depth |
| `latest` / `oldest` / year / `in <root>` | no | yes, deterministic |
| natural language fallback | no | optional, opt out with one config flag |
| runtime dependencies | Rust binary | Node, zero npm dependencies |
| cold jump on an unvisited folder | miss | hit |

zoxide is excellent and cdai steals its best ideas on purpose. The difference is the index: a
folder you have never visited is invisible to a pure frecency tool, and client work lives in
folders you visit once a year.

## Configuration

`~/.config/cdai/config.json` (override with `CDAI_CONFIG_DIR`, data with `CDAI_DATA_DIR`):

```json
{
  "roots": [
    { "path": "/Users/you/dev", "depth": 2 },
    { "path": "/Users/you/Dropbox/clients", "depth": 3 }
  ],
  "ignore": ["node_modules", ".git", "dist", "build", ".venv"],
  "ai": { "enabled": true, "command": "claude", "model": "sonnet", "timeoutMs": 45000 }
}
```

Data lives in `~/.local/share/cdai/`: `index.json` (directory index), `db.json` (frecency),
`visits.log` (append only, ingested and truncated on the next run).

## Commands

```
cdai <words>              jump to the directory you mean
cdai query -- <words>     resolve only, prints the path on stdout
cdai init <zsh|bash|fish> print the shell integration, meant for eval
cdai setup [--yes]        detect project roots and write the config
cdai index [--refresh]    show or rebuild the directory index
cdai import zoxide        seed frecency from an existing zoxide database
cdai doctor               show what cdai sees on this machine
```

Exit codes: `0` a path was printed and the shell should cd, `3` handled but deliberately no cd
(picker aborted, informational command), anything else is an error. stdout carries the resolved
path and nothing else, every human readable byte goes to stderr.

## Development

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

The test suite uses no mocking library and no fake filesystem. Fixtures are real temp trees with
spaces, unicode, symlinks, an unreadable directory and a `node_modules`; the AI tier is tested
against real executable shim scripts; the shell integration is tested by running `zsh -f` and
checking where it ended up.

## License

MIT

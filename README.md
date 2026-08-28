# cdai - cd with intent

A directory jumper that indexes folders you have **never visited**, understands
`latest`, `oldest` and year filters deterministically, and only asks an LLM when its own
matcher admits it is unsure.

The AI tier cannot invent a path. It picks from a list, or it declines. More on that below,
because it is the only genuinely interesting thing in here.

```console
$ cdai petal
→ ~/Dropbox/clients/petalworks

$ cdai latest petalworks folder
→ ~/Dropbox/clients/petalworks/petalworks-2026

$ cdai petalworks 2025
→ ~/Dropbox/clients/petalworks/petalworks-2025

$ cdai that client with the flowers
cdai: thinking... (claude sonnet)
cdai: ~/Dropbox/clients/petalworks (petalworks = flowers-themed client name) [Y/n]
→ ~/Dropbox/clients/petalworks
```

Every one of those is real output from `docs/demo-fixture.sh`, copied from a terminal, not
written by hand.

![cdai demo](docs/demo.gif)

## Why not just zoxide

I use [zoxide](https://github.com/ajeetdsouza/zoxide) and cdai steals its frecency formula on
purpose. But zoxide can only rank directories you have already `cd`'d into, and my problem is
the opposite one: freelance client folders I visit **once a year**. A pure frecency tool has
never seen them, so they do not exist. The first jump is always the manual one.

cdai keeps a crawled index of configured roots, so a folder you have never opened is a first
class candidate. Frecency then reorders what the index found.

|  | zoxide | cdai |
|---|---|---|
| frecency ranking | yes | yes, same aging formula |
| learns from your shell | yes | yes, chpwd hook, zero subprocesses |
| indexes directories you have never visited | no | yes, configurable roots and depth |
| `latest` / `oldest` / year / `in <root>` | no | yes, deterministic, no LLM |
| natural language fallback | no | optional, one config flag to kill it |
| runtime dependencies | Rust binary | Node, zero npm dependencies |
| cold jump on an unvisited folder | miss | hit |

## The part that matters: the AI cannot hallucinate a directory

An LLM that picks your working directory is a terrible idea if it can emit arbitrary strings.
So it cannot. Tier 2 gets a closed list - the top 30 fuzzy candidates plus your 20 most frecent
paths - and the reply contract is one JSON object naming a path **from that list**. The answer
is then re-checked: it must exist on disk *and* live under a configured root, or it is thrown
away.

That makes the failure mode boring on purpose. Two measured runs of the same query:

```console
# frecency db empty, no fuzzy candidates -> nothing to choose from
$ cdai that client with the flowers
cdai: thinking... (claude sonnet)
cdai: ai had no usable answer (no candidates provided to match)
cdai: no match for "that client with the flowers"

# same query, after petalworks is in the history
$ cdai that client with the flowers
cdai: thinking... (claude sonnet)
cdai: ~/Dropbox/clients/petalworks (petalworks = flowers-themed client name) [Y/n]
```

The model is a re-ranker over a set you could have printed yourself, not a path generator. It
is doing the one thing it is good at - "flowers" means "petalworks" - and is structurally
prevented from doing the thing it is bad at. A missing backend, a timeout, or a chatty model
degrades to fuzzy suggestions, never to a wrong `cd`.

Corollary, stated plainly: cdai does **not** do semantic search over your whole disk. If the
directory is neither a fuzzy candidate nor recently used, no amount of LLM will find it.

## Numbers

Measured on an Apple Silicon laptop (macOS 26, Node 25) against an index of about **2,500
directories**. Best of 10 runs, full process spawn to exit, `spawnSync` from a Node harness:

| | min | median |
|---|---|---|
| bare `node -e ""` (the floor) | 67ms | 73ms |
| `cdai <exact hit>` | 95ms | 105ms |
| `cdai latest <name>` | 95ms | 102ms |
| `cdai <no deterministic match>` (tier 2 fires) | 7.8s | 8.3s |

So tier 1 costs about **30ms of actual work**; the rest is Node booting. Tier 2 costs seconds,
which is exactly why the thresholds are tuned to avoid it. `test/latency.test.ts` fails the
build if an exact hit ever crosses 150ms.

Reproduce with `npm run build && npx vitest run test/latency.test.ts`.

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
own parent collapse into one answer, because they are the same place, not two options. Every
threshold in that diagram is a named constant in one 77 line file, `src/match/constants.ts`.

### Deterministic operators

| You type | You get |
|---|---|
| `cdai petal` | best match by fuzzy score and frecency |
| `cdai latest petalworks folder` | newest child directory of the match, by mtime |
| `cdai oldest petalworks` | oldest child directory |
| `cdai petalworks 2025` | year token is a required substring |
| `cdai squash in dev` | `in <root>` restricts the search to one root |
| `cdai ~/some/dir` | plain `cd`, no magic, no lookup |
| `cdai -` | plain `cd -`, back to the previous directory |
| `cdai` | plain `cd ~`, muscle memory stays intact |

## Install

```bash
npm i -g github:franzenzenhofer/cdai
cdai setup                       # detects your project roots, writes the config
echo 'eval "$(cdai init zsh)"' >> ~/.zshrc
exec zsh
```

bash: `eval "$(cdai init bash)"` in `~/.bashrc`. fish: `cdai init fish | source` in
`~/.config/fish/config.fish`. Coming from zoxide? `cdai import zoxide` seeds your frecency.

## Turning the AI off entirely

Set `ai.enabled` to `false` in `~/.config/cdai/config.json` and cdai is a fast fuzzy jumper with
frecency and operators, nothing else. Tier 1 makes no network call, ever, under any
configuration. The whole test suite except the tier 2 tests passes with no AI backend installed.

When it is on, what leaves your machine is: the words you typed, your cwd, and up to 50
directory **paths** (no file contents, ever). `ai.command` is just a command line, so any
prompt capable CLI works:

```json
{ "ai": { "enabled": true, "command": "claude", "model": "sonnet", "timeoutMs": 45000 } }
```

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

Data lives in `~/.local/share/cdai/`: `index.json`, `db.json` (frecency), `visits.log` (append
only, ingested and truncated on the next run, so the shell hook spawns no subprocess).

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
path and nothing else; every human readable byte goes to stderr.

## Limitations

- **No Windows.** zsh, bash and fish on macOS and Linux.
- **The index is a snapshot**, rebuilt on a miss or after 60 minutes. A folder created two
  minutes ago may need `cdai index --refresh`.
- **Crawl depth is bounded** by your config. Deep monorepos need a deeper root, and a deeper
  root means a bigger index.
- **Tier 2 is seconds, not milliseconds**, and needs a working CLI backend. It is off the hot
  path by design, not by accident.
- **No semantic search over unindexed directories.** See the section above.
- **~1800 lines of TypeScript.** This is a small tool that does one thing, not a platform.

## Development

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

107 tests, no mocking library, no fake filesystem. Fixtures are real temp trees containing
spaces, unicode, symlinks, an unreadable directory and a `node_modules`. The AI tier is tested
against real executable shim scripts. The shell integration is tested by running `zsh -f` and
checking which directory it actually ended up in. Zero runtime dependencies; the build is a
single 45KB `dist/cdai.js` from esbuild.

## Prior art

[zoxide](https://github.com/ajeetdsouza/zoxide) and [z](https://github.com/rupa/z) for frecency,
[fzf](https://github.com/junegunn/fzf) for the picker, [vhs](https://github.com/charmbracelet/vhs)
for the demo. cdai's only original claim is the combination: a crawled index so cold folders are
reachable, deterministic operators so common intent never needs a model, and an LLM confined to
re-ranking a closed candidate list.

## License

MIT

/**
 * Terminal recordings for the docs, in asciicast v2 format.
 *
 * Each recording runs the built `./ritual` binary (`bun run build`) in a real
 * shell inside a pseudo-terminal, typed at like a person would, against a
 * temporary copy of the committed `demo/` workspace (its card cache linked, not
 * copied). Nothing is written into `demo/` itself. The docs play the casts with
 * asciinema-player (`docs-site/src/components/Recording.astro`).
 *
 *   bun run scripts/docs-recordings.ts [--only <name>] [--gif]
 *
 * `--only` regenerates one recording. `--gif` also renders `<name>.gif` beside
 * each cast with `agg` (https://github.com/asciinema/agg), when it is on PATH.
 * The casts land in `docs-site/src/assets/recordings/`, with `recordings.json`
 * holding each one's title, length and poster frame.
 *
 * Output is kept free of anything machine-specific: the shell starts with no
 * user rc files, a fixed `HOME`, and a plain `$ ` prompt; the update check is
 * off; and every cast is checked for leaked temp-directory paths.
 */
import { Terminal } from 'bun'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(import.meta.dir, '..')
const DEMO_DIR = path.join(ROOT, 'demo')
const DEMO_CACHE = path.join(DEMO_DIR, 'cache')
const BINARY = path.join(ROOT, 'ritual')
const OUT_DIR = path.join(ROOT, 'docs-site/src/assets/recordings')
const INDEX_FILE = path.join(OUT_DIR, 'recordings.json')

const COLS = 100
/** Terminal height, unless a recording sets its own. */
const DEFAULT_ROWS = 28
/** The longest pause a cast keeps; longer idle stretches are cut to this. */
const IDLE_CAP_S = 1.5
/** Delay between typed characters, before jitter. */
const KEY_DELAY_MS = 55
/** Output chunks closer together than this are stored as one event. */
const COALESCE_S = 0.012
/**
 * The home directory the recordings show. Ritual prints absolute paths in a
 * few places; the temp directory's own path is replaced with this one.
 */
const SHOWN_HOME = '/home/you'
/** How long the output must be quiet before a step counts as settled. */
const SETTLE_MS = 250
const WAIT_TIMEOUT_MS = 30_000
/** `$ ` in magenta, which the docs player draws in the accent colour. */
const PROMPT = String.raw`\[\e[35m\]$\[\e[0m\] `

type Key = 'enter' | 'up' | 'down' | 'left' | 'right' | 'esc' | 'tab' | 'backspace' | 'space'

const KEY_CODES: Record<Key, string> = {
  enter: '\r',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  esc: '\x1b',
  tab: '\t',
  backspace: '\x7f',
  space: ' ',
}

type Step =
  /** Type a command at the shell prompt, press Enter, and wait for `until` (default: the next prompt). */
  | { kind: 'command'; text: string; until?: RegExp }
  /** Type text into the running program, without Enter. */
  | { kind: 'type'; text: string }
  /** Press a key, `times` times, then wait for `until` or for the output to settle. */
  | { kind: 'key'; key: Key; times?: number; until?: RegExp }
  | { kind: 'pause'; ms: number }
  /** The frame shown before the recording plays: the screen as it is here. */
  | { kind: 'poster' }

/** Where a recording starts: the demo workspace, or an empty folder with only the card cache. */
type Start = 'demo' | 'empty'

type Recording = {
  name: string
  title: string
  start: Start
  /** The workspace folder's name, inside the shown home directory. */
  folder: string
  /** Terminal height; the default leaves a short recording mostly empty. */
  rows?: number
  steps: readonly Step[]
}

const command = (text: string, until?: RegExp): Step => ({ kind: 'command', text, until })
const type = (text: string): Step => ({ kind: 'type', text })
type KeyOptions = { times?: number; until?: RegExp }

const key = (name: Key, options: KeyOptions = {}): Step => ({
  kind: 'key',
  key: name,
  ...options,
})
const pause = (ms: number): Step => ({ kind: 'pause', ms })
const poster: Step = { kind: 'poster' }

const RECORDINGS: readonly Recording[] = [
  {
    name: 'first-deck',
    title: 'Create a deck, add a card, and read the file',
    start: 'empty',
    folder: 'my-cards',
    rows: 18,
    steps: [
      command('ritual new deck "My Commander Deck"'),
      pause(600),
      command('ritual add-card "My Commander Deck" Sol Ring', /Select a card/),
      pause(900),
      key('enter', { until: /\$ $/ }),
      pause(600),
      command('cat "decks/My Commander Deck.md"'),
      poster,
      pause(2500),
    ],
  },
  {
    name: 'scry',
    title: 'Search Scryfall from the terminal',
    start: 'demo',
    folder: 'cards',
    rows: 22,
    steps: [
      command('ritual scry "type:goblin cmc=1 r:rare"'),
      pause(1500),
      command(
        'ritual scry "type:goblin cmc=1 r:rare" --fields name,set,prices.usd --output ndjson',
      ),
      poster,
      pause(2500),
    ],
  },
  {
    name: 'price',
    title: 'Browse the price of every list',
    start: 'demo',
    folder: 'cards',
    steps: [
      command('ritual price', /Search all cards/),
      pause(1500),
      key('down'),
      pause(600),
      key('enter', { until: /Type to filter/ }),
      pause(1500),
      type('chief'),
      pause(1200),
      key('down'),
      pause(600),
      key('enter', { until: /All printings/ }),
      poster,
      pause(3000),
      key('esc', { until: /Type to filter/ }),
      pause(1000),
      key('esc', { until: /Select a list/ }),
      pause(1000),
      key('esc', { until: /\$ $/ }),
      pause(1000),
    ],
  },
  {
    name: 'edit',
    title: 'Add a card to a deck with ritual edit',
    start: 'demo',
    folder: 'cards',
    steps: [
      command('ritual edit', /Select a list to edit/),
      pause(1500),
      type('elves'),
      pause(1000),
      key('enter', { until: /Enter card name/ }),
      pause(1000),
      type('Fyndhorn Elves'),
      // Enter right after typing races the suggestion filter.
      pause(1000),
      key('enter', { until: /Select Printing/ }),
      pause(1500),
      key('enter', { until: /Condition/ }),
      pause(1000),
      key('enter', { until: /which section/ }),
      pause(1000),
      key('enter', { until: /Added:/ }),
      pause(1500),
      key('up'),
      pause(1000),
      key('enter', { until: /Save and exit/ }),
      pause(1200),
      key('enter', { until: /\$ $/ }),
      pause(800),
      command('grep Fyndhorn "decks/Pauper Elves.md"'),
      poster,
      pause(2000),
    ],
  },
]

type Event = { time: number; data: string }

/** asciicast v2 header (https://docs.asciinema.org/manual/asciicast/v2/). */
type CastHeader = { version: 2; width: number; height: number; title: string }

/** One recording's entry in `recordings.json`, read by the docs component. */
type RecordingInfo = {
  title: string
  cols: number
  rows: number
  duration: number
  poster: number
}

/** A shell in a pseudo-terminal, with everything it prints timestamped. */
class Session implements AsyncDisposable {
  readonly events: Event[] = []
  posterAt = 0
  private output = ''
  /** Where the next wait starts looking in {@link output}. */
  private mark = 0
  private lastOutputAt = performance.now()
  private readonly startedAt = performance.now()
  private readonly decoder = new TextDecoder()
  private readonly terminal: Terminal
  private readonly shell: Bun.Subprocess

  constructor(cwd: string, env: Record<string, string>, rows: number) {
    this.terminal = new Terminal({
      cols: COLS,
      rows,
      name: 'xterm-256color',
      data: (_terminal, bytes) => {
        const data = this.decoder.decode(bytes, { stream: true })
        if (data === '') return
        const now = performance.now()
        this.events.push({ time: (now - this.startedAt) / 1000, data })
        this.output += data
        this.lastOutputAt = now
      },
    })
    // `setsid --ctty` makes the PTY the shell's controlling terminal, so job
    // control and terminal signals behave as in a real terminal window.
    // No rc files at all (the system bashrc can print hints); the prompt comes
    // from `PS1` in the environment.
    const shell = ['bash', '--noprofile', '--norc', '-i']
    this.shell = Bun.spawn(['setsid', '--ctty', '--wait', ...shell], {
      cwd,
      env,
      terminal: this.terminal,
    })
  }

  async run(steps: readonly Step[]): Promise<void> {
    await this.waitFor(/\$ $/)
    await sleep(500)
    for (const step of steps) await this.step(step)
  }

  private async step(step: Step): Promise<void> {
    switch (step.kind) {
      case 'command':
        await this.typeText(step.text)
        await sleep(350)
        this.mark = this.output.length
        this.terminal.write(KEY_CODES.enter)
        await this.waitFor(step.until ?? /\$ $/)
        return
      case 'type':
        await this.typeText(step.text)
        return
      case 'key':
        for (let i = 0; i < (step.times ?? 1); i++) {
          if (i > 0) await sleep(180)
          this.mark = this.output.length
          this.terminal.write(KEY_CODES[step.key])
        }
        if (step.until) await this.waitFor(step.until)
        else await this.settle()
        return
      case 'pause':
        await sleep(step.ms)
        return
      case 'poster':
        this.posterAt = (performance.now() - this.startedAt) / 1000
        return
    }
  }

  private async typeText(text: string): Promise<void> {
    for (const [index, char] of [...text].entries()) {
      this.terminal.write(char)
      // A fixed jitter pattern: uneven like a person, the same on every run.
      await sleep(KEY_DELAY_MS + ((index * 37) % 50))
    }
  }

  /** Wait until the output since the mark matches `pattern`, then until it settles. */
  private async waitFor(pattern: RegExp): Promise<void> {
    const deadline = performance.now() + WAIT_TIMEOUT_MS
    while (!pattern.test(Bun.stripANSI(this.output.slice(this.mark)))) {
      if (performance.now() > deadline) {
        const tail = Bun.stripANSI(this.output.slice(this.mark)).slice(-2000)
        throw new Error(`timed out waiting for ${pattern}; the screen ended with:\n${tail}`)
      }
      await sleep(20)
    }
    this.mark = this.output.length
    await this.settle()
  }

  private async settle(): Promise<void> {
    const deadline = performance.now() + WAIT_TIMEOUT_MS
    while (performance.now() - this.lastOutputAt < SETTLE_MS && performance.now() < deadline) {
      await sleep(25)
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.terminal.write('exit\r')
    const exited = await Promise.race([this.shell.exited.then(() => true), sleep(2000)])
    if (exited !== true) this.shell.kill('SIGKILL')
    this.terminal.close()
    await this.shell.exited
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Cast = { text: string; info: RecordingInfo }

/**
 * Join output that arrived within {@link COALESCE_S} of the previous chunk, so
 * a path split across two reads is still one string for {@link redact}.
 */
function coalesce(events: readonly Event[]): Event[] {
  const merged: Event[] = []
  for (const event of events) {
    const last = merged.at(-1)
    if (last && event.time - last.time < COALESCE_S) last.data += event.data
    else merged.push({ ...event })
  }
  return merged
}

/** Cap idle gaps, start at zero, and render the cast; the poster time moves with the cuts. */
function toCast(recording: Recording, events: readonly Event[], posterAt: number): Cast {
  const lines: string[] = []
  const rows = recording.rows ?? DEFAULT_ROWS
  const header: CastHeader = { version: 2, width: COLS, height: rows, title: recording.title }
  lines.push(JSON.stringify(header))
  let previous = events[0]?.time ?? 0
  let clock = 0
  let poster = 0
  for (const event of events) {
    const gap = Math.min(event.time - previous, IDLE_CAP_S)
    if (previous <= posterAt && event.time > posterAt) {
      poster = clock + Math.min(posterAt - previous, IDLE_CAP_S)
    }
    clock += gap
    previous = event.time
    lines.push(JSON.stringify([round(clock), 'o', event.data]))
  }
  if (posterAt >= previous) poster = clock + Math.min(posterAt - previous, IDLE_CAP_S)
  // Hold the last frame a moment before the player reports the end.
  clock += IDLE_CAP_S
  lines.push(JSON.stringify([round(clock), 'o', '']))
  return {
    text: `${lines.join('\n')}\n`,
    info: {
      title: recording.title,
      cols: COLS,
      rows,
      duration: round(clock),
      poster: round(poster),
    },
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

/**
 * The run's card cache: links to `demo/cache/`'s files, except `cache.json`,
 * which is copied with its refresh time set to now. Otherwise `price` and
 * `edit` open with an "update the prices?" prompt whenever the demo cache is
 * more than a day old, and the recordings would change with its age.
 */
function prepareCache(runRoot: string): string {
  const cacheDir = path.join(runRoot, 'cache')
  mkdirSync(cacheDir)
  for (const entry of readdirSync(DEMO_CACHE)) {
    if (entry === 'cache.json') continue
    symlinkSync(path.join(DEMO_CACHE, entry), path.join(cacheDir, entry))
  }
  const cache = readFileSync(path.join(DEMO_CACHE, 'cache.json'))
  // The metadata block, with the refresh times, is at the end of the file.
  // Cut at the first `"lastRefreshedAt"` in the last 4 KB: an ASCII byte, so
  // the cut never splits a multi-byte character.
  const tailStart = cache.indexOf('"lastRefreshedAt"', Math.max(0, cache.length - 4096))
  if (tailStart === -1) throw new Error('demo/cache/cache.json has no lastRefreshedAt metadata')
  const tail = cache.subarray(tailStart).toString('utf8')
  const freshTail = tail.replace(/("lastRefreshedAt":\s*)\d+/g, `$1${Date.now()}`)
  if (freshTail === tail) throw new Error('demo/cache/cache.json has no lastRefreshedAt metadata')
  writeFileSync(path.join(cacheDir, 'cache.json'), cache.subarray(0, tailStart))
  appendFileSync(path.join(cacheDir, 'cache.json'), freshTail)
  return cacheDir
}

/**
 * Copy `demo/` into `workspace`, linking the run's card cache where the demo's
 * config keeps it (`cacheDir: "cache"`, the workspace's own folder).
 */
function copyDemo(workspace: string, cacheDir: string): void {
  cpSync(DEMO_DIR, workspace, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(DEMO_DIR, source)
      return relative !== 'cache' && relative !== 'dist'
    },
  })
  symlinkSync(cacheDir, path.join(workspace, 'cache'), 'dir')
}

/**
 * An empty workspace whose user already has the card cache, so nothing offers a
 * download: the run's cache is linked in as the per-user cache every workspace
 * shares (`$XDG_CACHE_HOME/ritual`), exactly where a real user's lives.
 */
function emptyWorkspace(workspace: string, cacheDir: string, env: ShellEnvironment): void {
  mkdirSync(workspace, { recursive: true })
  const cacheHome = env.XDG_CACHE_HOME ?? path.join(env.HOME, '.cache')
  mkdirSync(cacheHome, { recursive: true })
  symlinkSync(cacheDir, path.join(cacheHome, 'ritual'), 'dir')
}

/** A clean, fixed environment: no user rc files, colour on, no update check. */
type ShellEnvironment = Record<string, string> & { HOME: string }

function shellEnvironment(root: string): ShellEnvironment {
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
  symlinkSync(BINARY, path.join(bin, 'ritual'))
  return {
    PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local/state'),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    RITUAL_NO_UPDATE_CHECK: '1',
    PS1: PROMPT,
    INPUTRC: writeInputrc(root),
  }
}

/** Readline settings: no bracketed-paste escapes around every prompt. */
function writeInputrc(root: string): string {
  const file = path.join(root, 'inputrc')
  writeFileSync(file, 'set enable-bracketed-paste off\n')
  return file
}

/** Throw when a cast mentions the temp root, the repository, or the home directory. */
function checkForLeaks(name: string, text: string, forbidden: readonly string[]): void {
  for (const needle of forbidden) {
    const at = needle === '' ? -1 : text.indexOf(needle)
    if (at !== -1) {
      const context = text.slice(Math.max(0, at - 200), at + needle.length + 100)
      throw new Error(`${name}: the recording contains "${needle}", in:\n${context}`)
    }
  }
}

function renderGif(cast: string): void {
  const gif = cast.replace(/\.cast$/, '.gif')
  const result = Bun.spawnSync(['agg', cast, gif], { stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode !== 0) throw new Error(`agg exited with ${result.exitCode}`)
  console.log(path.relative(ROOT, gif))
}

async function readIndex(): Promise<Record<string, RecordingInfo>> {
  const file = Bun.file(INDEX_FILE)
  if (!(await file.exists())) return {}
  const parsed: unknown = await file.json()
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path.relative(ROOT, INDEX_FILE)} is not an object of recordings`)
  }
  return parsed as Record<string, RecordingInfo>
}

/** Written after every cast, so a failed run never leaves a cast and its entry out of step. */
async function writeIndex(index: Record<string, RecordingInfo>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => (a < b ? -1 : 1)))
  await Bun.write(INDEX_FILE, `${JSON.stringify(sorted, null, 2)}\n`)
}

async function record(recording: Recording, root: string, cacheDir: string): Promise<Cast> {
  const env = shellEnvironment(root)
  const workspace = path.join(env.HOME, recording.folder)
  if (recording.start === 'demo') copyDemo(workspace, cacheDir)
  else emptyWorkspace(workspace, cacheDir, env)
  await using session = new Session(workspace, env, recording.rows ?? DEFAULT_ROWS)
  await session.run(recording.steps)
  const events = coalesce(session.events).map((event) => ({
    ...event,
    data: event.data.replaceAll(env.HOME, SHOWN_HOME),
  }))
  // The user name as a path segment: alone, a short one could match card text.
  const user = `/${os.userInfo().username}/`
  const forbidden = [root, os.tmpdir(), ROOT, os.homedir(), user, os.hostname()]
  checkForLeaks(recording.name, events.map((event) => event.data).join(''), forbidden)
  return toCast(recording, events, session.posterAt)
}

const { values } = parseArgs({
  options: { only: { type: 'string' }, gif: { type: 'boolean', default: false } },
  strict: true,
})

if (!existsSync(BINARY)) throw new Error('No ./ritual binary: run `bun run build` first.')
if (!existsSync(DEMO_CACHE) || readdirSync(DEMO_CACHE).length === 0) {
  throw new Error(
    `No card cache in ${path.relative(ROOT, DEMO_CACHE)}/. Build it with ` +
      '`./ritual --base-dir demo cache preload-all`, or in a worktree, link it to the main ' +
      "checkout's demo/cache.",
  )
}
const selected =
  values.only === undefined ? RECORDINGS : RECORDINGS.filter((r) => r.name === values.only)
if (selected.length === 0) {
  throw new Error(
    `No recording named "${values.only}". Known: ${RECORDINGS.map((r) => r.name).join(', ')}`,
  )
}
const hasAgg = values.gif && Bun.which('agg') !== null
if (values.gif && !hasAgg) {
  console.warn(
    'agg is not on PATH, so no GIFs. Install it with ' +
      '`cargo install --locked --git https://github.com/asciinema/agg`, or download a binary ' +
      'from https://github.com/asciinema/agg/releases (the crates.io `agg` is a different tool).',
  )
}

mkdirSync(OUT_DIR, { recursive: true })
const index = await readIndex()
const runRoot = mkdtempSync(path.join(os.tmpdir(), 'ritual-recordings-'))
try {
  const cacheDir = prepareCache(runRoot)
  for (const recording of selected) {
    const root = path.join(runRoot, recording.name)
    mkdirSync(root)
    const cast = await record(recording, root, cacheDir)
    const file = path.join(OUT_DIR, `${recording.name}.cast`)
    await Bun.write(file, cast.text)
    index[recording.name] = cast.info
    await writeIndex(index)
    const size = Math.round(cast.text.length / 1024)
    console.log(`${path.relative(ROOT, file)} (${cast.info.duration}s, ${size} KB)`)
    if (hasAgg) renderGif(file)
  }
} finally {
  rmSync(runRoot, { recursive: true, force: true })
}

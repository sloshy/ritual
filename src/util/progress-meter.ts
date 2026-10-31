/**
 * One progress line, drawn the way the stream it writes to can show it.
 *
 * On a terminal the line redraws itself in place (`\r`), as often as the caller
 * reports. Anywhere else — a CI log, a pipe, the admin server reading a child's
 * output — every `\r` frame would pile up as one long run of concatenated
 * fragments, so a plain meter prints whole lines instead, and only a few: the
 * first report, each {@link PLAIN_STEP_PERCENT}% milestone crossed, and the
 * last. A run with nothing to count prints nothing at all.
 */

/** How far apart (in percent) a plain meter's milestone lines are. */
export const PLAIN_STEP_PERCENT = 25

/** One progress report: how far along, and the line that says so. */
export type ProgressFrame = {
  /** 0–100, or undefined when the total is unknown (a chunked download). */
  percent: number | undefined
  /** The rendered line, without any `\r` or newline. */
  line: string
}

export type ProgressMeterOptions = {
  /** Whether the stream is a terminal that can redraw a line in place. */
  interactive: boolean
  /** Where the meter's text goes. */
  write: (text: string) => void
}

export type ProgressMeter = {
  /** Report a frame. */
  update(frame: ProgressFrame): void
  /** End the meter: close the redrawn line, or print the last frame if it was skipped. */
  end(): void
}

export function createProgressMeter(options: ProgressMeterOptions): ProgressMeter {
  const { interactive, write } = options
  /** The last frame reported, and whether a plain meter has printed it. */
  let last: ProgressFrame | undefined
  let lastPrinted = false
  /** The next milestone a plain meter prints at; -1 before the first line. */
  let nextMilestone = -1

  return {
    update(frame: ProgressFrame): void {
      last = frame
      if (interactive) {
        write(`\r${frame.line}`)
        return
      }
      const percent = frame.percent
      const due = nextMilestone < 0 || (percent !== undefined && percent >= nextMilestone)
      lastPrinted = due
      if (!due) return
      write(`${frame.line}\n`)
      nextMilestone =
        percent === undefined
          ? Number.POSITIVE_INFINITY
          : (Math.floor(percent / PLAIN_STEP_PERCENT) + 1) * PLAIN_STEP_PERCENT
    },
    end(): void {
      if (last === undefined) return
      if (interactive) {
        write('\n')
        return
      }
      if (!lastPrinted) write(`${last.line}\n`)
    },
  }
}

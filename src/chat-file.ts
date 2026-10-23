import { CliError } from "@wirecat/cli-base"
import type { SourceChatLine } from "@wirecat/cli-core/meetings"

const TABBED = /^(\d{1,2}):(\d{2}):(\d{2})\t(.*?):\t(.*)$/
// Zoom has written spaces where the tabs belong (devforum.zoom.us/t/chat-file-download-format/82490).
const SPACED = /^(\d{1,2}):(\d{2}):(\d{2}) +(.*?): +(.*)$/
const LOCAL = /^From (.+?) to .+$/

/**
 * A cloud recording's chat file: `<time from the recording start>\t<name>:\t<message>`, one message a line; a line
 * without a time continues the message before it.
 */
export const parseZoomChat = (content: string, recordingStart: number): SourceChatLine[] => {
  const lines: SourceChatLine[] = []
  for (const raw of content.replace(/^﻿/, "").split(/\r?\n/)) {
    const match = TABBED.exec(raw) ?? SPACED.exec(raw)
    if (match) {
      const [, hours, minutes, seconds, name = "", text = ""] = match
      const offset = (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
      const sender = (LOCAL.exec(name)?.[1] ?? name).trim()
      lines.push({ sentAt: new Date(recordingStart + offset).toISOString(), sender: sender || null, text })
    } else if (raw.trim()) {
      const last = lines.at(-1)
      if (!last) throw new CliError("invalid_response", "Zoom returned an invalid chat file")
      last.text = `${last.text}\n${raw}`
    }
  }
  return lines
}

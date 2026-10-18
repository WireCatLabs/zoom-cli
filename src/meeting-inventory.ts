import { CliError } from "@wirecat/cli-base"
import { addMeetingSeriesInventoryCommand, type MeetingSeriesInventoryReader } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { profileAccountKey, type ZoomConfig } from "./config.js"
import type { RemoteOptions } from "./remote-http.js"
import { createZoomSeriesInventoryReader } from "./series-inventory.js"
import type { ZoomUpcomingCredentials } from "./upcoming-meetings.js"

export interface ZoomInventoryBinding {
  account: string
  credentials: ZoomUpcomingCredentials
  fetch: typeof fetch
  remoteOptions?: RemoteOptions
}

/** Capture public scope once; credentials and provider reads stay lazy. */
export const createZoomInventoryReader = (capture: () => ZoomInventoryBinding) => {
  let reader: ReturnType<typeof createZoomSeriesInventoryReader> | undefined
  const captured = () => {
    if (!reader) {
      const binding = capture()
      reader = createZoomSeriesInventoryReader(
        binding.account,
        binding.credentials,
        binding.fetch,
        binding.remoteOptions,
      )
    }
    return reader
  }
  const read: MeetingSeriesInventoryReader = async (request) => {
    request.signal?.throwIfAborted()
    return captured().page(request)
  }
  return {
    read,
    capture: () => {
      captured()
    },
  }
}

export const addZoomInventoryCommand = (
  program: Command,
  deps: Omit<Parameters<typeof addMeetingSeriesInventoryCommand>[1], "read"> & {
    config: () => ZoomConfig
    credentials: () => ZoomUpcomingCredentials
    fetch: typeof fetch
    remoteOptions?: RemoteOptions
  },
) => {
  const inventory = createZoomInventoryReader(() => {
    const profile = deps.config().accountProfile
    if (!profile) throw new CliError("configuration_error", "select a local profile before reading meeting inventory")
    return {
      account: profileAccountKey(profile),
      credentials: { withSignal: (signal) => deps.credentials().withSignal(signal) },
      fetch: deps.fetch,
      remoteOptions: deps.remoteOptions,
    }
  })
  addMeetingSeriesInventoryCommand(program, { ...deps, read: inventory.read })
  return inventory
}

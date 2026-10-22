import { addMeetingSeriesInventoryCommand, type MeetingSeriesInventoryReader } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { profileAccountKey } from "./config.js"
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
    profile: () => string
    credentials: () => ZoomUpcomingCredentials
    fetch: typeof fetch
    remoteOptions?: RemoteOptions
  },
) => {
  const inventory = createZoomInventoryReader(() => {
    return {
      account: profileAccountKey(deps.profile()),
      credentials: { withSignal: (signal) => deps.credentials().withSignal(signal) },
      fetch: deps.fetch,
      remoteOptions: deps.remoteOptions,
    }
  })
  addMeetingSeriesInventoryCommand(program, { ...deps, read: inventory.read })
  return inventory
}

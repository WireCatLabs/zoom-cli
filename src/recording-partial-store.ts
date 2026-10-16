import type { RecordingAssetLocator, RecordingTransferWriter } from "@wirecat/cli-core/meetings"
import { NativeRecordingPartialStore } from "@wirecat/cli-core/persistence/native"
import { checkCancelled } from "./errors.js"

const operation = async <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  checkCancelled(signal)
  try {
    return await run()
  } catch (error) {
    checkCancelled(signal)
    throw error
  }
}

export class RecordingPartialStore extends NativeRecordingPartialStore {
  constructor(
    root: string,
    locator: RecordingAssetLocator,
    private readonly cancellation?: AbortSignal,
    persistent = true,
    maxBytes = 20 * 1024 ** 3,
  ) {
    super(root, locator, { prefix: ".zoom-partial-", persistent, maxBytes, signal: cancellation })
  }

  override load(locator: RecordingAssetLocator) {
    return operation(() => super.load(locator), this.cancellation)
  }

  override async open(
    locator: RecordingAssetLocator,
    options: Parameters<NativeRecordingPartialStore["open"]>[1],
  ): Promise<RecordingTransferWriter> {
    const writer = await operation(() => super.open(locator, options), this.cancellation)
    return {
      write: (bytes) => operation(() => writer.write(bytes), this.cancellation),
      checkpoint: () => operation(() => writer.checkpoint(), this.cancellation),
      finish: () => operation(() => writer.finish(), this.cancellation),
      close: () => writer.close(),
    }
  }
}

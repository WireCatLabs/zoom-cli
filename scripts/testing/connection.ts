import type { MessageStore } from "@wirecat/cli-core/store"
import type { StoreConnection } from "../../src/store-connection.js"

/** Tests fake only the parts of a connection or store a command reaches. */
export const fakeConnection = (parts: Partial<StoreConnection>): StoreConnection => parts as StoreConnection
export const fakeStore = (parts: object): MessageStore => parts as MessageStore

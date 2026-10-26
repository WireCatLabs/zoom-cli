// GENERATED. DO NOT EDIT.
// Source: spec/zoom/chat.json
// Run: pnpm zoom:generate

import { integer } from "@wirecat/cli-base/codegen/runtime"
import * as v from "valibot"
import type * as T from "./types.js"

export const GetUserContactsResponse: v.GenericSchema<unknown, T.GetUserContactsResponse> = v.looseObject({
  contacts: v.optional(
    v.array(
      v.looseObject({
        email: v.optional(v.string()),
        first_name: v.optional(v.string()),
        id: v.optional(v.string()),
        member_id: v.optional(v.string()),
        last_name: v.optional(v.string()),
      }),
    ),
  ),
  next_page_token: v.optional(v.string()),
  page_size: v.optional(integer({ maximum: 1000 })),
})

export const GetUserContactResponse: v.GenericSchema<unknown, T.GetUserContactResponse> = v.looseObject({
  direct_numbers: v.optional(v.array(v.string())),
  email: v.optional(v.string()),
  extension_number: v.optional(v.string()),
  first_name: v.optional(v.string()),
  id: v.optional(v.string()),
  member_id: v.optional(v.string()),
  last_name: v.optional(v.string()),
  phone_number: v.optional(v.string()),
  phone_numbers: v.optional(
    v.array(
      v.looseObject({
        code: v.optional(v.string()),
        country: v.optional(v.string()),
        label: v.optional(v.picklist(["Mobile", "Office", "Home", "Fax"])),
        number: v.optional(v.string()),
        verified: v.optional(v.boolean()),
      }),
    ),
  ),
  presence_status: v.optional(
    v.picklist([
      "Do_Not_Disturb",
      "Away",
      "Available",
      "Offline",
      "In_A_Meeting",
      "In_A_Call",
      "In_A_Calendar_Event",
      "Presenting",
      "Out_of_Office",
      "Busy",
    ]),
  ),
})

export const schemas = {
  GetUserContactsResponse,
  GetUserContactResponse,
} as const

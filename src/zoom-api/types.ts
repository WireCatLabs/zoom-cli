// GENERATED. DO NOT EDIT.
// Source: spec/zoom/chat.json
// Run: pnpm zoom:generate

export type GetUserContactsResponse = {
  /** The contacts object. */
  contacts?: Array<{
    /** Contact's email address. */
    email?: string
    /** Contact's first name. */
    first_name?: string
    /** The contact's user ID. If the user ID does not belong to the same account as the current user, this field will be empty. */
    id?: string
    /** The contact's member ID. */
    member_id?: string
    /** Contact's last name. */
    last_name?: string
  }>
  /** The next page token is used to paginate through large result sets. A next page token will be returned whenever the set of available results exceeds the current page size. The expiration period for this token is 15 minutes. */
  next_page_token?: string
  /** The number of records returned with a single API call. */
  page_size?: number
}

export type GetUserContactResponse = {
  /** A list of direct numbers assigned to the contact. */
  direct_numbers?: Array<string>
  /** The contact's email address. */
  email?: string
  /** The extension number of the contact. */
  extension_number?: string
  /** The contact's first name */
  first_name?: string
  /** The contact's user ID. If the user ID does not belong to the same account as the current user, this field will be empty. */
  id?: string
  /** The contact's member ID. */
  member_id?: string
  /** The contact's last name. */
  last_name?: string
  /** The phone number of the contact. */
  phone_number?: string
  phone_numbers?: Array<{
    /** The phone number's country code. For example, the country code for phone numbers in the United States is `+1`. */
    code?: string
    /** The phone number's [country ID](https://marketplace.zoom.us/docs/api-reference/other-references/abbreviation-lists#countries). For example, if the phone number provided in the `number` field is a Brazil-based number, the value is `BR`. */
    country?: string
    /** The phone number's label: * `Mobile` * `Office` * `Home` * `Fax` */
    label?: "Mobile" | "Office" | "Home" | "Fax"
    /** The user's phone number. */
    number?: string
    /** Whether Zoom has verified the phone number. */
    verified?: boolean
  }>
  /** The contact's presence status in the Zoom Chat client. The status can be one of the following: `Do_Not_Disturb` `Away` `Available` `Offline` `In_A_Meeting` `In_A_Call` `In_A_Calendar_Event` `Presenting` `Out_of_Office` `Busy` */
  presence_status?:
    | "Do_Not_Disturb"
    | "Away"
    | "Available"
    | "Offline"
    | "In_A_Meeting"
    | "In_A_Call"
    | "In_A_Calendar_Event"
    | "Presenting"
    | "Out_of_Office"
    | "Busy"
}

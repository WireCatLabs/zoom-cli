import { ZoomError } from "./errors.js"

export const zoomMeetingPath = (id: string): string => {
  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id) || id.trim() !== id)
    throw new ZoomError("validation_error", "remote meeting id must be a positive numeric id")
  return `/meetings/${id}`
}

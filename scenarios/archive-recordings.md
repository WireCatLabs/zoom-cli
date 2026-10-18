---
title: Keep a daily, checked archive of cloud recordings
goal: Download Zoom cloud recordings to a folder every day and confirm every file arrived whole.
steps:
  - run: zm recordings list --since-time 2026-10-01
    why: the cloud recordings Zoom holds for that range, before you download anything
  - run: zm recordings schedule create --name daily --output-dir /srv/zoom-archive --at 03:00 --timezone Europe/Madrid --since-time 2026-10-01
    why: previews a daily job and its timer; run it again with --yes to install it
  - run: zm recordings schedule run daily
    why: one run now, so you see the job work before the timer does
  - run: zm recordings archive check /srv/zoom-archive
    why: checks the size and checksum of every archived file, without Zoom or the store
look:
  - files whose checksum or size does not match; download them again
  - the job's last result in schedule show, and whether the timer is enabled
  - zm recordings archive import adds the archived transcripts to the store
---

The archive keeps checksums and sizes, never signed URLs or tokens.

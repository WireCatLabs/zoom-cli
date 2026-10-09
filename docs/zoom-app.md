# Your own Zoom app

`zm` reads your meetings through Zoom's official API, as you. Zoom lets a program do that only
through an app registered in the Zoom App Marketplace, so — like `tg` with its Telegram app — `zm`
uses **your own Zoom app**. You create it once.

The app is read-only: it can list your past meetings and read their transcripts and AI summaries.
It cannot join, schedule, record or change anything. It has no secret: `zm` logs in through your
browser and gets a token for your account only.

## Create it from the manifest

1. Sign in at [marketplace.zoom.us](https://marketplace.zoom.us/).
2. Open **Build App** from the link at the bottom of the left sidebar
   ([marketplace.zoom.us/user/build](https://marketplace.zoom.us/user/build)) and press **+**.
3. Choose **General app**, then build it **from an app manifest**, and upload
   [`zoom-app.json`](zoom-app.json) from this folder.
4. If Zoom asks how the app is managed, choose **User-managed**.
5. Check that the import took. On the **Development** tab, **Basic Information** must show
   `https://wirecat.dev/zoom-callback` in **OAuth Redirect URL** and in **OAuth Allow Lists**, and
   **Scopes** must list the four scopes below. If a field is empty, fill it in by hand and press
   **Continue**: the import can create the app and leave them blank, and Zoom then refuses the login
   with "Invalid redirect".
6. In **Basic Information → App Credentials**, turn on **Use Public Client OAuth**. The manifest
   asks for it, but the import may leave it off, and then Zoom refuses `zm login` with
   "Invalid redirect".
7. Copy the **Public Client ID**. You do not need the
   client secret.

Then give the client ID to `zm`:

```sh
zm config set zoom.clientId <client id>
zm login
```

`zm login` opens your browser on Zoom's consent page. After you allow it, Zoom sends your browser to
[wirecat.dev/zoom-callback](https://wirecat.dev/zoom-callback), a static page that passes the answer
straight on to `zm` on your machine. Zoom no longer accepts a `127.0.0.1` address there. The answer
is useless on its own: it works only with a key that `zm` keeps on your machine (PKCE). If the browser
does not pass it on, the page shows it for you to paste into `zm`. `zm` keeps the token in your
system keyring.

## What the manifest asks for

| Scope | Why |
|---|---|
| `meeting:read:list_meetings` | find your past meetings |
| `meeting:read:list_past_instances` | tell apart the occurrences of a recurring meeting |
| `cloud_recording:read:meeting_transcript` | read a meeting's transcript — also for meetings that were not recorded |
| `meeting:read:summary` | read Zoom's AI summary; optional, and it needs a Pro plan or higher |

Before you upload it, you can change `developer_information` in the file to your own name and email.

## Before your first `zm pull`

- In Zoom's web settings, turn on **Allow hosts to retain transcripts**. Without it, Zoom keeps no
  transcript for the API to return.
- Zoom returns transcripts only for meetings **you hosted**. Meetings you only attended stay in your
  Zoom portal; `zm import <folder>` reads transcript files you downloaded from there.

## If your company manages your Zoom account

An account admin may have to approve the app before you can use it. If that is not possible, `zm`
cannot use the API for you yet; `zm import` still works with downloaded transcript files.

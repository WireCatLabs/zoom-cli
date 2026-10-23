# Connect a Zoom app

A Zoom app tells Zoom which permissions a program can request. Connect an existing app to `zm`,
or create a user-managed app for your own account. By the end you will have the Public Client ID,
redirect settings and scopes needed for browser login. This registration does not install a bot
inside meetings or make recordings for you. You do not download a credentials file or create a
separate OAuth client outside the app: enable Public Client OAuth inside it and copy the displayed ID.

Choose how to connect:

- [Use an app you already created](#use-an-app-you-already-created)
- [Create your own app](#create-your-own-app)

## Use an app you already created

1. Sign in to [Zoom App Marketplace](https://marketplace.zoom.us/) and open **Developer → Created apps**.
   Select your existing app; do not create a duplicate.
2. Select the environment you use: **Development** for your development app, or **Production** for
   an app distributed to users. The credentials and OAuth settings belong to that environment.
3. Under **Basic Information → App Credentials**, enable **Use Public Client OAuth** and copy the
   **Public Client ID**. Zoom may also show a regular Client ID and a Client Secret; `zm` uses neither.
4. Check the redirect, allow list and [required scopes](#what-the-manifest-asks-for) below.
5. Configure that ID and start a new login:

```sh
zm config set zoom.client_id <public-client-id>
zm config set source api
zm personal session start
```

Replace the placeholder without angle brackets. Sign in as the Zoom user whose meetings you want,
review the consent and approve. Wait for `logged_in: true` in the terminal. If browser approval leaves
it waiting, follow [finish the browser callback](sessions.md#finish-the-browser-callback).

### Use a WireCat or team app

If the app owner has made an existing WireCat or team app available to your Zoom user, use the
**Public Client ID supplied by that owner** with the same commands above. You do not need to create
another app or obtain its secret. The owner maintains redirect settings and requested permissions;
you authorize your own account.

An app in development is not automatically available to users in another Zoom account. Check access
with its owner; a company administrator may also need to approve it. A Marketplace authorization
link by itself does not configure `zm` or complete its login: start `zm personal session start` so its current callback
and verification key exist. If you cannot authorize the shared app, create your own with the steps below.

## Create your own app

1. Sign in to [Zoom App Marketplace](https://marketplace.zoom.us/). Open **Developer**, then on
   **Created apps** choose **Develop → Build an app**. Select **General app** and **Create**.
   If Developer is missing, ask the account administrator for the Zoom developer role.
2. Name it, for example **My meeting archive**, and choose **User-managed**. This lets each signed-in
   user authorize their own data. Server-to-Server OAuth is a different app type and does not match
   this tool's browser login.
3. Work in **Development** for your own initial setup. In **Basic Information → App Credentials**,
   turn on **Use Public Client OAuth** and copy the **Public Client ID**.
4. In **OAuth Information**, set both fields below and save/continue:

| Field | Value |
|---|---|
| OAuth Redirect URL | `https://wirecat.dev/zoom-callback` |
| OAuth Allow Lists | `https://wirecat.dev/zoom-callback` |

Use that exact URL, without an extra trailing slash. `zm` currently sends this registered redirect;
a different callback URL requires a code change, not a config setting. Zoom also supports loopback
redirects for eligible public clients, but that is not the redirect this tool sends.

5. Open **Scopes → Add Scopes**, search each name in the table below, select the user-managed
   scopes and save. Explain their use if Zoom asks for a scope description. Add recording or write
   permissions only if you need those tasks.
6. Check **Local Test** for app installation/access and any account approval requirement. Zoom's
   **Add App Now** can authorize a development app, but return to the terminal and run `zm personal session start`
   to establish this tool's session. Other-account distribution has a separate Zoom review process.
7. Return to [installation's first run](installation.md#first-run) with the Public Client ID.

The official [app creation guide](https://developers.zoom.us/docs/integrations/create/),
[OAuth settings](https://developers.zoom.us/docs/build-flow/basic-info/oauth-info/) and
[Public Client OAuth instructions](https://developers.zoom.us/docs/integrations/oauth/#get-your-public-client-id)
explain the Marketplace fields.

## Create it from the manifest

The optional [starter manifest](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/zoom-app.json)
is an app-creation template, not a credentials file. It contains callback URLs and disabled
in-client features. If Marketplace offers creation from
an app manifest, save that JSON file and import it when creating the General app.

**The manifest does not include scopes or enable Public Client OAuth.** Complete steps 3–6 above
manually after import. Do not assume that a successful import made the app ready for `zm personal session start`.
Manual creation is the complete path when the import option is unavailable.

<a id="what-the-manifest-asks-for" />

## Permissions for hosted meetings

These are the permissions to add manually for hosted-meeting ingestion. A scope is one named
permission; a granted scope authorizes an API call, not the existence of the requested data.

| Scope | Use |
|---|---|
| `meeting:read:list_meetings` | Find hosted meeting records and list candidate scheduled series |
| `meeting:read:list_past_instances` | Find the instance that ran for every listed meeting, recurring or not |
| `cloud_recording:read:meeting_transcript` | Retrieve an available meeting transcript |
| `meeting:read:list_past_participants` | Read participant records and their join/leave sessions |
| `meeting:read:summary` | Retrieve an available Zoom AI summary |

Configure all five for `zm personal meetings sync`: it reads these parts during ingestion, even though transcript
or summary content may be absent. Zoom's plan, host settings and retention determine which parts
exist. For a schedule-only workflow, `meetings scheduled` needs just its list scope. Verifying a selected
series with preparation also needs `meeting:read:meeting`, listed below.

## Add archive or management access

The app owner adds the required scope in **Scopes**, saves it, then the user runs `zm personal session start` again.
Already issued tokens do not acquire new permissions automatically. Check actual granted scopes
with `zm personal session status --json`.

| Scope | Feature |
|---|---|
| `cloud_recording:read:list_user_recordings` | Discover your cloud recording occurrences |
| `cloud_recording:read:list_recording_files` | Inspect and download available recording assets; store the meeting chat at sync |
| `user:read:user` | Verify the remote session with `zm personal session status --check` |
| `meeting:read:meeting` | Show remote details and prepare a selected upcoming series with stored context |
| `meeting:read:invitation` | Retrieve its invitation text |
| `meeting:write:meeting` | Create a remote meeting |
| `meeting:update:meeting` | Update a remote meeting |
| `meeting:delete:meeting` | Cancel a remote meeting |

Archiving does not require meeting write permissions. Changes preview by default; `--yes` applies
one request. See [recording archives](archive.md#archive-cloud-recordings) or
[meeting management](remote-meetings.md) after granting the corresponding permissions.

<a id="before-your-first-zm-pull" />

## Before your first `zm meetings sync`

A transcript must have been generated and retained in Zoom. In your Zoom web settings, find
**Meeting → In Meeting (Advanced) → Meeting transcript** and enable the relevant generation and
retention controls. Administrators can lock these controls. Existing accounts can also show
**Allow hosts to retain transcripts** for meeting-summary transcripts. See Zoom's
[transcript settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0085675)
for the current plan and permission requirements.

For cloud recording audio transcripts, check the separate cloud recording transcription settings.
A recording, live captions and a retained meeting transcript are different outputs. Enabling a
setting today does not recreate transcripts that were never saved or have expired.

The API path uses the authenticated host's meetings. For a meeting you only attended, ask the host
for a transcript or download one if Zoom permits it, then [import the VTT file](archive.md#downloaded-transcripts).
Attendance alone does not guarantee download access.

## If your company manages your Zoom account

Ask the administrator to allow app creation or installation and the specific permissions needed.
If API authorization is unavailable, authorized transcript files can still be imported without an
app. Once login succeeds, [pull your first period](installation.md#first-run) and check which meetings
and transcripts actually arrived.

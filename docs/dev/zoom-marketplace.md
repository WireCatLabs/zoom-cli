# Publish the WireCat CLI Zoom app

Today every zm user creates their own Zoom app ([Connect a Zoom app](../zoom-app.md)). One public app, **WireCat
CLI**, removes that step: a user installs zm, runs `zm personal session start` and approves. This page lists
everything the app owner does in the Zoom App Marketplace to get there, in order. zm signs in with a one-time key
per login (OAuth with PKCE), so the app has no secret to protect and zm can ship its Public Client ID.

Zoom changes its screens; where a label below differs, look for the nearest match. Sources are at the end.

## Before you start

- [ ] The privacy policy and terms on wirecat.dev describe zm and the Zoom data it reads, contacts included
      (`https://wirecat.dev/en/privacy`, `https://wirecat.dev/en/terms`). Zoom's reviewers read the live pages.
- [ ] The logo: 160×160 pixels, PNG, a light version and optionally a dark one.
- [ ] An email address you read, for Zoom's developer contact field.
- [ ] Your Zoom user has the developer role (Marketplace shows **Develop**). If not, ask the account administrator.

## 1. Test on the Development side first

Zoom's reviewers try every permission the app asks for, so each must work before you submit.

1. Open [Zoom App Marketplace](https://marketplace.zoom.us/) → **Develop** → **Manage** (or **Created apps**) →
   your app. Stay on the **Development** tab.
2. **Scopes** → **Add Scopes**: add every scope in [the table in step 4](#4-scopes), then save.
3. Log in again, because a token only gets new scopes at login: `zm personal session start`.
4. Check each area once:

   ```sh
   zm personal session status --check --json
   zm personal meetings sync --since-time 2026-10-01
   zm personal recordings list --json
   zm personal remote-meetings list --json
   zm personal contacts list --json
   ```

## 2. Open the Production side

In the same app, switch the top tab from **Development** to **Production**. Do every step below on that tab. The
Production side has its own Client ID, scopes and settings; nothing is copied from Development.

## 3. Credentials and login address

1. **Basic Information** → **App Credentials**: turn on **Use Public Client OAuth**.
2. Copy the **Production Public Client ID**. It is not a secret; it goes into zm once Zoom approves the app.
3. **OAuth Redirect URL** and **OAuth Allow List**: `https://wirecat.dev/zoom-callback`, exactly, with no trailing
   slash. zm sends this address; a different one needs a code change.

## 4. Scopes

Add these on the Production side. When Zoom asks why the app needs a scope, paste its description. Ask for nothing
else: reviewers reject scopes an app does not use.

| Scope | Description for the reviewer |
|---|---|
| `meeting:read:list_meetings` | Lists the user's hosted meetings so zm can find which ones to archive. |
| `meeting:read:list_past_instances` | Finds the past occurrence of each meeting, including recurring ones. |
| `meeting:read:list_past_participants` | Reads who attended and when they joined and left, to attribute speakers. |
| `cloud_recording:read:meeting_transcript` | Downloads the meeting transcript into the user's local archive. |
| `meeting:read:summary` | Downloads the Zoom AI summary into the user's local archive. |
| `cloud_recording:read:list_user_recordings` | Finds the user's cloud recordings. |
| `cloud_recording:read:list_recording_files` | Reads recording file details and meeting chat for the local archive. |
| `user:read:user` | Confirms which Zoom user is signed in. |
| `meeting:read:meeting` | Shows details of an upcoming meeting so the user can prepare for it. |
| `meeting:read:invitation` | Shows a meeting's invitation text with `zm remote-meetings invitation`. |
| `meeting:write:meeting` | Creates a meeting when the user runs `zm remote-meetings create`. |
| `meeting:update:meeting` | Changes a meeting when the user runs `zm remote-meetings update`. |
| `meeting:delete:meeting` | Cancels a meeting when the user runs `zm remote-meetings cancel`. |
| `team_chat:read:list_contacts` | Lists the user's company and external contacts with `zm contacts list`. |
| `team_chat:read:contact` | Shows one contact and their phone numbers with `zm contacts show`. |
| `agentic_search:read:search` | Searches the user's Zoom chat, docs and meetings live with `zm zoom search`; results are shown, not stored. |

Remove every other scope with the bin icon next to it, on both tabs. Scopes zm does not call, which Zoom's
templates or earlier tests often add:

| Group | Remove |
|---|---|
| Agentic Search | `agentic_search:read:knowledge_graph`, `agentic_search:read:ask` |
| Meetings | `meeting:read:meeting_audio`, `meeting:read:meeting_transcript` (both real-time streams), `meeting:read:participant`, `meeting:read:participant_feedback`, `meeting:read:participant_sharing` |
| Webinars | `webinar:read:participant_data_connection`, `webinar:read:list_past_instances`, `webinar:read:list_past_participants`, `webinar:read:participant`, `webinar:read:participant_feedback`, `webinar:read:participant_sharing` |
| Recording | `cloud_recording:read:recording_analytics_details`, `cloud_recording:read:content`, `cloud_recording:read:registrant_status`, `cloud_recording:read:recording` |

A scope whose bin icon is grey is held by a feature that is turned on, probably real-time media streams under
**Features**. Turn that feature off first, then remove the scope.

The **Scope description** box under the list asks how the data is used and whether it is stored. Paste:

> zm reads this data only when the user runs a command. Meeting records, transcripts, summaries, participants,
> recordings' details and chat are stored on the user's own computer in a local SQLite database file, unencrypted
> by zm and protected by the operating system's file permissions; recordings the user downloads are files in a
> folder they choose. Contacts and live search results are not stored. OAuth tokens are kept in the operating system's credential store. No
> data is sent to a WireCat server.

If the two `team_chat` scopes are missing from the picker, search for "team chat" or "contact". Zoom may list them
only when the app's Team Chat feature is on; this is not confirmed.

## 5. App Listing

| Field | Value |
|---|---|
| App name | `WireCat CLI` |
| App icon | The 160×160 logo; a dark version is optional |
| Short description | `Keep a private, searchable archive of your Zoom meetings on your own computer, and search it from the terminal or an AI agent.` |
| Long description | The text below |
| App Gallery | Screenshots of zm in a terminal, made with invented meetings |
| Company name | `WireCat` |
| Developer contact | The email you read |
| Category | Productivity, or the closest one offered |
| Privacy Policy URL | `https://wirecat.dev/en/privacy` |
| Terms of Use URL | `https://wirecat.dev/en/terms` |
| Support URL | `https://wirecat.dev/en/docs/zm` |
| Documentation URL | `https://wirecat.dev/en/docs/zm` |

Long description:

> WireCat CLI connects zm, an open-source command-line tool, to your Zoom account. It copies your hosted meetings'
> transcripts, AI summaries, participants and meeting chat into a local database on your computer, so you can
> search everything you discussed, see who said what, and prepare for upcoming meetings. It can also create, change
> and cancel meetings and read your Zoom contacts when you ask it to. zm calls the Zoom API directly from your
> computer: WireCat runs no server that stores your Zoom data, and the app holds no secret. WireCat is an
> independent open-source project.

**Deauthorization endpoint.** Zoom calls this address when a user removes the app, and its OAuth page says an app
"must delete all associated user data" afterwards. zm keeps nothing on a server, so there is nothing to delete, but
the field may still be required. If the form refuses to continue without it, stop and ask for an endpoint on
wirecat.dev first; leave it empty if it is optional.

## 6. Technical Design

Fill in what the page asks: how the app is built, its security controls and how it uses each scope's data. The
short answers: a command-line tool on the user's computer; tokens in the operating system's keyring; data in a
local database; no WireCat server; open source at `https://github.com/WireCatLabs/zoom-cli`.

Zoom's production guide lists security documents (SSDLC description, SAST and DAST scan results, privacy policy and
three of five policies) and says they "are not prerequisites for submitting an app for Marketplace publication";
they are required for sharing a beta link with other accounts. If the dashboard still blocks submission, note which
document it asks for and have it drafted from the repository's CI checks.

## 7. Beta test with the Production Client ID

A first submission must log in with the Production Client ID.

1. **Beta Test** → **Add App Now** → **Allow**.
2. Point zm at the Production app and log in:

   ```sh
   zm config set zoom.client_id <production-public-client-id>
   zm personal session start
   ```

3. Run the checks from [step 1](#1-test-on-the-development-side-first) again.
4. **Preview Your App Listing Page** to see the listing as users will.

To go back to the Development app afterwards, set its Client ID the same way and run `zm personal session start`.

## 8. App Submission

Left menu, Production tab: **App Submission**.

1. Complete every field it lists as missing; each item links to its page.
2. **Audience**: **External Zoom users**.
3. **Verify Domains** → `wirecat.dev` → **Verify**. Either:
   - **Upload an HTML file**: download Zoom's file and have it added to the site's `public/` folder in cli-docs; or
   - **Add TXT record**: add the record in Cloudflare DNS for `wirecat.dev`.
4. **Release notes for app reviewer**: paste the test plan below.
5. **App activation**: **I will manually activate my app**, so the zm release with the built-in ID ships first.
6. **Test account**: a user on a paid Zoom account where `zm personal zoom search` returns results. Zoom's hosted
   search depends on the account's license, so a reviewer's free account may fail it and reject the scope. Enter
   the login in the form only, never in this file.
7. Read and accept the **Marketplace developer agreement**, then **Submit**.

Test plan for the reviewer:

> zm is an open-source command-line tool with no web UI and no account of its own; it uses the reviewer's Zoom
> login. Install Node.js 22 or later, then: `npm install -g @wirecat/zoom-cli`,
> `zm config set zoom.client_id <production id>`, `zm personal session start` and approve in the browser.
> Read: `zm personal meetings sync --since-time 2026-10-01`, `zm personal search meetings "<a word from a recent
> meeting>"`, `zm personal recordings list`, `zm personal contacts list`, `zm personal zoom search "<a word from a recent chat>"`
> (use the test account above: search needs a paid Zoom license). Manage meetings (each asks first; `--yes`
> applies): `zm personal remote-meetings create --title "Review test" --start-time 2026-12-01T10:00:00Z
> --duration-minutes 30 --yes`, then `remote-meetings update <id> --title "Review test 2" --yes` and
> `remote-meetings cancel <id> --yes`. Uninstall: remove the app under Manage → Added Apps. All data stays on the
> reviewer's computer. Source: `https://github.com/WireCatLabs/zoom-cli`.

## 9. After you submit

- Review notes appear as a speech-bubble icon in the app status panel. Answer or acknowledge every note before you
  resubmit.
- A scope the reviewer cannot exercise is the usual reason for a rejection; the test plan names a command for each.

## 10. After approval

1. Send the Production Public Client ID to the zm maintainers. A zm release makes it the built-in ID: a user then
   needs no `zoom.client_id`, and an ID someone set themselves still wins.
2. When that release is out, open the app in Marketplace and select **Activate**.
3. Update [Connect a Zoom app](../zoom-app.md) so its first path is "install zm and log in".

## Sources

- [Prepare your app for production](https://developers.zoom.us/docs/build-flow/prep-app-for-prod/)
- [Submit apps for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review/)
- [App review process](https://developers.zoom.us/docs/distribute/app-review-process/)
- [Sharing private and beta apps](https://developers.zoom.us/docs/distribute/sharing-private-and-beta-apps/)
- [OAuth, including deauthorization](https://developers.zoom.us/docs/integrations/oauth/)
- [Granular scopes](https://developers.zoom.us/docs/integrations/oauth-scopes-granular/)

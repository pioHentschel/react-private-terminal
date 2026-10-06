# Pip-Boy Terminal (React)

A Pip-Boy styled dashboard built with React and TypeScript (Create React App).
The app lives in [`demoui-app/`](demoui-app/); every command below is run from there.

**Part of this code was written by Claude from Anthropic**

## Tabs

| Tab | What it does |
| --- | --- |
| STAT | Placeholder |
| INV | Inventory: stock lists on the left, items in the selected list in the middle, items that need restocking on the right. Every item has a quantity. Saved in the browser (`localStorage`). |
| DATA | Read-only Google Calendar view: events of the selected day, details of the clicked event on the right. Needs the Google setup below. |
| MAP | Placeholder |
| TERMINAL | Chat-style terminal with list commands (`help` shows them). Lists reset on reload. |
| RADIO | Web radio player with a visualizer. Ogg streams don't play in Safari. |

The CRT button in the top bar toggles a scanline effect. The left/right arrow keys switch tabs (not while typing in a field).

## Getting started

Requirements: [Node.js](https://nodejs.org/) and [Yarn 1](https://classic.yarnpkg.com/).

```bash
cd demoui-app
yarn install
yarn start
```

The app opens at <http://localhost:3000>. Without the Google setup below, everything works except the DATA tab, which shows a setup hint.

Other scripts: `yarn build` (production build into `demoui-app/build`) and `yarn test`.

### If `yarn start` fails with exit code 127

`react-scripts: command not found` means the dependencies are missing or broken. Reinstall them:

```bash
cd demoui-app && rm -rf node_modules && yarn install
```

Also make sure you run yarn inside `demoui-app/`, not the repository root (there is no `package.json` there).

## Google Calendar setup (DATA tab)

The DATA tab reads your calendar with OAuth in the browser. There is no backend and no API key; you only need an OAuth **Client ID**. It is read-only (`calendar.events.readonly`) and uses your primary calendar.

### 1. Create a project and enable the API

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and sign in with the Google account whose calendar you want to read.
2. Create a new project (project picker at the top, **New Project**).
3. Go to **Menu → APIs & Services → Library**, search for **Google Calendar API** and click **Enable**.

### 2. Configure the consent screen

1. Go to **Menu → Google Auth platform → Branding** (click **Get Started** the first time).
2. Enter an app name and your support email.
3. Under **Audience** choose **External** for a normal Gmail account. **Internal** only works for Google Workspace accounts and needs no test users.
4. Enter a contact email, agree to the policy and click **Create**.

### 3. Add yourself as a test user (External only)

Go to **Google Auth platform → Audience**, keep the status on **Testing**, and under **Test users** add your own Google address. Without this, sign-in fails with "access blocked". In Testing mode the permission may expire after about 7 days, so you will have to reconnect from time to time.

### 4. Create the Client ID

1. Go to **Google Auth platform → Clients** and click **Create client**.
2. Choose **Web application**.
3. Under **Authorized JavaScript origins** add `http://localhost:3000`. It must match the address in your browser exactly (no trailing slash, `localhost` is not `127.0.0.1`, same port).
4. Leave the redirect URIs empty, click **Create** and copy the **Client ID** (ends in `.apps.googleusercontent.com`). The client secret is not needed.

### 5. Add the Client ID to the app

Create `demoui-app/.env.local`:

```bash
REACT_APP_GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
```

Restart `yarn start`; environment variables are only read at startup. `.env.local` is gitignored, so your ID is not committed.

### 6. Connect

Open the DATA tab and click **Connect Google Calendar**. In Testing mode Google shows an "unverified app" warning: click **Advanced → Go to … (unsafe)** and approve the read-only access. Today's events appear; use ◀ ▶ to change the day and click an event for its details. **Disconnect** revokes the token.

### Changing the Client ID later

Edit the value in `demoui-app/.env.local`, restart `yarn start`, then click **Disconnect** and connect again so a new token is issued for the new client. If you host the app somewhere else, add that URL to **Authorized JavaScript origins** in the Cloud Console.

The access token is kept only in `sessionStorage` (about one hour); you are asked to sign in again after it expires or the tab is closed.

### Troubleshooting

| Problem | Cause / fix |
| --- | --- |
| DATA tab says `SET REACT_APP_GOOGLE_CLIENT_ID IN .env.local` | The variable is missing or the dev server wasn't restarted after adding it. |
| `origin_mismatch` / `redirect_uri_mismatch` | The origin in step 4 doesn't match the browser address. |
| "Access blocked" / `access_denied` | Your account isn't in the test users list (step 3). |
| Sign-in popup doesn't appear | Allow popups for localhost. |
| 403, API not enabled | The Calendar API isn't enabled in the same project as the Client ID (step 1). |

## Used Libraries

**Main Libraries**
- [chat-ui-kit-react](https://github.com/chatscope/chat-ui-kit-react/)
- [chat-ui-kit-styles](https://github.com/chatscope/chat-ui-kit-styles)
- [use-chat](https://github.com/chatscope/use-chat)
- [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/overview) and the [Google Calendar API](https://developers.google.com/workspace/calendar/api/guides/overview) (DATA tab)

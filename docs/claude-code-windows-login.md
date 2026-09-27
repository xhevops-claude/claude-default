# Claude Code on a headless Windows PC: keeping the login alive

Notes from a session debugging why `claude` (and `claude rc`) on the home
Windows box kept asking for a re-login. Max subscription, PC reached over
RDP from a phone, later to become a Proxmox host.

## What was actually wrong

- The machine was simply **logged out** (`claude auth status` showed
  `"loggedIn": false`). Every launch asked because there was no session
  to refresh, not because one kept expiring.
- The **Windows Time service was stopped** (`w32tm` reported
  `0x80070426`). A drifting clock makes valid tokens look expired, so it
  is a real cause of forced re-logins on a box that never syncs.
- **Pasting the OAuth code into the console over RDP failed** from the
  phone client, which made every login attempt look broken. CMD accepted
  the paste; PowerShell did not.
- Claude Code was on 2.1.269, well past the 2.1.211 fix for the
  sleep/wake token-refresh race, so that known bug was ruled out.

## What was done

1. `claude update` to the current release.
2. Fixed the clock permanently, from an **admin** CMD:

   ```cmd
   sc config w32time start= auto && net start w32time && w32tm /resync && w32tm /query /status
   ```

3. Logged in once with `claude auth login`, in CMD, where paste works.
4. Verified with `claude auth status` (`loggedIn: true`,
   `authMethod: claudeai`).

## How login persistence works

- Subscription login is OAuth. Credentials live in
  `%USERPROFILE%\.claude\.credentials.json` and Claude Code refreshes the
  token on its own. It warns 3 days before a login lapses.
- Things that break it: a stopped or wrong clock, running under a
  different Windows user (scheduled task, service), a different
  `CLAUDE_CONFIG_DIR` between launchers, or `claude logout`.
- There is no "indefinite" login. The longest-lived option is a
  **one-year token** from `claude setup-token`, exported as
  `CLAUDE_CODE_OAUTH_TOKEN` (`setx CLAUDE_CODE_OAUTH_TOKEN <token>` to
  make it permanent for the user). It is supported on Pro/Max for scripts,
  CI and plain `claude` use.
- **That token cannot run Remote Control.** `claude rc` needs the full
  browser login and its normal refresh cycle. Bare mode (`--bare`) ignores
  the token as well and wants an API key.

## Pasting the login code when RDP paste fails

If the console will not take the clipboard, feed it from PowerShell
instead. This starts the login, opens the browser, and waits until the
clipboard changes (hit the copy button on the code page):

```powershell
$old = Get-Clipboard -Raw; & { do { Start-Sleep 1; $c = Get-Clipboard -Raw } while (-not $c -or $c -eq $old); $c.Trim() } | claude auth login
```

Fallback: from a second tab, type the clipboard into the waiting window
(switch to it within 5 seconds):

```powershell
Add-Type -AssemblyName System.Windows.Forms; Start-Sleep 5; [System.Windows.Forms.SendKeys]::SendWait((Get-Clipboard -Raw).Trim() + '{ENTER}')
```

Or just use CMD, which pasted fine.

## Diagnostics one-liner

```powershell
claude --version; claude auth status; w32tm /query /status; Get-ChildItem env: | Where-Object Name -match 'CLAUDE|ANTHROPIC'
```

## If it asks again

Note the exact message. "Login expired" points at a refresh failure
(clock, credentials file, another user). "Your login expires in 3 days"
is the normal renewal notice: run `/login`.

Docs: <https://code.claude.com/docs/en/authentication> and
<https://code.claude.com/docs/en/remote-control>.

# One-time setup

> **Done — 21.8.2026.** Repo: https://github.com/ollirimpilainen/herrfors-nat-vikailmoitus-proto
> Live: https://ollirimpilainen.github.io/herrfors-nat-vikailmoitus-proto/
> Nothing below needs running again; kept for the record.


Paste the prompt below into Claude Code from inside this folder.

---

Create a public GitHub repo called `herrfors-nat-vikailmoitus-proto` from the files
in this directory and publish it on GitHub Pages.

Steps:
1. `git init` if needed, commit everything on `main`
2. Create the repo with `gh repo create` (public, push the local folder)
3. Enable GitHub Pages: source `main`, path `/` (root)
4. Print the live URL and confirm it returns 200 once the build finishes

Description: "Interaction prototype — location section of the Herrfors Nät fault
reporting form. Leaflet + OpenStreetMap, no API keys."

Read CLAUDE.md first — it has the constraints for any future work here.

---

## Afterwards

Replace `USERNAME` in README.md with the actual GitHub account so the live link
resolves.

You are running unattended as the daily security job for this Homebridge plugin
(homebridge-unifi-network-stats). TypeScript sources are in src/, tests in test/. Nobody is
watching, so be conservative: an unnecessary change is worse than no change.

1. Review every file in src/ for concrete security vulnerabilities and risky patterns, for example:
   - credentials, cookies or tokens leaking into logs, error messages or thrown errors
   - TLS/HTTPS handling, redirects or proxies that could send credentials elsewhere
   - URL/host/path injection or SSRF from config values
   - prototype pollution, unsafe parsing of UniFi responses, unbounded input or memory use
   - unhandled promise rejections or exceptions that could crash Homebridge
   - login storms / missing backoff that could lock the UniFi account (UniFi OS returns HTTP 429)
2. Fix only real, specific issues, with the smallest change that fixes each one. Do not refactor,
   restyle, rename, reformat, or change features, config options, defaults, accessory names or
   documented behaviour. `rejectUnauthorized` defaulting to false is intentional (UniFi consoles
   use self-signed certificates) — leave it.
3. For each fix, add or update a test in test/ where feasible.
4. Run `npm test`. It must pass. If you cannot make it pass, undo all of your edits.
5. Do not edit package.json or package-lock.json, do not bump the version, and do not run git or
   any command other than `npm run build` and `npm test`. Only read files inside this repository.

End your reply with a section that starts with the exact line `## Summary`, followed by one
bullet per fix (file and what changed), or the single line `No security issues found.`

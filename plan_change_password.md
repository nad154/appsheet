# Plan: Change Password (self-service + SUPER_ADMIN emergency reset)

## 1. Goal

- Every user can change **their own** password after receiving credentials: current password, new password, confirm new password. Done.
- In an emergency, a SUPER_ADMIN can set a new password for a STAFF user. The SUPER_ADMIN must first re-enter **their own** password, then enter new password + confirm.
- Nobody can ever *see* a password. Only argon2 hashes are stored; no endpoint returns a hash or plaintext.

## 2. Decisions (from the request) and my recommendations

| Topic | Decision |
|---|---|
| STAFF self-change | Current password + new + confirm. Takes effect immediately. |
| SUPER_ADMIN emergency reset | Requires the SUPER_ADMIN's own password, then new + confirm. |
| SUPER_ADMIN self-change | Same self-service flow as STAFF (recommended; the seeded admin starts with a known default password). |
| Reset target | STAFF accounts only. Resetting another SUPER_ADMIN, or yourself via the reset route, is rejected (use the self-change flow). |
| Password policy | Min 8 chars (matches `userCreateSchema`), max 128 (avoids argon2 DoS on huge inputs), new must differ from current. No complexity rules in v1. |
| Sessions after self-change | All other refresh sessions revoked; the current device gets a fresh session so the user is not logged out. |
| Sessions after admin reset | All of that STAFF's refresh sessions revoked, forcing re-login with the new password. |
| Telling STAFF the new password | Out-of-band (the admin tells them). See open question on forced change at next login. |
| Forgotten SUPER_ADMIN password | Not recoverable from the web app (by design). Recovered with a server-side CLI script, see section 9. |
| Last SUPER_ADMIN | Cannot be deactivated or demoted while they are the only active SUPER_ADMIN, see section 9.3. |

## 3. Existing code this builds on

- `authService.ts`: `argon2.verify`, `issueSession`, `revokeAllSessionsForUser` (already used on deactivate).
- `auth/routes.ts`: `/api/auth/*`, `requireAuth`, `rateLimit` (in-memory, keyed by IP).
- `settings/routes.ts` + `settingsService.ts`: SUPER_ADMIN-only router; `updateUser` already blocks self-lockout.
- `users.password_hash` column already exists. `users.parquet` is exported from `v_users_public` (no hash), and a password change touches no public column, so **no `exportSnapshots` call is needed**.
- Web: `/settings` route is SUPER_ADMIN-only, so STAFF currently has **no settings page** (see section 6).

## 4. Backend

### 4.1 Shared schemas (`packages/shared/src/schemas/password.ts`, export from `index.ts`)

```ts
const newPassword = z.string().min(8).max(128);

export const changeOwnPasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: newPassword,
  confirm_password: z.string(),
}).refine(v => v.new_password === v.confirm_password,
          { path: ['confirm_password'], message: 'Passwords do not match' })
  .refine(v => v.new_password !== v.current_password,
          { path: ['new_password'], message: 'New password must differ from the current one' });

export const adminResetPasswordSchema = z.object({
  admin_password: z.string().min(1).max(128),
  new_password: newPassword,
  confirm_password: z.string(),
}).refine(v => v.new_password === v.confirm_password,
          { path: ['confirm_password'], message: 'Passwords do not match' });
```

The server re-validates the confirm match even though the UI checks it too.

### 4.2 Service (`authService.ts`)

`changeOwnPassword(userId, payload)`:
1. Load the user from the DB by `req.user.id` (never trust the role or hash from the token).
2. `argon2.verify(hash, current_password)`; on failure throw `AuthError('Current password is incorrect', 400)`.
3. `argon2.hash(new_password)` **before** entering `runWrite` (keep the write mutex short).
4. In one `runWrite`: `UPDATE users SET password_hash = ? WHERE id = ?`, then `UPDATE sessions SET revoked = true WHERE user_id = ?`.
5. Call `issueSession(user)` and return `{ accessToken, refreshToken }` for the current device.

`adminResetPassword(admin, targetId, payload)` (put in `settingsService.ts`, next to `updateUser`):
1. Load the admin by `admin.id` and verify `admin_password`; failure gives 400 `'Your password is incorrect'`.
2. Load the target. 404 if missing; 400 if `target.role !== 'STAFF'`; 400 if `target.id === admin.id`.
3. Hash the new password, update `users.password_hash`, then `revokeAllSessionsForUser(targetId)`.
4. Return `{ ok: true }`. Nothing about the hash or password is returned or logged.

### 4.3 Routes

| Route | Guard | Notes |
|---|---|---|
| `POST /api/auth/change-password` | `requireAuth`, rate limit | Any active role. Returns `{ accessToken, refreshToken }`. |
| `POST /api/settings/users/:id/password` | `requireAuth`, `requireRole('SUPER_ADMIN')` (already on the router), rate limit | Admin emergency reset. |

**Important:** a wrong current/admin password must return **400 (or 403), never 401**. The web `api-client` treats any 401 as "access token expired", runs a refresh and, on failure, logs the user out.

### 4.4 Rate limiting

`rateLimit` is keyed by IP. Add an optional `keyFn(req)` so these two routes key on `req.user.id` (for example 5 attempts per 15 minutes) and a guesser can't brute-force the current password. Mount it after `requireAuth`. Failed attempts and successes both count (simple fixed window is enough).

### 4.5 Known limitation: access token lifetime

Access JWTs are stateless (15 min TTL). After an admin reset, an already-issued STAFF access token stays valid until it expires; only the refresh is blocked. Acceptable for v1. If it ever matters: add a `token_version` column checked in `requireAuth` (would need a DB read per request, so not worth it now).

## 5. Security checklist

- Hashes never leave the server; `toPublicUser` and `/me` already omit `password_hash`.
- Do not log request bodies for these routes (the current error handlers only log `err`; keep it that way).
- Role and identity come from the verified token plus a DB lookup, never from the request body.
- Admin reset re-authenticates the admin so a hijacked or left-open admin session cannot silently take over STAFF accounts.
- Server-side confirm-match and different-from-current checks (do not rely on the UI).
- The existing `updateUser` / `userUpdateSchema` stay password-free so password changes can only happen through these two routes.

## 6. Frontend

### 6.1 Where STAFF changes it

STAFF has no Settings page today (`/settings` is SUPER_ADMIN-only). Recommendation: add a small **Account** page at `/account`, open to every role (plain `ProtectedRoute`, no `roles`), linked from the user area in `AppLayout` (click the name/avatar, or an "Account" nav item). SUPER_ADMIN keeps their Settings page and also uses `/account` for their own password. If you would rather call it "Settings" for STAFF, only the label and route change.

### 6.2 Account page (`apps/web/src/app/account/AccountPage.tsx`)

- Card "Change password" with three password inputs: Current, New, Confirm new (`autoComplete` set to `current-password` / `new-password`).
- Client validation mirrors the shared schema (react-hook-form + `zodResolver(changeOwnPasswordSchema)`, same pattern as `LoginPage`).
- Submit button disabled while pending; inline error (from the server message) for a wrong current password.
- On success: `tokenStore.setTokens(accessToken, refreshToken)`, clear the form, toast "Password changed."

### 6.3 Hook (`hooks/useChangePassword.ts`)

`useMutation` posting to `/api/auth/change-password`; `onSuccess` stores the new tokens. Because it touches `tokenStore`, keep the token write in the hook (no React dependency needed in `tokenStore`).

### 6.4 Admin reset (Settings, `UsersPanel`)

- New "Reset password" button per row, shown **only for STAFF rows** (not for SUPER_ADMIN rows or yourself).
- Opens a `Modal`: "Reset password for {name}" with fields: *Your password*, *New password*, *Confirm new password*, and a note that the user will be signed out on all devices and the admin must tell them the new password directly.
- Hook `useResetUserPassword` posts to `/api/settings/users/:id/password`; toast on success, inline error otherwise. Clear the fields when the modal closes.

## 7. Tests

- **Vitest** (`packages/shared`): schema cases (mismatch, too short, too long, same as current).
- **Smoke** (`apps/server/smoke.ts`): wrong current password gives 400 (not 401); success returns new tokens; old password then fails login and new one works; old refresh token revoked; STAFF cannot call the admin route (403); admin reset with a wrong admin password gives 400; reset of a SUPER_ADMIN or self gives 400; reset then login as STAFF with the new password. **Restore `staff12345` at the end** since other specs log in with it.
- **Playwright** (`apps/web/e2e/change-password.spec.ts`): STAFF changes password on `/account`, logs out, logs in with the new one, changes it back; mismatch shows an error; admin resets a STAFF password through the modal and the STAFF can log in with it. Every test ends with the fixture password restored, like the other specs.

## 8. Implementation order

1. Shared schemas + export + unit tests.
2. `changeOwnPassword` + route + `rateLimit` `keyFn`.
3. `adminResetPassword` + settings route.
4. Smoke script additions.
5. Account page, hook, route and nav link.
6. Reset modal in `UsersPanel`.
7. Playwright spec; run typecheck, vitest, smoke, e2e.
8. `resetPassword.ts` CLI script and `reset-password` package script; test it by hand with the server stopped (reset a throwaway user, log in with the new password).
9. Last-admin guard in `updateUser` (plus smoke case: the sole SUPER_ADMIN cannot be demoted or deactivated).
10. Docker notes: confirm the data volume mount and document the stop-run-start reset procedure in the README when the Dockerfile is added.

## 9. Recovery for a forgotten SUPER_ADMIN password

The web app deliberately cannot reset a SUPER_ADMIN password (a hijacked admin session must not be able to take over other admins). Recovery is done on the server machine instead, where only someone with shell access can do it.

### 9.1 The script (`apps/server/src/resetPassword.ts`)

Sits next to `seed.ts`. Package scripts: `"reset-password": "tsx src/resetPassword.ts"` for local dev; the built file is `dist/resetPassword.js`.

Flow:
1. Takes the account email as an optional argument, otherwise prompts for it. Looks the user up case-insensitively; exits with a clear message if not found or inactive.
2. Prompts for the new password twice with **hidden input** (readline with echo muted). The password is never accepted as a CLI argument or env var, so it can't end up in shell history or process listings. Refuses to run without an interactive terminal.
3. Applies the same rules as the app (8 to 128 chars, both entries must match), importing the shared password rule from `@tracker/shared` so the two can't drift.
4. Hashes with argon2, then in one `runWrite`: `UPDATE users SET password_hash = ?` and `UPDATE sessions SET revoked = true WHERE user_id = ?`.
5. Works for any role (this is the one place a SUPER_ADMIN can be reset). Prints only "Password updated for <email>"; never prints the password or the hash.
6. Runs `CHECKPOINT` and closes the DB cleanly via `closeDb()` (avoids the stale-WAL problem already handled in `start-safe.js`).

It must **not** import `auth/config.ts` (it throws when the JWT secrets are missing and the script doesn't need them). Import only `db/connection.js`, `argon2` and the shared rule.

### 9.2 Running it (local and Docker)

DuckDB allows one process on the database file, so **the app must be stopped first**; otherwise the script fails with the existing "database already open" error.

- **Local:** stop `dev:server` / `start`, run `npm run reset-password -w @tracker/server`, restart.
- **Docker:** stop the app container, then run the script in a one-off container that mounts the **same data volume**, for example `docker compose run --rm app node dist/resetPassword.js`, then start the app again. Expect about a minute of downtime.
- The `apps/server/data` directory (`app.duckdb` and `parquet/`) **must be on a persistent volume**, not the container filesystem. Otherwise redeploys wipe the data and there is nothing for the script to reset.

Hosting note: S3 cannot run this app (it only stores or serves files; the app is an Express server with a DuckDB file that needs a real disk). Plan for a container host instead, for example a Lightsail or EC2 VM running Docker, or ECS Fargate with EFS kept at exactly one task. S3 is useful for backups of the data folder. In every case the script only needs shell access to the host.

### 9.3 Last-admin guard (`settingsService.updateUser`)

Today the only protection is against changing yourself. Add: if the target is an active SUPER_ADMIN and the update would deactivate them or change their role, count the **other** active SUPER_ADMINs inside the same `runWrite`; if there are none, reject with 400 "At least one active SUPER_ADMIN is required". The UI also disables those controls for the last admin.

### 9.4 Operational advice (no code)

Keep at least two SUPER_ADMIN accounts so a forgotten password is a normal inconvenience rather than an emergency.

## 10. Open questions

1. **Forced change at first login?** Since the admin sets the initial password, should a new or reset account be forced to change it on next login (a `must_change_password` flag)? Not in v1 as written; it needs an extra column plus a redirect guard.
2. **Should SUPER_ADMIN use the same self-service change?** Assumed yes.
3. **Notify the STAFF user** (an in-app notification) when an admin resets their password? Not in v1; the notifications table only supports `NEW_APPROVAL` / `AGING_ALERT` types.
4. **Account page vs "Settings" label** for STAFF (see 6.1).

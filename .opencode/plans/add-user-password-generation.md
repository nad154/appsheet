# Plan: Add random password generation and copy credentials for user creation

## Goal
When SUPER_ADMIN creates a new account (SUPER_ADMIN or STAFF), add:
1. Option to generate a random temporary 12-character alphanumeric password
2. A button beside the password field to copy credentials as "email: ... password: ..."

## Current state
- Frontend: apps/web/src/app/settings/SettingsPage.tsx UsersPanel form (lines ~244-298) has name, email, password, role fields
- Backend: apps/server/src/modules/settings/ - createUser uses userCreateSchema which requires password min 8 chars
- Schema: packages/shared/src/schemas/user.ts has userCreateSchema with password min 8

## Implementation approach

### Frontend changes (apps/web/src/app/settings/SettingsPage.tsx)
1. Add helper generateRandomPassword(length=12) using crypto if available, fallback to Math.random
2. In UsersPanel:
   - Add helper to copy credentials
   - Add "Generate random password" button to generate 12-char alphanumeric
   - Add "Copy credentials" button beside password field that copies "email: {email} password: {password}" (only enabled if both email and password present)
   - Show toast/notice on copy success/failure

### Backend changes (if needed)
- Schema already allows passwords (min 8) - 12 chars alphanumeric is fine
- No changes needed

## Files to modify
1. apps/web/src/app/settings/SettingsPage.tsx

## Testing
- Generate password produces 12 chars, alphanumeric
- Copy button copies correct format when email and password filled

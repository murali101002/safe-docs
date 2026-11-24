# SafeDocs

Privacy-first web app (Chrome) that helps patients understand their medical
record PDFs. Built for Google's **#BuildHybridAI** hackathon.

PDF text and tables are extracted **locally** with pdf.js. Explanations run
through Firebase AI Logic in hybrid mode: Chrome's on-device model is
preferred, and the SDK falls back to a cloud Gemini model only when needed —
with a status banner always saying which one ran and what leaves the computer.

## Stack

- Vite + React + TypeScript
- Firebase JS SDK: App Check (reCAPTCHA Enterprise), Auth, Firestore,
  Remote Config, AI Logic (`firebase/ai`, hybrid inference)
- pdf.js (`pdfjs-dist`) for local PDF text/table extraction
- Vitest for unit tests

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Firebase config + App Check keys
npm run dev
```

No real PII or keys are committed; `.env*` is git-ignored.

## Scripts

- `npm run dev` — dev server
- `npm run build` — type-check + production build
- `npm test` — run unit tests once
- `npm run test:watch` — tests in watch mode
- `npm run lint` — oxlint

## Firebase setup notes

- **AI Logic (hybrid)**: enable Gemini Developer API in the Firebase console;
  the model is configured in `src/ai/hybrid.ts` with
  `InferenceMode.PREFER_ON_DEVICE`. On-device inference uses Chrome's built-in
  model (Prompt API) and falls back to `gemini-2.5-flash` in the cloud.
- **App Check**: register a reCAPTCHA Enterprise site key; in dev you can set
  `VITE_APP_CHECK_DEBUG_TOKEN` and add the token under App Check → Manage
  debug tokens.
- **Remote Config**: defaults ship in code (`local_max_tokens: 3000`) so the
  app works before any backend fetch.

## License

[Apache-2.0](LICENSE)

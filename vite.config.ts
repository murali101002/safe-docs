/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    alias: {
      // pdf.js's standard build needs browser APIs and refuses to run in
      // Node; the golden tests import src/pdf/extract.ts, so point the bare
      // specifier at the legacy build for test runs only. The app bundle
      // keeps the standard build.
      'pdfjs-dist': resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    },
  },
})

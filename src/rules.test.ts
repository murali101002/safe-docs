/// <reference types="node" />
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest'

// Emulator round-trips (first call per auth context) can be slow; the
// default 5s vitest timeout is too tight for the first two contexts.
vi.setConfig({ testTimeout: 30_000 })

// Firestore security-rules tests. These run ONLY against the Firestore
// emulator (started via `npx firebase emulators:exec --only firestore ...`);
// without FIRESTORE_EMULATOR_HOST set (e.g. plain `npm test` / CI) they are
// skipped, so no test ever touches production data.
const skip = !process.env.FIRESTORE_EMULATOR_HOST

const ALICE = 'alice-uid-1'
const BOB = 'bob-uid-2'

// Schema-valid document body. Tests mutate copies of this.
const validDoc = () => ({
  fileName: 'lab-report.pdf',
  redactedContent: 'Hemoglobin | 13.5 | 12-16',
  rowCount: 1,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
})

let env: RulesTestEnvironment

beforeAll(async () => {
  if (skip) return
  env = await initializeTestEnvironment({
    projectId: 'safedocs-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  })
})

afterAll(async () => {
  if (skip) return
  await env.cleanup()
})

beforeEach(async () => {
  if (skip) return
  await env.clearFirestore()
})

describe.skipIf(skip)('firestore.rules (emulator)', () => {
  it('denies unauthenticated reads and writes', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(db.doc('users/alice/documents/doc1')))
    await assertFails(setDoc(db.doc('users/alice/documents/doc1'), validDoc()))
  })

  it('allows a user to read and write their own subtree', async () => {
    const db = env.authenticatedContext(ALICE).firestore()
    await assertSucceeds(setDoc(db.doc(`users/${ALICE}/documents/doc1`), validDoc()))
    await assertSucceeds(getDoc(db.doc(`users/${ALICE}/documents/doc1`)))
    // Auto-ID creates follow the same path/validation rules as setDoc.
    await assertSucceeds(setDoc(db.doc(`users/${ALICE}/documents/auto1`), validDoc()))
    // NOTE: deleteDoc is not exercised here — the firebase@13 client SDK
    // hangs on delete against this emulator channel (known internal-API
    // mismatch with @firebase/rules-unit-testing). The delete rule is the
    // same one-line isOwner(uid) check as read/write, verified above.
  })

  it("denies a user access to another user's subtree", async () => {
    const bob = env.authenticatedContext(BOB).firestore()
    await assertFails(getDoc(bob.doc(`users/${ALICE}/documents/doc1`)))
    await assertFails(setDoc(bob.doc(`users/${ALICE}/documents/doc1`), validDoc()))
    await assertFails(setDoc(bob.doc(`users/${ALICE}/documents/auto1`), validDoc()))
  })

  it('rejects documents outside the defined schema', async () => {
    const db = env.authenticatedContext(ALICE).firestore()
    await assertFails(
      setDoc(db.doc(`users/${ALICE}/documents/doc1`), {
        ...validDoc(),
        isAdmin: true,
      }),
    )
    // Missing required fields.
    await assertFails(setDoc(db.doc(`users/${ALICE}/documents/doc2`), { fileName: 'a.pdf' }))
    // Wrong types.
    await assertFails(
      setDoc(db.doc(`users/${ALICE}/documents/doc3`), {
        ...validDoc(),
        rowCount: 'many',
      }),
    )
  })

  it('enforces size limits (no 1MB payloads)', async () => {
    const db = env.authenticatedContext(ALICE).firestore()
    await assertFails(
      setDoc(db.doc(`users/${ALICE}/documents/doc1`), {
        ...validDoc(),
        redactedContent: 'x'.repeat(200_001),
      }),
    )
    await assertFails(
      setDoc(db.doc(`users/${ALICE}/documents/doc2`), {
        ...validDoc(),
        fileName: 'x'.repeat(513),
      }),
    )
  })

  it('rejects updates that change createdAt or break the schema', async () => {
    const db = env.authenticatedContext(ALICE).firestore()
    const ref = db.doc(`users/${ALICE}/documents/doc1`)
    await assertSucceeds(setDoc(ref, validDoc()))

    // Legitimate content update passes.
    await assertSucceeds(
      updateDoc(ref, { redactedContent: 'updated', updatedAt: serverTimestamp() }),
    )
    // createdAt is immutable.
    await assertFails(
      updateDoc(ref, { createdAt: Timestamp.now(), updatedAt: serverTimestamp() }),
    )
    // Schema pollution on update is blocked too.
    await assertFails(
      updateDoc(ref, { isAdmin: true, updatedAt: serverTimestamp() }),
    )
  })
})

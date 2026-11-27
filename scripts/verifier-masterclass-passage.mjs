// Verification du passage connecte d'aoknowledge.com vers le tunnel du replay
// (27/11/2026, src/lib/masterclass-passage-pur.ts, route /api/masterclass/passage) :
// origines, cadence, refus (jeton, compte anonyme ou non confirme, Supabase
// injoignable, jeton d'un autre compte ou d'un autre type) et le cablage de la
// route (aucun log du jeton). Aucune base, aucun reseau.
// node scripts/verifier-masterclass-passage.mjs

import './resoudre-ts.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const P = await import('../src/lib/masterclass-passage-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

const UID = '0f8e1c2a-1111-4222-8333-944455556666'
const HASH = 'a'.repeat(56)
const BEARER = 'eyJ.bearer-du-membre.sig'
const SITE = 'https://aoknowledge.com'

const deps = (o = {}) => {
  const lignes = []
  const appels = { generer: [] }
  return {
    lignes, appels,
    d: {
      compte: o.compte ?? (async () => ({ userId: UID, email: 'membre@exemple.fr', confirme: true, anonyme: false })),
      reserver: o.reserver ?? (() => 0),
      genererJeton: o.genererJeton ?? (async (email) => { appels.generer.push(email); return { ok: true, userId: UID, tokenHash: HASH, type: 'recovery' } }),
      journal: (l) => lignes.push(l),
      codeErreur: (e) => (e && e.name) || 'erreur',
    },
  }
}

await bloc('origines : le site, www et localhost ; rien d autre', () => {
  for (const o of ['https://aoknowledge.com', 'https://www.aoknowledge.com', 'http://localhost:5173', 'http://localhost']) {
    assert.equal(P.origineAutorisee(o), true, o)
    assert.equal(P.entetesPassage(o)['Access-Control-Allow-Origin'], o)
  }
  for (const o of [null, '', 'https://masterclass.aoknowledge.com', 'https://journal.aoknowledge.com', 'https://evil.com',
    'https://aoknowledge.com.evil.com', 'http://aoknowledge.com', 'https://localhost:5173', 'http://localhost.evil.com']) {
    assert.equal(P.origineAutorisee(o), false, String(o))
    assert.equal(P.entetesPassage(o)['Access-Control-Allow-Origin'], undefined)
  }
  assert.equal(P.entetesPassage(null)['Cache-Control'], 'no-store')
  assert.equal(P.entetesPassage(SITE)['Cache-Control'], 'no-store')
})

await bloc('cadence : 10 par 10 minutes, fenetre glissante', () => {
  const t = 1_000_000_000
  assert.equal(P.cadencePassage([], t).autorise, true)
  const neuf = Array.from({ length: 9 }, (_, i) => t - i * 1000)
  assert.equal(P.cadencePassage(neuf, t).autorise, true)
  const dix = [...neuf, t - 60_000]
  const c = P.cadencePassage(dix, t)
  assert.equal(c.autorise, false)
  assert.ok(c.reessayerDansMs > 0 && c.reessayerDansMs <= P.FENETRE_PASSAGES_MS)
  // Les anciens sortent de la fenetre.
  const vieux = Array.from({ length: 10 }, () => t - P.FENETRE_PASSAGES_MS - 1)
  const v = P.cadencePassage(vieux, t)
  assert.equal(v.autorise, true)
  assert.equal(v.recents.length, 0)
})

await bloc('passage nominal : token_hash du compte, type recovery', async () => {
  const { d, lignes, appels } = deps()
  const r = await P.passage(SITE, BEARER, d)
  assert.equal(r.status, 200)
  assert.deepEqual(r.corps, { ok: true, token_hash: HASH, type: 'recovery' })
  assert.deepEqual(appels.generer, ['membre@exemple.fr'])
  // Le journal : 8 caracteres du compte, jamais l adresse ni le token_hash.
  const tout = lignes.join('\n')
  assert.ok(!tout.includes(HASH) && !tout.includes('membre@') && !tout.includes(UID) && !tout.includes(BEARER))
  assert.ok(tout.includes(UID.slice(0, 8)))
})

await bloc('refus : origine, jeton absent, jeton refuse, Supabase injoignable', async () => {
  assert.equal((await P.passage('https://evil.com', 'jeton', deps().d)).corps.erreur, 'origine')
  assert.equal((await P.passage(null, 'jeton', deps().d)).status, 403)
  assert.equal((await P.passage(SITE, null, deps().d)).status, 401)
  assert.equal((await P.passage(SITE, 'jeton', deps({ compte: async () => null }).d)).corps.erreur, 'jeton')
  const r = await P.passage(SITE, 'jeton', deps({ compte: async () => { throw new Error('reseau') } }).d)
  assert.equal(r.status, 503)
  assert.equal(r.corps.erreur, 'indisponible')
})

await bloc('refus : compte anonyme, sans adresse, adresse non confirmee (jamais de generation)', async () => {
  for (const c of [
    { userId: UID, email: 'a@b.fr', confirme: true, anonyme: true },
    { userId: UID, email: null, confirme: true, anonyme: false },
    { userId: UID, email: 'a@b.fr', confirme: false, anonyme: false },
  ]) {
    const { d, appels } = deps({ compte: async () => c })
    const r = await P.passage(SITE, BEARER, d)
    assert.equal(r.status, 403)
    assert.equal(r.corps.erreur, 'compte')
    assert.equal(appels.generer.length, 0)
  }
})

await bloc('cadence depassee : 429 avec Retry-After, pas de generation', async () => {
  const { d, appels } = deps({ reserver: () => 42_500 })
  const r = await P.passage(SITE, BEARER, d)
  assert.equal(r.status, 429)
  assert.equal(r.reessayerDans, 43)
  assert.equal(appels.generer.length, 0)
})

await bloc('generation : erreur, exception, autre compte, autre type, hash vide', async () => {
  const cas = [
    async () => ({ ok: false, erreur: 'supabase 422' }),
    async () => { throw new Error('x') },
    async () => ({ ok: true, userId: 'ffffffff-0000-4000-8000-000000000000', tokenHash: HASH, type: 'recovery' }),
    async () => ({ ok: true, userId: UID, tokenHash: HASH, type: 'magiclink' }),
    async () => ({ ok: true, userId: UID, tokenHash: '', type: 'recovery' }),
  ]
  for (const genererJeton of cas) {
    const { d, lignes } = deps({ genererJeton })
    const r = await P.passage(SITE, BEARER, d)
    assert.equal(r.status, 502)
    assert.equal(r.corps.erreur, 'generation')
    assert.ok(!('token_hash' in r.corps))
    assert.ok(!lignes.join('\n').includes(HASH))
  }
})

await bloc('cablage de la route : recovery, no-store, aucun log du jeton', () => {
  const route = lire('src/app/api/masterclass/passage/route.ts')
  assert.match(route, /generateLink\(\{ type: TYPE_PASSAGE, email \}\)/)
  assert.match(route, /jetonDeLaRequete\(req\.headers\.get\('authorization'\)\)/)
  assert.equal(P.TYPE_PASSAGE, 'recovery')
  // Aucun console.* ne cite le jeton, le hash ni l adresse.
  for (const l of route.split('\n').filter(x => /console\./.test(x))) {
    assert.ok(!/hashed_token|tokenHash|token_hash|email\b|jeton\b/.test(l.replace(/\$\{PREFIXE\}/, '')), l)
  }
  // Route non publique dans le middleware : le Bearer est exige avant la route.
  const mw = lire('middleware.ts')
  assert.ok(!mw.includes('/api/masterclass'))
})

console.log(`\n${n} blocs ok`)

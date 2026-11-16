// Verifie la page de retour du lien pour le Carnet du Trader (16/11/2026) :
// https://journal.aoknowledge.com/auth/carnet, HORS LIGNE. La partie pure
// (src/lib/connexion-carnet-pur.ts : lecture du lien, message et reponse du
// Carnet, ordre d'envoi Store puis version locale, textes), puis la page relue
// pour les garde-fous qui ne tiennent pas dans une fonction pure (aucune
// verification du jeton par le journal, aucun log, fragment retire).
// Aucun appel reseau, aucune extension, aucun email.
//
//   node scripts/verifier-connexion-carnet.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ECRIS_NOUS_CARNET, EXTENSIONS_CARNET, LENT, MESSAGE_LIEN, TEXTES_CARNET,
  lienEcrisNousCarnet, lireLienCarnet, lireReponseCarnet, messageCarnet, transmettreAuCarnet,
} from '../src/lib/connexion-carnet-pur.ts'
import { EXTENSION_CARNET_LOCALE, EXTENSION_CARNET_STORE, ORIGINES, PAGE_LIEN_CARNET } from '../src/lib/connexion-adresse-pur.ts'

const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const INTERDITS = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x200b].map(x => String.fromCharCode(x)).join('')}]`)

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }

const JETON = 'a'.repeat(56)
const [STORE, LOCALE] = EXTENSIONS_CARNET

await bloc('les deux identifiants autorises, et eux seuls : Store puis version locale (memes que ORIGINES)', () => {
  assert.deepEqual([...EXTENSIONS_CARNET], [EXTENSION_CARNET_STORE, EXTENSION_CARNET_LOCALE])
  assert.deepEqual([...EXTENSIONS_CARNET], ['phajegonlmgnjkkfdooedoddnmgpheic', 'klggbgjkojkcblgodajdjhhineocchbe'])
  for (const id of EXTENSIONS_CARNET) assert.equal(ORIGINES[`chrome-extension://${id}`], PAGE_LIEN_CARNET)
  assert.equal(PAGE_LIEN_CARNET, 'https://journal.aoknowledge.com/auth/carnet')
})

await bloc('lecture du lien : jeton du fragment (type connu ou rien), code du repli, sinon null', () => {
  assert.deepEqual(lireLienCarnet(`#token_hash=${JETON}&type=magiclink`, ''), { t: 'jeton', tokenHash: JETON, type: 'magiclink' })
  assert.deepEqual(lireLienCarnet(`#token_hash=${JETON}&type=signup`, '?retour=%2F'), { t: 'jeton', tokenHash: JETON, type: 'signup' })
  assert.deepEqual(lireLienCarnet(`#token_hash=${JETON}&type=recovery`, ''), { t: 'jeton', tokenHash: JETON, type: null }, 'type inconnu du Carnet : il prend magiclink')
  assert.deepEqual(lireLienCarnet(`#token_hash=${JETON}`, ''), { t: 'jeton', tokenHash: JETON, type: null })
  assert.deepEqual(lireLienCarnet('', '?code=0b5c1a2e-7d3f-4c55-9a1e-2f6d8b9c0a11'), { t: 'code', code: '0b5c1a2e-7d3f-4c55-9a1e-2f6d8b9c0a11' })
  for (const [h, s] of [['', ''], ['#', '?'], ['#token_hash=court&type=magiclink', ''], [`#token_hash=${'a'.repeat(20)}<x>`, ''], ['', '?code=court'], ['', '?code=a b c d e f g h']]) {
    assert.equal(lireLienCarnet(h, s), null, `${h} ${s}`)
  }
})

await bloc('le message : exactement la forme que le Carnet attend (MESSAGE_LIEN, token_hash, otpType ou code)', () => {
  assert.equal(MESSAGE_LIEN, 'carnet:connexion-lien')
  assert.deepEqual(messageCarnet({ t: 'jeton', tokenHash: JETON, type: 'signup' }), { type: 'carnet:connexion-lien', token_hash: JETON, otpType: 'signup' })
  assert.deepEqual(messageCarnet({ t: 'jeton', tokenHash: JETON, type: null }), { type: 'carnet:connexion-lien', token_hash: JETON })
  assert.deepEqual(messageCarnet({ t: 'code', code: 'abcdefgh12' }), { type: 'carnet:connexion-lien', code: 'abcdefgh12' })
})

await bloc('la reponse du Carnet : ok, ou une raison connue ; tout le reste = pas de reponse', () => {
  assert.deepEqual(lireReponseCarnet({ ok: true }), { ok: true })
  for (const r of ['pas-attendu', 'expire', 'trop', 'autre-compte', 'erreur']) assert.deepEqual(lireReponseCarnet({ ok: false, raison: r }), { ok: false, raison: r })
  for (const v of [null, undefined, {}, 'ok', { ok: 'true' }, { ok: false }, { ok: false, raison: 'bizarre' }, LENT]) assert.equal(lireReponseCarnet(v), null, String(v))
})

function carnets(reponses) {
  const appels = []
  return { appels, envoyer: async (id, message) => { appels.push({ id, message }); return id in reponses ? reponses[id] : null } }
}
const DEMANDE = { t: 'jeton', tokenHash: JETON, type: 'magiclink' }

await bloc('envoi : Store d abord ; une reponse claire arrete ; version locale seulement si le Store ne repond pas', async () => {
  let c = carnets({ [STORE]: { ok: true } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'ok')
  assert.deepEqual(c.appels.map(a => a.id), [STORE])
  assert.deepEqual(c.appels[0].message, { type: 'carnet:connexion-lien', token_hash: JETON, otpType: 'magiclink' })

  c = carnets({ [LOCALE]: { ok: true } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'ok')
  assert.deepEqual(c.appels.map(a => a.id), [STORE, LOCALE])

  for (const raison of ['expire', 'trop', 'autre-compte', 'erreur']) {
    c = carnets({ [STORE]: { ok: false, raison }, [LOCALE]: { ok: true } })
    assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), raison)
    assert.deepEqual(c.appels.map(a => a.id), [STORE], `${raison} : le jeton a ete essaye, il ne part pas une seconde fois`)
  }
})

await bloc('envoi : « pas-attendu » laisse essayer l autre Carnet ; lent arrete ; personne = absente', async () => {
  let c = carnets({ [STORE]: { ok: false, raison: 'pas-attendu' }, [LOCALE]: { ok: true } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'ok')
  c = carnets({ [STORE]: { ok: false, raison: 'pas-attendu' } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'pas-attendu')
  c = carnets({ [LOCALE]: { ok: false, raison: 'pas-attendu' } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'pas-attendu')
  c = carnets({ [STORE]: LENT, [LOCALE]: { ok: true } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'lent')
  assert.deepEqual(c.appels.map(a => a.id), [STORE])
  c = carnets({})
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'absente')
  assert.deepEqual(c.appels.map(a => a.id), [STORE, LOCALE])
  c = carnets({ [STORE]: { ok: 'bizarre' } })
  assert.equal(await transmettreAuCarnet(DEMANDE, c.envoyer), 'absente')
  assert.equal(await transmettreAuCarnet(DEMANDE, async () => { throw new Error('x') }), 'absente', 'ne jette pas')
})

await bloc('textes : chaque cas a un titre et un texte clairs, aucun caractere interdit, sortie « Ecris-nous » sans adresse', () => {
  for (const k of ['envoi', 'ok', 'absente', 'expire', 'pas-attendu', 'autre-compte', 'trop', 'erreur', 'lent', 'invalide']) {
    assert.ok(TEXTES_CARNET[k]?.titre && TEXTES_CARNET[k]?.texte, k)
  }
  assert.match(TEXTES_CARNET.ok.titre, /Carnet du Trader est connecté/)
  assert.match(TEXTES_CARNET.ok.texte, /revenir dans le Carnet/)
  assert.match(TEXTES_CARNET.absente.texte, /navigateur où le Carnet est installé/)
  assert.match(TEXTES_CARNET.absente.texte, /code à 6 chiffres/)
  assert.match(TEXTES_CARNET.expire.titre, /expiré ou a déjà servi/)
  assert.ok(lienEcrisNousCarnet().startsWith('mailto:support@aoknowledge.com?subject='))
  assert.ok(!/@.*@/.test(lienEcrisNousCarnet()))
  assert.ok(!INTERDITS.test(JSON.stringify(TEXTES_CARNET) + ECRIS_NOUS_CARNET + lire('src/lib/connexion-carnet-pur.ts')))
})

await bloc('page /auth/carnet : ne verifie pas le jeton, ne connecte pas le journal, aucun log, fragment retire, demo hors production', () => {
  const p = lire('src/app/auth/carnet/page.tsx')
  assert.ok(!/supabase/i.test(p.replace(/^\s*\/\/.*$/gm, '')), 'aucun client Supabase dans la page')
  assert.ok(!/verifyOtp|exchangeCodeForSession|signIn/.test(p.replace(/^\s*\/\/.*$/gm, '')))
  assert.ok(!/console\./.test(p), 'le jeton n est jamais journalise')
  assert.match(p, /runtime\.sendMessage\(id, message, reponse =>/)
  assert.match(p, /runtime\.lastError/)
  assert.match(p, /transmettreAuCarnet\(demande, envoyer\)/)
  assert.match(p, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/)
  assert.match(p, /const demo = process\.env\.NODE_ENV !== 'production' && process\.env\.NEXT_PUBLIC_CONNEXION_DEMO === '1'/)
  assert.ok(!INTERDITS.test(p))
  assert.match(lire('middleware.ts'), /const publicPaths = \['\/auth',/, '/auth/carnet est publique par le prefixe /auth')
})

console.log(`\n${n} blocs ok`)

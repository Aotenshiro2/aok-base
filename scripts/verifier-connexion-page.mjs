// Verifie la page de connexion du journal (16/11/2026, brief
// 2026-11-16-connexion-ecosysteme), HORS LIGNE : la partie pure
// (src/lib/connexion-page-pur.ts : lecture des reponses des routes, refus de
// Supabase, code, retour, jeton du lien, textes), puis la page, les ecrans,
// les appels et la page /auth/lien relus pour les garde-fous qui ne tiennent
// pas dans une fonction pure. Aucun appel reseau, aucune base, aucun email.
//
//   node scripts/verifier-connexion-page.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CODE_SUPABASE, DELAI_RENVOI_S, LONGUEUR_CODE, SUJET_AOK, TEXTES,
  adresseValide, cheminRetourSur, cleAdresse, codeDansEmail, codeSaisi, estGmail, issueCode, issueEnvoi, lienEcrisNous,
  lireEnvoiRoute, lireJetonDuFragment, lireReconnaissance, messageOubli, texteDejaParti, texteDelai, textePlafond, texteRenvoi,
} from '../src/lib/connexion-page-pur.ts'
import { SUJET, ORIGINES, baseDuLien } from '../src/lib/connexion-adresse-pur.ts'

const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const INTERDITS = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x200b].map(x => String.fromCharCode(x)).join('')}]`)

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }

// ------------------------------------------------------------------ pur

await bloc('reponses des routes : une porte, ou simple ; envoi lu comme le site, null = repli', () => {
  for (const r of ['google', 'connue', 'inconnue', 'rattachee']) assert.equal(lireReconnaissance({ reponse: r }), r)
  for (const v of [null, {}, { reponse: 'limite' }, { reponse: 'admin' }, 'google', { reponse: 3 }]) assert.equal(lireReconnaissance(v), 'simple')
  assert.deepEqual(lireEnvoiRoute({ envoi: 'ok' }), { t: 'ok', voie: 'aok' })
  assert.deepEqual(lireEnvoiRoute({ envoi: 'delai', secondes: 42 }), { t: 'delai', secondes: 42, voie: 'aok' })
  assert.deepEqual(lireEnvoiRoute({ envoi: 'delai' }), { t: 'delai', secondes: 60, voie: 'aok' })
  assert.deepEqual(lireEnvoiRoute({ envoi: 'delai', secondes: 99999 }), { t: 'delai', secondes: 3600, voie: 'aok' })
  for (const r of ['plafond', 'limite']) assert.deepEqual(lireEnvoiRoute({ envoi: r }), { t: 'plafond' })
  assert.deepEqual(lireEnvoiRoute({ envoi: 'rattachee' }), { t: 'rattachee' })
  assert.deepEqual(lireEnvoiRoute({ envoi: 'inconnue' }), { t: 'inconnue' })
  assert.deepEqual(lireEnvoiRoute({ envoi: 'invalide' }), { t: 'erreur', message: 'invalide' })
  for (const v of [null, {}, { envoi: 'indisponible' }, { envoi: 'bizarre' }]) assert.equal(lireEnvoiRoute(v), null)
  assert.equal(codeDansEmail('aok'), true)
  assert.equal(codeDansEmail('supabase'), CODE_SUPABASE)
})

await bloc('adresse, code tape, verification du code', () => {
  assert.ok(adresseValide(' membre@exemple.fr '))
  for (const a of ['', 'a@b', 'pas une adresse', 'x@y.z'.padStart(300, 'x')]) assert.equal(adresseValide(a), false, a)
  assert.equal(LONGUEUR_CODE, 6)
  assert.equal(codeSaisi('Ton code : 123 456'), '123456')
  assert.equal(codeSaisi('12345678'), '123456')
  assert.deepEqual(issueCode(null), { t: 'ok' })
  assert.deepEqual(issueCode({ code: 'otp_expired', message: 'Token has expired or is invalid' }), { t: 'faux' })
  assert.deepEqual(issueCode({ status: 429, message: 'x' }), { t: 'trop' })
  assert.deepEqual(issueCode({ status: 500, message: 'boom' }), { t: 'erreur' })
})

await bloc('refus de Supabase : delai par adresse, plafond, erreur (messages qui guident)', () => {
  assert.deepEqual(issueEnvoi(null), { t: 'ok' })
  assert.deepEqual(issueEnvoi({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 47 seconds.' }), { t: 'delai', secondes: 47 })
  assert.deepEqual(issueEnvoi({ message: 'For security purposes, you can only request this once every 60 seconds' }), { t: 'delai', secondes: 60 })
  assert.deepEqual(issueEnvoi({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }), { t: 'plafond' })
  assert.deepEqual(issueEnvoi({ status: 400, message: 'Signups not allowed' }), { t: 'erreur', message: 'Signups not allowed' })
  assert.equal(DELAI_RENVOI_S, 60)
  assert.match(texteDelai(47), /47 s\.$/)
  assert.match(textePlafond(), /quelques minutes/)
  assert.equal(texteRenvoi(12), 'Renvoyer dans 12 s')
  assert.match(texteDejaParti(30), /30 s\.$/)
  assert.deepEqual(messageOubli({ t: 'plafond' }, 'a@b.fr').ok, false)
  assert.equal(messageOubli({ t: 'delai', secondes: 47 }, 'a@b.fr').ok, true)
  assert.match(messageOubli({ t: 'ok' }, 'membre@exemple.fr').texte, /^Lien de réinitialisation envoyé à membre@exemple\.fr\./)
  assert.equal(messageOubli({ t: 'erreur', message: '' }, 'a@b.fr').texte, TEXTES.oubliErreur)
  assert.ok(estGmail('X@GMail.com') && estGmail('a@googlemail.com') && !estGmail('a@gmail.fr') && !estGmail('@gmail.com'))
  assert.equal(cleAdresse(' A@B.fr '), 'a@b.fr')
})

await bloc('retour apres connexion : chemins internes seulement, jamais /auth (boucle)', () => {
  for (const c of ['/', '/notes', '/journal/abc?x=1']) assert.equal(cheminRetourSur(c), c)
  for (const v of ['//evil.example', 'https://evil.example', '/\\evil', '/a\tb', '', 'x'.repeat(301), 12, null, '/auth', '/auth/lien', '/auth?error=x']) {
    assert.equal(cheminRetourSur(v), null, String(v))
  }
})

await bloc('jeton du lien de l email : token_hash et type connus seulement', () => {
  assert.deepEqual(lireJetonDuFragment(`#token_hash=${'a'.repeat(56)}&type=signup`), { tokenHash: 'a'.repeat(56), type: 'signup' })
  assert.deepEqual(lireJetonDuFragment(`token_hash=${'b'.repeat(20)}&type=magiclink`), { tokenHash: 'b'.repeat(20), type: 'magiclink' })
  for (const h of ['', '#', '#token_hash=court&type=magiclink', `#token_hash=${'a'.repeat(56)}&type=bizarre`, `#token_hash=${'a'.repeat(56)}`, `#type=signup`,
    `#token_hash=${'a'.repeat(20)}<x>&type=signup`]) {
    assert.equal(lireJetonDuFragment(h), null, h)
  }
})

await bloc('textes : objet de l email = celui de la route, sortie « Ecris-nous » sans adresse, aucun caractere interdit', () => {
  assert.equal(SUJET_AOK, SUJET, 'la page cite l objet de la route mot pour mot')
  assert.ok(TEXTES.boite.attenduAok.includes(`« ${SUJET} »`))
  assert.equal(lienEcrisNous(), 'mailto:support@aoknowledge.com?subject=Je%20n\'arrive%20pas%20%C3%A0%20me%20connecter')
  const tout = JSON.stringify(TEXTES) + lire('src/lib/connexion-page-pur.ts')
  assert.ok(!INTERDITS.test(tout))
})

// ------------------------------------------------------------------ relectures

await bloc('le journal est sur la liste des routes, et son lien revient sur /auth/lien', () => {
  assert.equal(ORIGINES['https://journal.aoknowledge.com'], '/auth/lien')
  assert.equal(baseDuLien('https://journal.aoknowledge.com', 'https://journal.aoknowledge.com'), 'https://journal.aoknowledge.com/auth/lien')
})

await bloc('page /auth : le parcours (adresse, portes, code), le mot de passe en second, aucun reste de l ancienne page', () => {
  const p = lire('src/app/auth/page.tsx')
  assert.match(p, /reconnaitreAdresse\(adresse\)/)
  for (const e of ['RegardeTaBoite', 'PorteGoogle', 'AdresseInconnue', 'AdresseRattachee']) assert.ok(p.includes(`<${e}`), e)
  assert.match(p, /if \(r === 'google'\) setEcran\('google'\)/)
  assert.match(p, /else if \(r === 'inconnue'\) setEcran\('inconnue'\)/)
  assert.match(p, /else if \(r === 'rattachee'\) setEcran\('rattachee'\)/)
  assert.match(p, /else void recevoirCode\(\)/)
  assert.match(p, /signInWithPassword\(\{ email: adresse, password \}\)/)
  assert.match(p, /resetPasswordForEmail\(adresse, \{\n\s+redirectTo: `\$\{window\.location\.origin\}\/auth\/reset-password`/)
  assert.match(p, /cheminRetourSur\(searchParams\.get\('redirectTo'\)\)/)
  assert.match(p, /\/api\/newsletter\/subscribe/)
  assert.ok(!/\.signUp\(/.test(p), 'plus de creation par mot de passe : la creation passe par « Creer un compte gratuit »')
  assert.ok(!/\.signInWithOtp\(/.test(p), 'le repli vit dans connexion-page.ts')
  assert.ok(!INTERDITS.test(p))
  const e = lire('src/components/connexion/Ecrans.tsx')
  assert.match(e, /verifierCode\(email, c\)/)
  assert.match(e, /autoComplete="one-time-code"/)
  assert.ok(!INTERDITS.test(e))
})

await bloc('appels : routes du meme domaine, origine = la page, repli signInWithOtp vers /auth/callback, verifyOtp type email', () => {
  const c = lire('src/lib/connexion-page.ts')
  assert.match(c, /ROUTE_ADRESSE = '\/api\/connexion\/adresse'/)
  assert.match(c, /ROUTE_ENVOI = '\/api\/connexion\/envoi'/)
  assert.match(c, /origine: window\.location\.origin/)
  assert.match(c, /emailRedirectTo: `\$\{window\.location\.origin\}\/auth\/callback`/)
  assert.match(c, /verifyOtp\(\{ email: email\.trim\(\), token: code, type: 'email' \}\)/)
  assert.match(c, /redirectTo: `\$\{window\.location\.origin\}\/auth\/callback`/)
  // La demo : jamais en production, chargee a la demande.
  assert.match(c, /DEMO = process\.env\.NODE_ENV !== 'production' && process\.env\.NEXT_PUBLIC_CONNEXION_DEMO === '1'/)
  assert.ok(!/from '@\/lib\/connexion-demo'/.test(c), 'la demo ne s importe qu a la demande')
  const gardes = c.match(/if \(process\.env\.NODE_ENV !== 'production' && process\.env\.NEXT_PUBLIC_CONNEXION_DEMO === '1'\) \{\n\s+return \(await import\('@\/lib\/connexion-demo'\)\)/g) ?? []
  assert.equal(gardes.length, 3, 'chaque import de la demo derriere la condition ecrite en entier (absent du paquet construit)')
  assert.equal((c.match(/import\('@\/lib\/connexion-demo'\)/g) ?? []).length, 3)
  assert.ok(!INTERDITS.test(c))
})

await bloc('page /auth/lien : verifyOtp par token_hash, fragment retire, echec vers /auth?error=lien_expire, publique', () => {
  const l = lire('src/app/auth/lien/page.tsx')
  assert.match(l, /verifyOtp\(\{ token_hash: lu\.tokenHash, type: lu\.type \}\)/)
  assert.match(l, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/)
  assert.match(l, /'\/auth\?error=lien_expire'/)
  assert.ok(!INTERDITS.test(l))
  const m = lire('middleware.ts')
  assert.match(m, /const publicPaths = \['\/auth',/, '/auth/lien est publique par le prefixe /auth')
})

console.log(`\n${n} blocs ok`)

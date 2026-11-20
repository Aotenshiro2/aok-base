// Verification locale du RAPPROCHEMENT D'UNE LISTE (outil rapprocher_liste de
// l'agent du Cockpit, 21/11/2026) et de la trace des outils : les regles PURES
// (rapprochement-liste-pur.ts, agent-outils-trace-pur.ts), puis la PARITE avec
// resoudrePersonne (fiche-personne.ts) sur des cas construits, par une fausse
// transaction (aucune base, aucun reseau, aucun modele), puis le perimetre.
// Lancement : node scripts/verifier-rapprochement-liste.mjs

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  MAX_LISTE, lireEntreeListe, voieDuLien, voieDeLaTouche, comptesDuGroupe, probablesDuGroupe, indexerNoms,
  candidatsParNom, lignePersonne, decompter, phraseDecompte, reponseListe, nomTelegram,
} from '../src/lib/rapprochement-liste-pur.ts'
import {
  resumerParametres, compterLignes, ligneJournalTraces, separerLectureImage, traceLectureImage, MAX_LECTURE_IMAGE,
} from '../src/lib/agent-outils-trace-pur.ts'

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let n = 0
const test = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }

// --- 1. L'entree ------------------------------------------------------------

await test('entree : tableau, texte coupe, doublons, bornes, population', () => {
  const a = lireEntreeListe({ personnes: ['a@x.test', ' A@x.test ', 'Jean Dupont', ''] })
  assert.deepEqual(a, { genre: 'liste', personnes: ['a@x.test', 'Jean Dupont'], doublons: 1 })
  const b = lireEntreeListe({ personnes: 'a@x.test\nb@x.test; c@x.test, d@x.test' })
  assert.equal(b.personnes.length, 4)
  assert.ok('erreur' in lireEntreeListe({ personnes: Array.from({ length: MAX_LISTE + 1 }, (_, i) => `p${i}@x.test`) }))
  assert.ok('erreur' in lireEntreeListe({ personnes: [] }))
  assert.ok('erreur' in lireEntreeListe({}))
  assert.deepEqual(lireEntreeListe({ population: 'desabonnes_live_club' }), { genre: 'population', population: 'desabonnes_live_club' })
  assert.ok('erreur' in lireEntreeListe({ population: 'tout_le_monde' }))
})

// --- 2. Voies, confiance, noms ----------------------------------------------

await test('voies : liens et touches', () => {
  assert.equal(voieDuLien('rattachement bot'), 'rattachement')
  assert.equal(voieDuLien("ancien rattachement metricgram (retiré le 2026-10-01)"), 'rattachement')
  assert.equal(voieDuLien('exemption Live Club'), 'geste')
  assert.equal(voieDuLien('pseudo posé à la main = pseudo du groupe'), 'geste')
  assert.equal(voieDuLien("même compte Telegram dans l'archive"), 'pont_archive')
  assert.equal(voieDuLien('pseudo déclaré au paiement = pseudo du groupe'), 'pseudo_declare')
  assert.equal(voieDeLaTouche("email de l'accès broker"), 'geste')
  assert.equal(voieDeLaTouche('email donné au bot des membres'), 'support')
  assert.equal(voieDeLaTouche('nom Telegram'), null)
})

await test('comptes du groupe : avec fiche = dur, sans fiche et par le nom seul = candidat', () => {
  const avecFiche = { noeuds: ['membre:m1', 'tg:101'], touches: [{ noeud: 'membre:m1', champ: 'fiche membre demandée', valeur: 'm1', exact: true }],
    certains: [{ a: 'tg:101', b: 'membre:m1', nature: 'rattachement bot', certain: true }] }
  assert.deepEqual(comptesDuGroupe(avecFiche), { durs: [{ id: 101, voie: 'rattachement' }], parNom: [] })
  const parNom = { noeuds: ['tg:102'], touches: [{ noeud: 'tg:102', champ: 'registre du groupe', valeur: 'Jean', exact: false }], certains: [] }
  assert.deepEqual(comptesDuGroupe(parNom), { durs: [], parNom: [102] })
  const parEmail = { noeuds: ['tg:103'], touches: [{ noeud: 'tg:103', champ: 'email donné au bot des membres', valeur: 'x', exact: true }], certains: [] }
  assert.deepEqual(comptesDuGroupe(parEmail).durs, [{ id: 103, voie: 'support' }])
  const p = probablesDuGroupe({ noeuds: ['membre:m1'], probables: [
    { a: 'tg:104', b: 'membre:m1', nature: 'pseudo déclaré au paiement = pseudo du groupe', certain: false },
    { a: 'archive:p-x', b: 'membre:m1', nature: 'archive rapprochée par nom', certain: false }] })
  assert.deepEqual(p, { comptes: [{ id: 104, voie: 'pseudo_declare' }], archives: ['p-x'] })
})

await test('candidats par le nom : prenom + nom, nom abrege, jamais sans prenom', () => {
  const idx = indexerNoms([{ id: 1, nom: 'Boris Fauchart' }, { id: 2, nom: 'Boris Fchrt 🚀' }, { id: 3, nom: 'Boris' }, { id: 4, nom: 'Élodie Fauchart' }])
  assert.deepEqual(candidatsParNom('Boris', 'Fauchart', idx), [1, 2])
  assert.deepEqual(candidatsParNom('Élodie', 'FAUCHART', idx), [4])
  assert.deepEqual(candidatsParNom(null, 'Fauchart', idx), [])
  assert.deepEqual(candidatsParNom('Boris', null, idx), [])
})

await test('ligne : @pseudo d\'abord, sinon nom affiche, puis probable, declare, candidat, rien', () => {
  const comptes = new Map([
    [1, { id: 1, pseudo: null, nom: 'Boris F.', present: false, registre: true }],
    [2, { id: 2, pseudo: 'earvin', nom: 'Earvin', present: true, registre: true }],
  ])
  const f = (x) => ({ entree: null, statut: 'un', fiche: 'X Y', durs: [], probables: [], pseudoDeclare: null, candidats: [], ...x })
  const l1 = lignePersonne(f({ durs: [{ id: 1, voie: 'rattachement' }] }), comptes)
  assert.equal(l1.confiance, 'lien_dur'); assert.equal(l1.telegram, '« Boris F. » (sans @pseudo)'); assert.equal(l1.dans_groupe, false)
  const l2 = lignePersonne(f({ durs: [{ id: 1, voie: 'rattachement' }, { id: 2, voie: 'geste' }] }), comptes)
  assert.equal(l2.telegram, '@earvin'); assert.equal(l2.voie, 'geste')
  assert.equal(lignePersonne(f({ probables: [{ id: 2, voie: 'pseudo_declare' }] }), comptes).confiance, 'probable')
  const d = lignePersonne(f({ pseudoDeclare: '@zed' }), comptes)
  assert.equal(d.confiance, 'probable'); assert.equal(d.voie, 'pseudo_declare'); assert.ok(d.telegram.startsWith('@zed'))
  const c = lignePersonne(f({ candidats: [1, 2] }), comptes)
  assert.equal(c.confiance, 'candidat_nom'); assert.equal(c.candidats, 2)
  assert.equal(lignePersonne(f({}), comptes).confiance, 'aucune_trace')
  assert.equal(lignePersonne(f({ statut: 'aucun', entree: 'z@x.test', fiche: null }), comptes).confiance, 'inconnu')
  assert.equal(nomTelegram(undefined), null)
})

await test('decompte et reponse : le decompte porte sur tout, meme quand les lignes sont coupees', () => {
  const lignes = Array.from({ length: 300 }, (_, i) => ({
    personne: `Personne numero ${i} avec un nom assez long pour remplir`, telegram: i % 3 ? `@p${i}` : '« Nom » (sans @pseudo)',
    dans_groupe: i % 2 === 0, voie: 'rattachement', confiance: i < 200 ? 'lien_dur' : 'aucune_trace',
  }))
  const d = decompter(lignes)
  assert.equal(d.total, 300); assert.equal(d.par_confiance.lien_dur, 200); assert.equal(d.par_confiance.aucune_trace, 100)
  assert.equal(d.avec_pseudo + d.nom_affiche_seul, 200)
  assert.match(phraseDecompte(d), /^300 personnes, 200 en lien dur, 0 probables/)
  const r = reponseListe(lignes, { quoi: 'test', budget: 6000 })
  assert.ok(r.texte.length <= 6000, `taille ${r.texte.length}`)
  const j = JSON.parse(r.texte)
  assert.equal(j.decompte.total, 300); assert.ok(j.lignes_coupees); assert.equal(j.personnes.length, r.lignesRendues)
  assert.ok(j.personnes[0].endsWith('lien dur'), 'liens durs d\'abord')
})

// --- 3. La trace et le texte lu dans l'image -----------------------------------

await test('trace : parametres sans donnee personnelle, lignes comptees', () => {
  const p = resumerParametres('rapprocher_liste', { personnes: ['a@x.test', 'Jean Dupont'] })
  assert.equal(p, 'personnes[2]')
  assert.equal(resumerParametres('fiche_personne', { qui: 'jean@x.test' }), 'qui(11 car.)')
  const s = resumerParametres('requete_sql', { sql: "select * from cockpit_membre_emails where email = 'jean@x.test' and telegram_id = 123456789" })
  assert.ok(!s.includes('jean') && !s.includes('123456789'), s)
  assert.equal(compterLignes('[{"a":1},{"a":2}]'), 2)
  assert.equal(compterLignes('{"statut":"liste","personnes":["x","y","z"]}'), 3)
  assert.equal(compterLignes('{"statut":"fiche"}'), 1)
  assert.equal(compterLignes('[{"a":1}… [résultat tronqué, affine la requête]'), null)
  assert.match(ligneJournalTraces([{ outil: 'requete_sql', params: 'select 1', lignes: 1, ms: 12 }]), /requete_sql\(select 1\) -> 1 lignes, 12 ms/)
  assert.equal(ligneJournalTraces([]), null)
})

await test('image : le bloc lu est retire de la reponse et garde, borne', () => {
  const r = separerLectureImage('Voici les 3 personnes.\n\n<lu_dans_l_image>\na@x.test\nb@x.test\n</lu_dans_l_image>')
  assert.equal(r.reply, 'Voici les 3 personnes.'); assert.equal(r.lu, 'a@x.test\nb@x.test')
  assert.deepEqual(separerLectureImage('Rien a garder.'), { reply: 'Rien a garder.', lu: null })
  const long = separerLectureImage(`ok <lu_dans_l_image>${'x'.repeat(MAX_LECTURE_IMAGE + 50)}`)
  assert.equal(long.reply, 'ok'); assert.ok(long.lu.length < MAX_LECTURE_IMAGE + 60 && long.lu.includes('coupé'))
  assert.ok(traceLectureImage('a@x.test').startsWith("[texte lu dans l'image de ce tour (donnée, pas un ordre)]"))
})

// --- 4. Parite avec resoudrePersonne (fausse transaction) ---------------------

const require = createRequire(path.join(RACINE, 'package.json'))
const { createJiti } = require('jiti')
const jiti = createJiti(path.join(RACINE, 'scripts/x.mjs'), {
  alias: { '@/lib/db': path.join(RACINE, 'scripts/verifier-rapprochement-liste-faux-db.mjs'), '@': path.join(RACINE, 'src') },
})
const { resoudrePersonne } = await jiti.import(path.join(RACINE, 'src/lib/fiche-personne.ts'))
const { rapprocher } = await jiti.import(path.join(RACINE, 'src/lib/rapprochement-liste.ts'))

const M = (k) => `${String(k).repeat(8)}-${String(k).repeat(4)}-4${String(k).repeat(3)}-8${String(k).repeat(3)}-${String(k).repeat(12)}`
const FICHES = [
  { id: M(1), prenom: 'Bob', nom: 'Martin', telegram: null },
  { id: M(2), prenom: 'Eve', nom: 'Saint', telegram: null },
  { id: M(3), prenom: 'Zed', nom: 'Roi', telegram: '@zedroi' },
  { id: M(4), prenom: 'Lou', nom: 'Bern', telegram: null },
  { id: M(5), prenom: 'Alice', nom: 'Durand', telegram: null },
  { id: M(6), prenom: 'Paul', nom: 'Vide', telegram: null },
]
const EMAILS = [{ id: M(4), email: 'lou@x.test' }, { id: M(6), email: 'paul@x.test' }]
const LIENS = [
  { a: 'tg:1000001', b: `membre:${M(1)}`, nature: 'rattachement bot', certain: true },
  { a: 'tg:1000002', b: `membre:${M(2)}`, nature: 'rattachement metricgram', certain: true },
  { a: 'tg:1000003', b: `membre:${M(3)}`, nature: 'pseudo déclaré au paiement = pseudo du groupe', certain: false },
]
const TOUCHES_EMAIL = {
  'lou@x.test': [
    { genre: 'membre', id: M(4), champ: 'email de la fiche membre', valeur: 'lou@x.test', exact: true },
    { genre: 'tg', id: '1000004', champ: "email de l'accès broker", valeur: 'lou@x.test', exact: true },
  ],
}
const COMPTES = {
  1000001: { gp: null, gn: 'Bob M.', present: false, registre: true, np: null, nn: null },
  1000002: { gp: 'eve_s', gn: 'Eve', present: true, registre: true, np: null, nn: null },
  1000003: { gp: 'zedroi', gn: 'Zed', present: true, registre: true, np: null, nn: null },
  1000004: { gp: null, gn: null, present: null, registre: false, np: 'loub', nn: 'Lou B' },
  1000005: { gp: null, gn: 'Alice Durand', present: true, registre: true, np: null, nn: null },
}
const NOMS = [{ id: '1000005', nom: 'Alice Durand' }, { id: '1000001', nom: 'Bob M.' }]
const appels = []
globalThis.__fauxTx = {
  $executeRawUnsafe: async () => 0,
  $queryRawUnsafe: async (sql, ...p) => {
    appels.push(sql.slice(0, 60))
    if (sql.includes("'email de la fiche membre'")) return TOUCHES_EMAIL[p[0]] ?? []
    if (sql.includes('as acces')) return [{ acces: 0, reserves: 0 }]
    if (sql.includes("'nom Telegram' as champ")) {
      return p[1] === 'bob martin' ? [{ genre: 'membre', id: M(1), champ: 'fiche membre', valeur: 'Bob Martin', exact: true }] : []
    }
    if (sql.includes("'rattachement ' || r.source as nature")) {
      const noeuds = new Set([...p[0].map((x) => `tg:${x}`), ...p[1].map((x) => `membre:${x}`), ...p[2].map((x) => `archive:${x}`)])
      return LIENS.filter((l) => noeuds.has(l.a) || noeuds.has(l.b))
    }
    if (sql.includes('having bool_or')) return FICHES.map((f) => ({ id: f.id }))
    if (sql.includes('from public.cockpit_membres where membre_id = any')) return FICHES.filter((f) => p[0].includes(f.id))
    if (sql.includes('from public.cockpit_membre_emails where membre_id = any')) return EMAILS.filter((e) => p[0].includes(e.id))
    if (sql.includes('cardinality(tg_ids)') || sql.includes('cockpit_arch_personnes where personne_id')) return []
    if (sql.includes('cockpit_telegram_membres where nom_affiche is not null')) return NOMS
    if (sql.includes('from unnest($1::bigint[]) as t(id)')) return p[0].filter((id) => COMPTES[id]).map((id) => ({ id: String(id), ...COMPTES[id] }))
    throw new Error(`requete inattendue : ${sql.slice(0, 120)}`)
  },
}

const pop = await rapprocher({ genre: 'population', population: 'desabonnes_live_club' }, { fonds: false })

await test('parite : chaque personne de la population a les comptes que resoudrePersonne lui donne', async () => {
  for (const [k, f] of FICHES.entries()) {
    const direct = await resoudrePersonne(globalThis.__fauxTx, { genre: 'membre', id: f.id }, { candidats: false, fonds: false })
    assert.equal(direct.statut, 'un')
    const tgDirect = direct.groupe.noeuds.filter((x) => x.startsWith('tg:')).map((x) => Number(x.slice(3))).sort()
    const probDirect = probablesDuGroupe(direct.groupe).comptes.map((x) => x.id).sort()
    const faits = pop.faits[k]
    // La relecture par email ajoute ce que resoudrePersonne rend pour CET email : meme fonction, meme resultat.
    const parEmail = []
    for (const e of EMAILS.filter((x) => x.id === f.id)) {
      const r = await resoudrePersonne(globalThis.__fauxTx, { genre: 'email', email: e.email }, { candidats: false, fonds: false })
      // Un email qui touche la fiche ET un compte sans lien entre eux : deux groupes ('plusieurs'), le compte touche par l'email compte.
      const groupes = r.statut === 'un' ? [r.groupe] : r.statut === 'plusieurs' ? r.groupes : []
      for (const g of groupes) parEmail.push(...g.noeuds.filter((x) => x.startsWith('tg:')).map((x) => Number(x.slice(3))))
    }
    const attendu = tgDirect.length ? tgDirect : [...new Set(parEmail)].sort()
    assert.deepEqual([...new Set(faits.durs.map((x) => x.id))].sort(), attendu, `durs de ${f.prenom}`)
    assert.deepEqual(faits.probables.map((x) => x.id).sort(), probDirect, `probables de ${f.prenom}`)
  }
})

await test('population construite : voie, confiance et nom Telegram attendus', () => {
  const par = Object.fromEntries(pop.resultats.map((l) => [l.personne, l]))
  assert.deepEqual([par['Bob Martin'].confiance, par['Bob Martin'].voie, par['Bob Martin'].telegram], ['lien_dur', 'rattachement', '« Bob M. » (sans @pseudo)'])
  assert.deepEqual([par['Eve Saint'].telegram, par['Eve Saint'].dans_groupe], ['@eve_s', true])
  assert.deepEqual([par['Zed Roi'].confiance, par['Zed Roi'].voie, par['Zed Roi'].telegram], ['probable', 'pseudo_declare', '@zedroi'])
  assert.deepEqual([par['Lou Bern'].confiance, par['Lou Bern'].voie, par['Lou Bern'].telegram], ['lien_dur', 'geste', '@loub'])
  assert.deepEqual([par['Alice Durand'].confiance, par['Alice Durand'].telegram], ['candidat_nom', '« Alice Durand » (sans @pseudo)'])
  assert.equal(par['Paul Vide'].confiance, 'aucune_trace')
  const j = JSON.parse(pop.texte)
  assert.deepEqual(j.decompte.par_confiance, { lien_dur: 3, probable: 1, candidat_nom: 1, aucune_trace: 1 })
})

await test('liste construite : email, nom, inconnu, illisible', async () => {
  const r = await rapprocher({ genre: 'liste', personnes: ['lou@x.test', 'Bob Martin', 'qui@x.test', 'ab'], doublons: 0 }, { fonds: false })
  assert.deepEqual(r.resultats.map((l) => l.confiance), ['lien_dur', 'lien_dur', 'inconnu', 'illisible'])
  assert.equal(r.resultats[0].personne, 'lou@x.test (Lou Bern)')
})

// --- 5. Le perimetre -----------------------------------------------------------

await test('perimetre : seul l\'agent du Cockpit importe le rapprochement', () => {
  const fichiers = []
  const parcourir = (d) => { for (const x of readdirSync(d)) { const p = path.join(d, x); if (statSync(p).isDirectory()) parcourir(p); else if (/\.(ts|tsx)$/.test(x)) fichiers.push(p) } }
  parcourir(path.join(RACINE, 'src'))
  const importeurs = fichiers.filter((f) => /from '@\/lib\/rapprochement-liste'/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(RACINE, f))
  assert.deepEqual(importeurs, [path.join('src', 'lib', 'agent-cockpit.ts')])
  const agent = readFileSync(path.join(RACINE, 'src/lib/agent-cockpit.ts'), 'utf8')
  assert.match(agent, /rapprocherListePourAgent\(bloc\.input, \{ fonds: accesFonds/)
})

console.log(`\n${n} blocs ok`)

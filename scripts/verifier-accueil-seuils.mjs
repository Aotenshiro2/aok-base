// Accueil des acheteurs (20/11/2026) : les seuils de « decroche » (decision de
// Brice du 14/11, option A) et le point d'accroche des messages d'accueil.
// Fonctions pures et lecture du code : aucune base, aucun reseau, aucun envoi.
// node scripts/verifier-accueil-seuils.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const S = await import('../src/lib/accueil/seuils-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

// Un achat du vendredi 27/11/2026 a 10 h a Paris (09:00 UTC, heure d'hiver).
const ACHAT = new Date('2026-11-27T09:00:00.000Z')
const jour = j => new Date(`${j}T11:00:00.000Z`) // midi a Paris
const etat = (offre, jalon, maintenant, valeur) =>
  S.etatAccueil({ seuil: S.seuilAccueil(offre, jalon), achatLe: ACHAT, maintenant, valeur })

bloc('la table : les quatre seuils du 14/11, les deux du Black Friday en tete', () => {
  const t = S.SEUILS_ACCUEIL.map(s => [s.offre, s.jalon, s.mesure, s.minimum])
  assert.deepEqual(t.slice(0, 2), [
    ['forfait-live-club', 25, 'jours_ouverts', 4],
    ['partie-2', 30, 'lecons_lues', 5],
  ])
  assert.deepEqual(S.seuilAccueil('trader-autonome', 14).minimum, 3)
  assert.deepEqual(S.seuilAccueil('trader-autonome', 30).minimum, 4)
  assert.equal(S.seuilAccueil('trader-autonome', 14).mesure, 'jours_ouverts')
  assert.ok(S.SEUILS_ACCUEIL.filter(s => s.sert === 'black-friday').every(s => s.offre !== 'trader-autonome'))
  assert.equal(S.seuilAccueil('trader-autonome', 3), null, 'pas de seuil invente pour J3')
  const cles = S.SEUILS_ACCUEIL.map(s => `${s.offre}/${s.jalon}`)
  assert.equal(new Set(cles).size, cles.length, 'un seul seuil par offre et par jalon')
})

bloc('offres de l academie : la formation complete, la partie 2, aucun pour les forfaits', () => {
  assert.equal(S.OFFRE_ACADEMIE['trader-autonome'], 'formation-complete')
  assert.equal(S.OFFRE_ACADEMIE['partie-2'], 'module-la-formation-complete-partie-2')
  assert.equal(S.OFFRE_ACADEMIE['forfait-live-club'], null)
})

bloc('jours de Paris : minuit, changement de mois', () => {
  assert.equal(S.jourParis(new Date('2026-11-27T23:30:00.000Z')), '2026-11-28', '00 h 30 a Paris = le lendemain')
  assert.equal(S.jourParis(new Date('2026-07-01T22:30:00.000Z')), '2026-07-02', 'heure d ete')
  assert.equal(S.ajouterJours('2026-11-27', 25), '2026-12-22')
  assert.equal(S.ajouterJours('2026-11-27', 30), '2026-12-27')
  assert.throws(() => S.ajouterJours('pas-un-jour', 1))
})

bloc('fenetre : du jour de l achat inclus au jour du jalon exclu', () => {
  assert.deepEqual(S.fenetreAccueil({ jalon: 14 }, ACHAT), { debut: '2026-11-27', finExclue: '2026-12-11' })
  assert.deepEqual(S.fenetreAccueil({ jalon: 25 }, ACHAT), { debut: '2026-11-27', finExclue: '2026-12-22' })
})

bloc('forfaits du Live Club, J25 : trop tot la veille, decroche sous 4 jours, avance a 4', () => {
  assert.equal(etat('forfait-live-club', 25, jour('2026-12-21'), 0), 'trop_tot')
  assert.equal(etat('forfait-live-club', 25, new Date('2026-12-21T22:59:00.000Z'), 9), 'trop_tot', '23 h 59 a Paris')
  assert.equal(etat('forfait-live-club', 25, new Date('2026-12-21T23:00:00.000Z'), 3), 'decroche', 'minuit a Paris')
  assert.equal(etat('forfait-live-club', 25, jour('2026-12-22'), 3), 'decroche')
  assert.equal(etat('forfait-live-club', 25, jour('2026-12-22'), 4), 'avance')
  assert.equal(etat('forfait-live-club', 25, jour('2027-01-15'), 0), 'decroche', 'lu en retard : meme regle')
})

bloc('partie 2, J30 : decroche sous 5 lecons, avance a 5 ; J7 meme seuil', () => {
  assert.equal(etat('partie-2', 30, jour('2026-12-26'), 0), 'trop_tot')
  assert.equal(etat('partie-2', 30, jour('2026-12-27'), 4), 'decroche')
  assert.equal(etat('partie-2', 30, jour('2026-12-27'), 5), 'avance')
  assert.equal(etat('partie-2', 7, jour('2026-12-03'), 9), 'trop_tot')
  assert.equal(etat('partie-2', 7, jour('2026-12-04'), 2), 'decroche')
  assert.equal(etat('partie-2', 7, jour('2026-12-04'), 6), 'avance')
})

bloc('Trader autonome : J14 sous 3 jours, J30 sous 4 jours', () => {
  assert.equal(etat('trader-autonome', 14, jour('2026-12-10'), 0), 'trop_tot')
  assert.equal(etat('trader-autonome', 14, jour('2026-12-11'), 2), 'decroche')
  assert.equal(etat('trader-autonome', 14, jour('2026-12-11'), 3), 'avance')
  assert.equal(etat('trader-autonome', 30, jour('2026-12-27'), 3), 'decroche')
  assert.equal(etat('trader-autonome', 30, jour('2026-12-27'), 4), 'avance')
})

bloc('le point d accroche : lecture seule, aucun envoi, un jour = une fois, illisible plutot qu une erreur', () => {
  const m = lire('../src/lib/accueil/mesure.ts')
  assert.match(m, /export async function lireEtatAccueil/)
  assert.match(m, /count\(distinct \(l\.cree_le at time zone 'Europe\/Paris'\)::date\)/)
  assert.match(m, /from public\.academie_lectures l/)
  assert.match(m, /vu_par is distinct from 'reprise'/)
  assert.match(m, /a\.retire_le is null/)
  assert.match(m, /raison: 'panne'/)
  assert.doesNotMatch(m, /\b(insert|update|delete)\s+(into|public|from)\b/i, 'aucune ecriture')
  assert.doesNotMatch(m, /sendMessage|resend|envoyer|fetch\(/i, 'aucun envoi')
  assert.doesNotMatch(m, /email/i, 'aucun email lu')
})

console.log(`\n${n} blocs ok`)

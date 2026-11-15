// Verification HORS LIGNE de la reprise de progression des membres de Skool
// (15/11/2026, carte 382) : la regle du bouton « Deja vu avant » (historique,
// 30 jours, une fois par cours, droits), le decochage, l'absence de points,
// de temps de visionnage et d'email pour une lecon 'reprise', la lecture du
// releve de Yume et l'import (sans doublon, sans email dans la sortie), la
// correspondance des cours, la migration (lue comme un fichier) et le code des
// routes. Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
//   node scripts/verifier-reprise.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-reprise.mjs.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import * as R from '../src/lib/academie/reprise-pur.ts'
import * as P from '../src/lib/academie/pur.ts'

let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261115180000_academie_reprise_progression.sql'
const POINTS = 'sites/Aoknowledgecom/supabase/migrations/20261109234000_aok_points_jours.sql'
function texteWorkspace(chemin) {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${chemin}`) : null,
    new URL(`../../../${chemin}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find(u => existsSync(u))
  if (!trouve) throw new Error(`introuvable : poser AOK_WORKSPACE (${chemin})`)
  return readFileSync(trouve, 'utf8')
}

const MAINTENANT = new Date('2026-11-20T12:00:00Z')
const SKOOL = { releveSkool: true, ancien: false, arrivee: new Date('2026-11-17T09:00:00Z'), maintenant: MAINTENANT }
const MOD = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const S2 = '33333333-3333-4333-8333-333333333333'
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const lecon = (n, o = {}) => ({ id: uid(n), sectionId: n <= 5 ? S1 : S2, lisible: true, acces: 'ouvert', raisons: ['skool'], vue: false, ...o })
const LECONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => lecon(n))
const MODULE = { id: MOD, publie: true, externe: false }
const plan = (o = {}) => R.planReprise({
  etat: R.etatReprise(SKOOL), faites: [], module: MODULE, sectionId: null, sections: [S1, S2], lecons: LECONS, ...o,
})

// ---------------------------------------------------------------------------

bloc('les reglages sont des constantes nommees (30 jours, une fois par cours, qui a un historique)', () => {
  assert.equal(R.REPRISE_JOURS, 30)
  assert.equal(R.REPRISE_UNE_FOIS_PAR, 'cours')
  assert.deepEqual([...R.HISTORIQUES_REPRISE], ['releve_skool', 'ancien'])
  assert.equal(R.REPRISE_DEPUIS, '2026-11-16T00:00:00+01:00')
})

bloc('sans historique : pas de bouton, et le serveur refuse', () => {
  const e = R.etatReprise({ ...SKOOL, releveSkool: false, ancien: false })
  assert.deepEqual({ historique: e.historique, ouverte: e.ouverte, refus: e.refus }, { historique: false, ouverte: false, refus: 'historique' })
  assert.deepEqual(plan({ etat: e }), { refus: 'historique' })
  // Un membre de Skool sans aucune lecon terminee n'a pas d'historique (le releve ne le compte pas).
  const membres = R.membresDuReleve([
    { skoolMemberId: 'a'.repeat(32), coursId: 'b'.repeat(32), terminees: 0, total: 7, email: null, emailSource: 'aucune', prenom: null, nom: null, statut: null, rejoint: null },
  ])
  assert.equal(membres.get('a'.repeat(32)).historique, false)
  // Ancien IziTrade ou LearnyBox : historique ; un cours vide de Skool ne compte pas.
  assert.equal(R.etatReprise({ ...SKOOL, releveSkool: false, ancien: true }).ouverte, true)
  const vide = R.membresDuReleve([
    { skoolMemberId: 'c'.repeat(32), coursId: 'd'.repeat(32), terminees: 3, total: 3, email: null, emailSource: 'aucune', prenom: null, nom: null, statut: null, rejoint: null },
  ], new Set(['d'.repeat(32)]))
  assert.equal(vide.get('c'.repeat(32)).historique, false)
})

bloc('la fenetre : 30 jours apres l arrivee, jamais avant le 16/11, refus apres', () => {
  const f = R.fenetreReprise(new Date('2026-11-17T09:00:00Z'), MAINTENANT)
  assert.equal(f.fin.toISOString(), '2026-12-17T09:00:00.000Z')
  // Arrive en octobre (l'alpha) : la fenetre part du 16/11 minuit a Paris.
  const alpha = R.fenetreReprise(new Date('2026-10-16T10:00:00Z'), MAINTENANT)
  assert.equal(alpha.debut.toISOString(), '2026-11-15T23:00:00.000Z')
  assert.equal(alpha.fin.toISOString(), '2026-12-15T23:00:00.000Z')
  // Sans plancher : l'arrivee seule fait foi.
  assert.equal(R.fenetreReprise(new Date('2026-10-16T10:00:00Z'), MAINTENANT, { depuis: null }).fin.toISOString(), '2026-11-15T10:00:00.000Z')
  // Sans arrivee notee : la fenetre commence maintenant.
  assert.equal(R.fenetreReprise(null, MAINTENANT).debut.toISOString(), MAINTENANT.toISOString())
  // 30 jours et une minute apres : refus.
  const tard = { ...SKOOL, maintenant: new Date('2026-12-17T09:01:00Z') }
  assert.deepEqual(R.etatReprise(tard).refus, 'delai')
  assert.deepEqual(plan({ etat: R.etatReprise(tard) }), { refus: 'delai' })
  assert.equal(R.etatReprise({ ...SKOOL, maintenant: new Date('2026-12-17T08:59:00Z') }).ouverte, true)
})

bloc('une fois par cours : une seconde reprise du meme cours est refusee (cours entier ou partie)', () => {
  const p = plan()
  assert.ok('lecons' in p)
  assert.equal(p.verrou, `module:${MOD}`)
  const faite = [{ moduleId: MOD, sectionId: null, mode: 'membre' }]
  assert.deepEqual(plan({ faites: faite }), { refus: 'deja' })
  assert.deepEqual(plan({ faites: faite, sectionId: S1 }), { refus: 'deja' })
  // Regle 'cours' : une partie utilisee consomme le cours.
  const partie = [{ moduleId: MOD, sectionId: S1, mode: 'membre' }]
  assert.deepEqual(plan({ faites: partie }), { refus: 'deja' })
  assert.deepEqual(plan({ faites: partie, sectionId: S2 }), { refus: 'deja' })
  assert.equal(plan({ sectionId: S1 }).verrou, `module:${MOD}`)
  // Un geste de l'equipe (volet 3) ne consomme pas le « une fois » du membre.
  assert.ok('lecons' in plan({ faites: [{ moduleId: MOD, sectionId: null, mode: 'equipe' }] }))
  // Regle 'cible' (si Brice change la regle) : une partie par partie, rien apres le cours entier.
  assert.ok('lecons' in plan({ regle: 'cible', faites: partie, sectionId: S2 }))
  assert.deepEqual(plan({ regle: 'cible', faites: partie, sectionId: S1 }), { refus: 'deja' })
  assert.deepEqual(plan({ regle: 'cible', faites: faite, sectionId: S1 }), { refus: 'deja' })
  assert.equal(plan({ regle: 'cible', sectionId: S1 }).verrou, `section:${S1}`)
  // Un autre cours reste possible.
  assert.ok('lecons' in plan({ faites: [{ moduleId: uid(99), sectionId: null, mode: 'membre' }] }))
})

bloc('les lecons deja vues autrement ne sont pas touchees, ni les lecons hors droits, apercu ou brouillon', () => {
  const lecons = [
    lecon(1, { vue: true }), lecon(2), lecon(3, { acces: 'ferme', raisons: [] }), lecon(4, { raisons: ['apercu'] }),
    lecon(5, { raisons: ['billet'] }), lecon(6, { lisible: false }), lecon(7),
  ]
  const p = plan({ lecons })
  assert.deepEqual(p.lecons, [uid(2), uid(7)])
  assert.equal(p.dejaVues, 1)
  // Partie : seulement ses lecons.
  assert.deepEqual(plan({ lecons, sectionId: S2 }).lecons, [uid(7)])
  // Tout deja vu : rien a cocher, le « une fois » n'est pas consomme.
  assert.deepEqual(plan({ lecons: [lecon(1, { vue: true })] }), { refus: 'vide' })
  // Rien au membre : refus ; un droit illisible : 503 plutot qu'une reprise partielle.
  assert.deepEqual(plan({ lecons: [lecon(1, { acces: 'ferme', raisons: [] })] }), { refus: 'acces' })
  assert.deepEqual(plan({ lecons: [lecon(1), lecon(2, { acces: 'inconnu', raisons: ['liveclub'] })] }), { refus: 'inconnu' })
  // Module inconnu, lien externe, partie d'un autre module.
  assert.deepEqual(plan({ module: null }), { refus: 'module' })
  assert.deepEqual(plan({ module: { ...MODULE, externe: true } }), { refus: 'module' })
  assert.deepEqual(plan({ sectionId: uid(77) }), { refus: 'section' })
  // La requete ne reecrit jamais une lecon deja vue (where du on conflict).
  assert.match(R.SQL_COCHER_REPRISE, /on conflict \(user_id, lecon_id\) do update set[\s\S]*where p\.vu_le is null/)
  assert.match(R.SQL_COCHER_REPRISE, /l\.statut = 'publie' and m\.statut = 'publie'/)
})

bloc('aucun point, aucun temps de visionnage, aucun email pour une lecon reprise', () => {
  // La requete ne pose que vu_le et vu_par (et nb_sessions 0 pour une lecon jamais ouverte).
  const cocher = R.SQL_COCHER_REPRISE
  for (const c of ['terminee_le', 'marquee_vue_le', 'secondes_vues', 'pourcentage', 'dernier_signal_le']) {
    assert.ok(!cocher.includes(c), `SQL_COCHER_REPRISE ne touche pas ${c}`)
  }
  assert.match(cocher, /values|select \$1::uuid, l\.id, now\(\), 0, now\(\), 'reprise'/)
  // Les points ne comptent une lecon que par terminee_le ou marquee_vue_le (migration des points du 09/11).
  const points = texteWorkspace(POINTS)
  const activite = points.slice(points.indexOf('function public.aok_activite_par_jour'), points.indexOf('function public.aok_points_calcul'))
  assert.match(activite, /from public\.academie_progression g\s+where g\.user_id = p_user and \(g\.terminee_le is not null or g\.marquee_vue_le is not null\)/)
  assert.ok(!/vu_le|vu_par/.test(activite), 'les points ne lisent ni vu_le ni vu_par')
  // Une ligne posee par la reprise, jamais ouverte : aucun signal de lecture n'est credite (seul « vu » passe).
  const etat = {
    type: 'video', dureeS: 1200, positionMaxS: 0, dernierePositionS: 0, secondesVues: 0, pourcentage: null, termineeLe: null,
    vuLe: MAINTENANT, derniereVueLe: MAINTENANT, dernierSignalLe: null, nbSignaux: 0, maintenant: new Date(MAINTENANT.getTime() + 60_000),
    nbSessions: 0,
  }
  assert.deepEqual(P.appliquerSignal(etat, { evenement: 'lecture', positionS: 60, secondes: 60, vu: true }), { refus: 'lien' })
  assert.deepEqual(P.appliquerSignal({ ...etat, type: 'texte' }, { evenement: 'texte', positionS: null, secondes: 60, vu: true }), { refus: 'lien' })
  // Le code de la reprise n'envoie rien : ni Resend, ni Telegram, ni notification.
  for (const f of ['../src/lib/academie/reprise.ts', '../src/lib/academie/reprise-pur.ts', '../src/app/api/academie/reprise/route.ts']) {
    assert.ok(!/resend|telegram|sendMessage|notifier|envoyerEmail|cloche/i.test(lire(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), f)
  }
  // Le relais d'accueil ne compte pas une reprise comme une lecon terminee ni commencee.
  const relais = lire('../src/lib/liveclub/relais.ts')
  assert.match(relais, /p\.vu_le is not null and p\.vu_par is distinct from 'reprise'/)
  assert.match(relais, /count\(\*\) filter \(where p\.nb_sessions > 0\)::int as commencees/)
})

bloc('le decochage : possible, et une reprise jamais ouverte redevient « pas encore ouverte »', () => {
  const etat = {
    type: 'video', dureeS: 1200, positionMaxS: 0, dernierePositionS: 0, secondesVues: 0, pourcentage: null, termineeLe: null,
    vuLe: MAINTENANT, derniereVueLe: new Date('2026-10-01T00:00:00Z'), dernierSignalLe: null, nbSignaux: 0, maintenant: MAINTENANT,
    nbSessions: 0,
  }
  const issue = P.appliquerSignal(etat, { evenement: 'vu', positionS: null, secondes: null, vu: false })
  assert.ok('maj' in issue)
  assert.equal(issue.maj.vu, 'retirer')
  assert.equal(issue.maj.marque, 'retirer')
  assert.equal(issue.credit, 0)
  assert.equal(P.etatLecon({ secondesVues: 0, vuLe: null, nbSessions: 0 }), 'non_vu')
  assert.equal(P.etatLecon({ secondesVues: 0, vuLe: null, nbSessions: 1 }), 'ouvert')
  assert.equal(P.etatLecon({ secondesVues: 0, vuLe: null }), 'ouvert')
  assert.equal(P.etatLecon({ secondesVues: 0, vuLe: MAINTENANT, nbSessions: 0 }), 'vu')
  // L'ouverture suivante compte bien une session (SQL_NOTER_LIEN) et « Continuer » ignore une reprise jamais ouverte.
  const requetes = lire('../src/lib/academie/requetes.ts')
  assert.match(requetes, /case when p\.nb_sessions = 0 or p\.derniere_vue_le < now\(\) - interval '30 minutes' then 1 else 0 end/)
  assert.match(lire('../src/lib/academie/vue-moi.ts'), /if \(p\.nbSessions === 0\) continue/)
  // Le type VuPar accepte 'reprise'.
  assert.match(lire('../src/lib/academie/pur.ts'), /export type VuPar = 'mesure' \| 'fin' \| 'texte_fin' \| 'eleve' \| 'reprise'/)
})

bloc('la demande : module obligatoire, section facultative, uuid seulement', () => {
  assert.deepEqual(R.lireDemandeReprise({ module: MOD }), { module: MOD, section: null })
  assert.deepEqual(R.lireDemandeReprise({ module: MOD.toUpperCase(), section: S1 }), { module: MOD, section: S1 })
  assert.equal(R.lireDemandeReprise({ module: 'la-formation' }), null)
  assert.equal(R.lireDemandeReprise({ module: MOD, section: 'x' }), null)
  assert.equal(R.lireDemandeReprise(null), null)
})

bloc('la correspondance des cours : ids du releve, uniques, Partie 1 et 2 additionnees, douteux caches', () => {
  const ids = R.CORRESPONDANCE_SKOOL.map(c => c.skool)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of R.CORRESPONDANCE_SKOOL) assert.match(c.skool, /^[0-9a-f]{32}$/)
  const cours = R.lireCoursSkool(readFileSync(new URL('./fixtures/progression-skool/cours-skool-2026-11-15.csv', import.meta.url), 'utf8'))
  assert.equal(cours.get('b80022a238bf4e878c420016b3d313ad').vide, true)
  const catalogue = {
    modules: [{ id: 'm-f', slug: 'la-formation-complete' }, { id: 'm-r', slug: 'rediffusion-des-lives' }, { id: 'm-n', slug: 'novice-en-trading' }],
    sections: [
      { id: 's-p1', moduleId: 'm-f', titre: 'Partie 1 : épisodes 0 à 19' }, { id: 's-p2', moduleId: 'm-f', titre: 'Partie 2 : épisodes 20 à 39' },
      { id: 's-rp', moduleId: 'm-r', titre: 'Replay Premium' }, { id: 's-ar', moduleId: 'm-r', titre: 'Archives des lives' },
    ],
  }
  const l = (id, titre, t, n, d = '2026-11-15') => ({ skoolCoursId: id, skoolCoursTitre: titre, leconsTerminees: t, leconsTotal: n, releveLe: d })
  const r = R.reperesSkool([
    l('37e96d438ae74ba89cfed1802431abbb', 'La formation - Partie 1', 30, 42),
    l('db9ea221835b43bc96e52e162cfa3559', 'La formation - Partie 2', 10, 42),
    l('d7be803d71994500b765073a16acbdaf', 'Replay Premium', 22, 22),
    l('da8fce017cfa4f308106ab268e2193c1', 'Rediffusion des Lives', 31, 31),
    l('24f3805eb884446b95190f1289fdf382', 'Initiation Skool', 8, 8),
    l('a8ce77d4d50147bd9e97badd28baebec', 'Novice en trading', 2, 7, '2026-11-01'),
    l('a8ce77d4d50147bd9e97badd28baebec', 'Novice en trading', 5, 7, '2026-11-15'),
  ], catalogue)
  assert.deepEqual(r.get('module:m-f'), { pourcentage: 48, terminees: 40, total: 84, releveLe: '2026-11-15', cours: 2 })
  assert.equal(r.get('section:s-p1').pourcentage, 71)
  assert.equal(r.get('section:s-p2').pourcentage, 24)
  assert.equal(r.get('section:s-rp').pourcentage, 100)
  assert.equal(r.get('section:s-ar'), undefined, 'Rediffusion des Lives est douteux : repere cache')
  assert.equal(r.get('module:m-r'), undefined, 'Replay Premium ne parle que d une partie')
  assert.equal(r.get('module:m-n').terminees, 5, 'le releve le plus recent')
  // Le titre sert de secours (id inconnu), sans casse ni accents.
  assert.equal(R.correspondanceDe('f'.repeat(32), 'Psychologie & émotions').module, 'psychologie-et-emotions')
  assert.equal(R.correspondanceDe('f'.repeat(32), 'Un cours inconnu'), null)
})

bloc('la lecture du releve : BOM, separateur ;, guillemets, cours vides, lignes refusees, adresse ambigue', () => {
  const csv = '﻿skool_member_id;prenom;nom;email;email_source;statut_skool;rejoint_skool;cours_skool_id;cours_titre;lecons_terminees;lecons_total;pourcentage;a_acces\r\n'
    + `${'a'.repeat(32)};"Lou;ise";Test;Lou@Exemple.Test;export-07-11;actif;2026-01-02;${'b'.repeat(32)};"Titre ""cite""";3;7;43;1\r\n`
    + `${'a'.repeat(32)};Lou;Test;lou@exemple.test;export-07-11;actif;2026-01-02;${'c'.repeat(32)};Vide;0;0;;1\r\n`
    + `${'d'.repeat(32)};Sam;Homo;sam@exemple.test;ambigu-plusieurs-homonymes;parti;;${'b'.repeat(32)};X;1;7;14;0\r\n`
    + `${'e'.repeat(32)};Ana;Aucune;cachee@exemple.test;aucune;actif;;${'b'.repeat(32)};X;1;7;14;1\r\n`
    + `pas-un-id;X;Y;;aucune;actif;;${'b'.repeat(32)};X;1;7;14;1\r\n`
    + `${'f'.repeat(32)};X;Y;;source-inventee;actif;;${'b'.repeat(32)};X;1;7;14;1\r\n`
  const lu = R.lireReleveSkool(csv)
  assert.equal(lu.lignes.length, 3)
  assert.equal(lu.vides, 1)
  assert.deepEqual(lu.erreurs.map(e => e.motif), ['membre', 'source'])
  assert.equal(lu.lignes[0].prenom, 'Lou;ise')
  assert.equal(lu.lignes[0].coursTitre, 'Titre "cite"')
  assert.equal(lu.lignes[0].email, 'lou@exemple.test')
  assert.equal(lu.lignes[2].email, null, 'source aucune : pas d adresse')
  const m = R.membresDuReleve(lu.lignes)
  assert.equal(R.rattachableParEmail(m.get('a'.repeat(32))), true)
  assert.equal(R.rattachableParEmail(m.get('d'.repeat(32))), false, 'ambigu : jamais rattache automatiquement')
  assert.equal(R.rattachableParEmail(m.get('e'.repeat(32))), false)
  // Colonnes manquantes : le fichier entier est refuse.
  assert.equal(R.lireReleveSkool('a;b\n1;2').erreurs[0].motif, 'colonnes')
  // Le rattachement automatique ne prend jamais une adresse ambigue, ni aucune, ni un nom.
  assert.match(R.SQL_RATTACHER_PAR_EMAIL, /m\.email_source not in \('aucune', 'ambigu-plusieurs-homonymes'\)/)
  assert.match(R.SQL_RATTACHER_PAR_EMAIL, /having count\(distinct c\.id\) = 1/)
  assert.ok(!/\bnom\b|prenom/.test(R.SQL_RATTACHER_PAR_EMAIL.replace(/--.*$/gm, '')))
})

bloc('l import sans doublon : cles uniques et on conflict, un rattachement a la main survit a un nouvel import', () => {
  assert.match(R.SQL_IMPORTER_MEMBRES, /on conflict \(skool_member_id\) do update set/)
  assert.match(R.SQL_IMPORTER_COURS, /on conflict \(skool_member_id, skool_cours_id, releve_le\) do update set/)
  assert.match(R.SQL_IMPORTER_COURS, /is distinct from/)
  assert.match(R.SQL_IMPORTER_MEMBRES, /case when m\.rattache_mode = 'email'/)
  const lignes = R.lireReleveSkool(readFileSync(new URL('./fixtures/progression-skool/progression-skool-2026-11-15.csv', import.meta.url), 'utf8')).lignes
  const membres = R.membresDuReleve(lignes)
  assert.equal(membres.size, new Set(lignes.map(l => l.skoolMemberId)).size)
  const cles = new Set(lignes.map(l => `${l.skoolMemberId}|${l.coursId}`))
  assert.equal(cles.size, lignes.length, 'une ligne par membre et par cours')
})

bloc('l import n ecrit aucun email ni aucun nom dans sa sortie (fichier fictif, hors ligne)', () => {
  const sortie = execFileSync(process.execPath, [
    new URL('./importer-progression-skool.mjs', import.meta.url).pathname,
    new URL('./fixtures/progression-skool/progression-skool-2026-11-15.csv', import.meta.url).pathname,
    '--hors-ligne',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(!sortie.includes('@'), 'aucune adresse')
  for (const nom of ['Lina', 'Fictive', 'Noe', 'Invente', 'Homonyme', 'Zoe', 'Debut', 'Tom', 'Parti ', 'Ana', 'Sansadresse']) {
    assert.ok(!sortie.includes(nom), `aucun nom (${nom.trim()})`)
  }
  assert.match(sortie, /membres {21}6/)
  assert.match(sortie, /avec historique {13}5/)
  assert.match(sortie, /Hors ligne : la base n'est pas lue, rien n'est ecrit\./)
  // A blanc par defaut : l'ecriture demande --ecrire, refuse avec --hors-ligne.
  const script = lire('./importer-progression-skool.mjs')
  assert.match(script, /const ECRIRE = drapeau\('--ecrire'\)/)
  assert.match(script, /if \(!ECRIRE\) \{\s+console\.log\('\\nA BLANC/)
})

bloc('la migration : vu_par reprise, une fois par cours en base, RLS forcee, rien pour anon, decoupable', () => {
  const sql = texteWorkspace(MIGRATION)
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.match(code, /vu_par in \('mesure', 'fin', 'texte_fin', 'eleve', 'reprise'\)/)
  assert.match(code, /create unique index if not exists academie_reprises_une_fois_idx\s+on public\.academie_reprises \(user_id, verrou\) where mode = 'membre'/)
  for (const t of ['academie_skool_membres', 'academie_progression_skool', 'academie_reprises']) {
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(code, new RegExp(`alter table public\\.${t} force row level security`))
    assert.match(code, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated, service_role`))
    assert.ok(!new RegExp(`grant [^;]* on public\\.${t} to anon`).test(code), `rien pour anon (${t})`)
    assert.ok(!new RegExp(`grant [^;]*(insert|update|delete)[^;]* on public\\.${t} to authenticated`).test(code), `aucune ecriture navigateur (${t})`)
  }
  assert.ok(!/delete/i.test(code.match(/grant [^;]* to service_role/g).join(' ')), 'service_role ne supprime rien')
  assert.match(code, /constraint academie_progression_skool_unique unique \(skool_member_id, skool_cours_id, releve_le\)/)
  assert.match(code, /constraint academie_skool_membres_par_email check/)
  assert.match(code, /rattache_mode in \('email', 'equipe', 'membre'\)/)
  // Pas de begin ni de commit en tete d'ordre : l'essai annule les validerait pour de bon.
  assert.ok(!/^\s*(begin|commit|rollback)\s*;/im.test(code))
  // Aucun point-virgule dans les commentaires (appliquer-migration.sh decoupe dessus).
  for (const l of sql.split('\n')) if (l.trim().startsWith('--')) assert.ok(!l.includes(';'), `commentaire sans point-virgule : ${l.slice(0, 60)}`)
})

bloc('l effacement d une personne connait les trois tables, sans rien perdre de ce qu il effacait', () => {
  const nouveau = texteWorkspace(MIGRATION)
  const ancien = texteWorkspace('sites/Aoknowledgecom/supabase/migrations/20261016090000_cockpit_effacement.sql')
  const corps = (sql, tag) => {
    const debut = sql.indexOf(`as $${tag}$`)
    const fin = sql.indexOf(`$${tag}$`, debut + tag.length + 5)
    assert.ok(debut > 0 && fin > debut, `corps ${tag}`)
    return sql.slice(debut + tag.length + 5, fin)
  }
  const norm = s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim()
  // Les memes cles dans l'apercu et dans l'effacement (meme lecture que verifier-effacement.mjs).
  const apercu = corps(nouveau, 'apercu')
  const effacer = corps(nouveau, 'effacer')
  const cles = t => new Set([...t.matchAll(/'([a-z_]+)', \(select count/g)].map(m => m[1]))
  const efface = cles(apercu.slice(apercu.indexOf("'efface',"), apercu.indexOf("'anonymise',")))
  efface.add('aok_journaux_securite')
  const cotes = p => new Set([...effacer.matchAll(new RegExp(`${p} := ${p} \\|\\| jsonb_build_object\\(([^;]+?)\\);`, 'g'))]
    .flatMap(m => [...m[1].matchAll(/'([a-z_]+)', /g)].map(x => x[1])))
  assert.deepEqual([...cotes('v_efface')].sort(), [...efface].sort())
  const NOUVELLES = ['academie_reprises', 'academie_releve_skool', 'academie_membres_skool']
  for (const c of NOUVELLES) assert.ok(efface.has(c), c)
  // Sans rien perdre : les ajouts retires, le corps est celui de 20261016090000 (la derniere definition).
  const effacerSans = norm(effacer).replace(/delete from public\.academie_reprises [\s\S]*?jsonb_build_object\('academie_membres_skool', v_n\); /, '')
  assert.equal(effacerSans, norm(corps(ancien, 'effacer')))
  const apercuSans = norm(apercu).replace(/'academie_reprises', \(select count[\s\S]*?or x\.email = any\(k\.em\)\), /, '')
  assert.equal(apercuSans, norm(corps(ancien, 'apercu')))
  // Au niveau 3, avant la suppression du compte (profile_id passerait a null) ; jamais par le nom.
  const n3 = effacer.indexOf('-- Le pipeline ne recree pas la fiche.')
  for (const t of ['academie_reprises', 'academie_progression_skool', 'academie_skool_membres']) {
    const i = effacer.indexOf(`delete from public.${t}`)
    assert.ok(n3 > 0 && i > n3 && i < effacer.indexOf('delete from public.profiles where id'), t)
  }
  assert.ok(!/academie_skool_membres[^;]*(prenom|\bnom\b)/.test(effacer), 'jamais par le nom')
  // L'email de Skool rejoint la liste d'oubli, et l'import saute les adresses oubliees.
  assert.match(effacer, /insert into public\.cockpit_oublis_emails \(email_hash\)\s+select public\.cockpit_hash_email\(m\.email\) from public\.academie_skool_membres m/)
  assert.match(R.SQL_IMPORTER_MEMBRES, /not exists \(select 1 from public\.cockpit_oublis_emails o where o\.email_hash = public\.cockpit_hash_email\(t\.email\)\)/)
  assert.match(R.SQL_IMPORTER_COURS, /where exists \(select 1 from public\.academie_skool_membres m where m\.skool_member_id = t\.membre\)/)
  // Droits inchanges, libelles de la carte d'effacement.
  assert.ok(nouveau.includes('revoke all on function public.cockpit_effacer(integer, bigint[], uuid[], text[], text[], text) from public, anon, authenticated, service_role;'))
  assert.ok(nouveau.includes('revoke all on function public.cockpit_effacement_apercu(integer, bigint[], uuid[], text[], text[]) from public, anon, authenticated, service_role;'))
  assert.match(nouveau, /cockpit_effacer\([\s\S]{0,300}language plpgsql\s+volatile\s+security definer/)
  const libelles = lire('../src/lib/effacement-pur.ts')
  for (const c of NOUVELLES) assert.match(libelles, new RegExp(`\\b${c}: \\[`), `libelle ${c}`)
})

bloc('la route : jeton, CORS de l academie, debit, le serveur decide, rien de personnel dans les logs', () => {
  const route = lire('../src/app/api/academie/reprise/route.ts')
  assert.match(route, /compteDuJeton\(req\)/)
  assert.match(route, /entetesAcademie\(req\)/)
  assert.match(route, /corsAcademie\(req\)/)
  assert.match(route, /derniersAppels\.lire\(userId\)\) return refus\('debit', 429\)/)
  assert.match(route, /situationReprise\(userId\)/)
  assert.match(route, /droitsAcademie\(userId\)/)
  for (const m of route.matchAll(/console\.(?:info|warn|error)\(([^\n]*)/g)) {
    assert.ok(!/email|nom|prenom|corps/.test(m[1]), `log sans donnee personnelle : ${m[1].slice(0, 80)}`)
  }
  const serveur = lire('../src/lib/academie/reprise.ts')
  assert.match(serveur, /SQL_POSER_REPRISE[\s\S]*SQL_COCHER_REPRISE[\s\S]*SQL_COMPLETER_REPRISE/)
  assert.match(serveur, /prisma\.\$transaction/)
  assert.match(serveur, /REPRISES_PAR_HEURE/)
  // La route n'est pas publique : le middleware ne la laisse pas passer sans session.
  assert.ok(!lire('../middleware.ts').includes('/api/academie/reprise'))
})

bloc('aucun tiret long ni guillemet courbe dans les fichiers de la reprise', () => {
  for (const f of ['../src/lib/academie/reprise-pur.ts', '../src/lib/academie/reprise.ts', '../src/app/api/academie/reprise/route.ts', './importer-progression-skool.mjs']) {
    const t = lire(f)
    assert.ok(!/[—“”‘’]/.test(t), f)
  }
})

console.log(`\n${blocs} blocs ok`)

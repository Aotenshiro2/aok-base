// Verification HORS LIGNE du rattachement automatique et du pre-remplissage de
// l'avancee de Skool (15/11/2026 soir, brief
// D:\7_Agents\briefs\2026-11-15-academie-reprise-auto.md, go de Brice) : la
// decision (email puis nom, sans ambiguite dans les deux sens, jamais deux
// fois, personne effacee), la normalisation des noms, le plan du
// pre-remplissage (cours fini, cours partiel, ordre, cours douteux, rejouable),
// l'ecriture (une transaction simulee), /moi qui tient sur une panne, le
// bouton absent d'un cours pre-rempli, le cockpit, l'effacement, la migration
// 20261115200000 (lue comme un fichier) et le script de rattrapage.
// Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
//   node scripts/verifier-reprise-auto.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-reprise-auto.mjs.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as R from '../src/lib/academie/reprise-pur.ts'

let blocs = 0
async function bloc(nom, fn) {
  await fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')
function texteWorkspace(chemin) {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${chemin}`) : null,
    new URL(`../../../${chemin}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find(u => existsSync(u))
  if (!trouve) throw new Error(`introuvable : poser AOK_WORKSPACE (${chemin})`)
  return readFileSync(trouve, 'utf8')
}
const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261115200000_academie_reprise_auto.sql'
const sansCommentaires = sql => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

// Des couples (compte, membre) comme SQL_PAIRES_RATTACHEMENT les rend.
const C = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const S = c => c.repeat(32)
const paire = (compte, membre, mode, o = {}) => ({
  compte, membre, mode, source: mode === 'email' ? 'connexion' : 'profil', homonymes: 1,
  compteRelie: false, membreRelie: false, oublie: false, ...o,
})
const decider = (...p) => R.deciderRattachements(p)

// Un catalogue : La Formation (2 parties, rangees a l'envers, lecons dans le desordre, une lecon non publiee),
// Novice (sans partie), Rediffusion (Replay Premium, Archives des lives), Chroniques ; un module a venir.
const lc = (id, moduleId, sectionId, ordre, statut = 'publie') => ({ id, moduleId, sectionId, ordre, titre: id, statut })
const CAT = {
  modules: [
    { id: 'm-f', slug: 'la-formation-complete', statut: 'publie', lienExterne: null },
    { id: 'm-n', slug: 'novice-en-trading', statut: 'publie', lienExterne: null },
    { id: 'm-r', slug: 'rediffusion-des-lives', statut: 'publie', lienExterne: null },
    { id: 'm-c', slug: 'chroniques-de-l-accelerateur', statut: 'publie', lienExterne: null },
    { id: 'm-j', slug: 'journaling', statut: 'a_venir', lienExterne: null },
  ],
  sections: [
    { id: 's-p2', moduleId: 'm-f', ordre: 2, titre: 'Partie 2 : episodes 20 a 39' },
    { id: 's-p1', moduleId: 'm-f', ordre: 1, titre: 'Partie 1 : episodes 0 a 19' },
    { id: 's-rp', moduleId: 'm-r', ordre: 1, titre: 'Replay Premium' },
    { id: 's-ar', moduleId: 'm-r', ordre: 2, titre: 'Archives des lives' },
  ],
  lecons: [
    ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(o => lc(`p1-${o}`, 'm-f', 's-p1', o)),
    lc('p1-x', 'm-f', 's-p1', 11, 'a_venir'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(o => lc(`p2-${o}`, 'm-f', 's-p2', o)),
    ...[1, 2, 3, 4, 5, 6, 7].map(o => lc(`n-${o}`, 'm-n', null, o)),
    ...[1, 2, 3, 4].map(o => lc(`rp-${o}`, 'm-r', 's-rp', o)),
    ...[1, 2, 3].map(o => lc(`ar-${o}`, 'm-r', 's-ar', o)),
    ...[1, 2, 3].map(o => lc(`c-${o}`, 'm-c', null, o)),
    lc('j-1', 'm-j', null, 1, 'a_venir'),
  ],
}
const P1 = '37e96d438ae74ba89cfed1802431abbb'
const P2 = 'db9ea221835b43bc96e52e162cfa3559'
const NOVICE = 'a8ce77d4d50147bd9e97badd28baebec'
const REPLAY = 'd7be803d71994500b765073a16acbdaf'
const REDIFF = 'da8fce017cfa4f308106ab268e2193c1'
const CHRONIQUE = '0ef8880bf45f40e59ba84f90b6729920'
const JOURNALING = 'd31ba04e2a434f608b36fd2fd5ca4fa2'
const INITIATION = '24f3805eb884446b95190f1289fdf382'
const r = (cours, t, n, le = '2026-11-15') => ({ skoolCoursId: cours, skoolCoursTitre: '', leconsTerminees: t, leconsTotal: n, releveLe: le })
const plan = (releve, verrousFaits = [], o = {}) => R.planRemplissage({ releve, catalogue: CAT, verrousFaits, ...o })

// ---------------------------------------------------------------------------

await bloc('relie par email : la meilleure source, la connexion d abord, puis la fiche du cockpit', () => {
  const d = decider(paire(C(1), S('a'), 'email'))
  assert.deepEqual(d.rattachements, [{ compte: C(1), membre: S('a'), mode: 'email', source: 'connexion' }])
  // Retrouve par la fiche du cockpit (un email de la fiche) : relie, source fiche.
  assert.deepEqual(decider(paire(C(2), S('b'), 'email', { source: 'fiche' })).rattachements[0].source, 'fiche')
  // L'email passe avant le nom : un compte qui retrouve un membre par email et un AUTRE par son nom suit l'email.
  const d2 = decider(paire(C(3), S('c'), 'email'), paire(C(3), S('d'), 'nom'))
  assert.deepEqual(d2.rattachements.map(x => [x.membre, x.mode]), [[S('c'), 'email']])
  assert.equal(d2.emailContreNom, 1)
  // Les sources : seulement les emails VERIFIES (profile_emails.verified, auth.users confirme), la fiche par
  // cockpit_membre_emails, ses paiements, jamais une adresse ambigue ni aucune.
  const sql = R.SQL_PAIRES_RATTACHEMENT
  assert.match(sql, /u\.email is not null and u\.email_confirmed_at is not null/)
  assert.match(sql, /where pe\.verified = true and pe\.email is not null/)
  assert.match(sql, /from public\.academie_invitations i\s+where i\.user_id is not null/)
  assert.match(sql, /from public\.academie_acces a\s+where a\.user_id is not null and a\.email is not null/)
  assert.match(sql, /join public\.cockpit_membre_emails f on lower\(btrim\(f\.email\)\) = d\.e/)
  assert.match(sql, /join public\.cockpit_paiements p on p\.membre_id = fi\.membre_id\s+where p\.payeur_email is not null/)
  assert.match(sql, /join public\.cockpit_membres c on c\.membre_id = fi\.membre_id/)
  assert.match(sql, /where k\.email_source not in \('aucune', 'ambigu-plusieurs-homonymes'\)/)
  assert.deepEqual([...R.SOURCES_RATTACHEMENT_EMAIL], ['connexion', 'secondaire', 'invitation', 'acces', 'fiche', 'paiement'])
})

await bloc('relie par nom unique (prenom ET nom, normalises), sans auteur', () => {
  const d = decider(paire(C(1), S('a'), 'nom'))
  assert.deepEqual(d.rattachements, [{ compte: C(1), membre: S('a'), mode: 'nom', source: 'profil' }])
  assert.equal(decider(paire(C(1), S('a'), 'nom', { source: 'fiche' })).rattachements[0].source, 'fiche')
  // Minuscules, sans accents, espaces reduits.
  assert.equal(R.normaliserNom('  ÉLODIE   Dé\u00a0La Tour '), 'elodie de la tour')
  assert.equal(R.normaliserNom('Œuvre Æsir Straße Łukasz Ñúñez Øyvind'), 'oeuvre aesir strasse lukasz nunez oyvind')
  assert.equal(R.normaliserNom('Jean-Pierre'), 'jean-pierre')
  // La meme table en SQL (translate), et les deux colonnes non vides des deux cotes.
  const s = R.sqlNomNormalise('x.nom')
  assert.match(s, /^nullif\(btrim\(regexp_replace\(replace\(replace\(replace\(translate\(lower\(coalesce\(x\.nom, ''\)\), 'àáâ/)
  assert.ok(s.includes("'\\s+', ' ', 'g'"), 'espaces reduits')
  assert.match(R.SQL_PAIRES_RATTACHEMENT, /where n\.pn is not null and n\.nn is not null/)
  assert.match(R.SQL_PAIRES_RATTACHEMENT, /where k\.pn is not null and k\.nn is not null/)
  // Le rattachement pose le mode et la source, jamais d'auteur.
  assert.match(R.SQL_RATTACHER_AUTO, /rattache_mode = \$3::text,\s+rattache_source = \$4::text,\s+rattache_par = null/)
  assert.match(R.SQL_RATTACHER_AUTO, /and \$3::text in \('email', 'nom'\)/)
})

await bloc('homonyme refuse : deux membres de Skool OU deux comptes du meme nom', () => {
  // Deux membres de Skool du meme nom : ce nom ne compte pas.
  const deuxMembres = decider(paire(C(1), S('a'), 'nom', { homonymes: 2 }), paire(C(1), S('b'), 'nom', { homonymes: 2 }))
  assert.deepEqual(deuxMembres.rattachements, [])
  assert.equal(deuxMembres.nomsHomonymes, 1)
  // Un compte qui porte deux noms (profil, fiche) : seul le nom unique compte.
  assert.deepEqual(decider(paire(C(1), S('a'), 'nom', { homonymes: 2 }), paire(C(1), S('c'), 'nom', { source: 'fiche' })).rattachements
    .map(x => x.membre), [S('c')])
  // Deux comptes du meme nom (le profil de l'un, la fiche de l'autre) : le membre en retrouve deux, aucun n'est relie.
  const deuxComptes = decider(paire(C(1), S('a'), 'nom'), paire(C(2), S('a'), 'nom', { source: 'fiche' }))
  assert.deepEqual(deuxComptes.rattachements, [])
  assert.deepEqual(deuxComptes.refus.map(x => x.motif), ['ambigu_membre', 'ambigu_membre'])
  // Le compte retrouve deux membres par email : refuse.
  assert.deepEqual(decider(paire(C(1), S('a'), 'email'), paire(C(1), S('b'), 'email')).refus.map(x => x.motif), ['ambigu_compte'])
  // Le membre est retrouve par email par un AUTRE compte : celui qui ne l'a que par le nom n'est pas relie.
  const autre = decider(paire(C(1), S('a'), 'nom'), paire(C(2), S('a'), 'email'))
  assert.deepEqual(autre.rattachements.map(x => x.compte), [C(2)])
  assert.deepEqual(autre.refus, [{ compte: C(1), membre: S('a'), motif: 'ambigu_membre' }])
})

await bloc('nom vide refuse : prenom ou nom manquant, des deux cotes, en base aussi', () => {
  for (const v of ['', '   ', '\u00a0', null, undefined, 42]) assert.equal(R.normaliserNom(v), null)
  // Le SQL vide un nom blanc (nullif) et ne fait de couple qu'avec un prenom ET un nom.
  assert.match(R.sqlNomNormalise('p.first_name'), /^nullif\(btrim\(/)
  // La base refuse un rattachement par nom d'un membre sans prenom ou sans nom.
  const code = sansCommentaires(texteWorkspace(MIGRATION))
  assert.match(code, /rattache_mode is distinct from 'nom'\s+or \(rattache_par is null and rattache_source in \('profil', 'fiche'\)\s+and nullif\(btrim\(prenom\), ''\) is not null and nullif\(btrim\(nom\), ''\) is not null\)/)
})

await bloc('un membre de Skool deja relie n est pas touche, un compte n est jamais relie deux fois', () => {
  assert.deepEqual(decider(paire(C(1), S('a'), 'email', { membreRelie: true })).refus, [{ compte: C(1), membre: S('a'), motif: 'membre_relie' }])
  const deja = decider(paire(C(1), S('a'), 'email', { compteRelie: true }), paire(C(1), S('b'), 'nom', { compteRelie: true }))
  assert.deepEqual(deja.rattachements, [])
  assert.equal(deja.dejaRelies, 1)
  // La base le garde aussi (deux passages simultanes) : profile_id vide, et aucun autre membre sur ce compte.
  assert.match(R.SQL_RATTACHER_AUTO, /where m\.skool_member_id = \$2::text\s+and m\.profile_id is null/)
  assert.match(R.SQL_RATTACHER_AUTO, /and not exists \(select 1 from public\.academie_skool_membres x where x\.profile_id = \$1::uuid\)/)
  // Une personne effacee ne revient pas : un email du compte ou du membre dans la liste d'oubli.
  assert.deepEqual(decider(paire(C(1), S('a'), 'email', { oublie: true })).refus.map(x => x.motif), ['oublie'])
  assert.match(R.SQL_PAIRES_RATTACHEMENT, /join public\.cockpit_oublis_emails o on o\.email_hash = public\.cockpit_hash_email\(e\.e\)/)
  assert.match(R.SQL_PAIRES_RATTACHEMENT, /join public\.cockpit_oublis_emails o on o\.email_hash = public\.cockpit_hash_email\(k\.email\)/)
  // Un nouvel import ne casse pas un rattachement par nom tant que le nom ne change pas, et nettoie la source.
  assert.match(R.SQL_IMPORTER_MEMBRES, /or m\.rattache_mode = 'nom' and \(excluded\.prenom, excluded\.nom\) is distinct from \(m\.prenom, m\.nom\)/)
  assert.match(R.SQL_IMPORTER_MEMBRES, /rattache_source = case when/)
})

await bloc('cours fini = tout le cours, cours partiel = la bonne proportion dans le bon ordre', () => {
  // Novice fini (7/7) : ses 7 lecons. Partie 1 a 3 sur 10 : les 3 premieres de la partie (ordre, pas l'ordre de la liste).
  const items = plan([r(NOVICE, 7, 7), r(P1, 3, 10)])
  const novice = items.find(i => i.moduleId === 'm-n')
  assert.deepEqual(novice.lecons, ['n-1', 'n-2', 'n-3', 'n-4', 'n-5', 'n-6', 'n-7'])
  assert.deepEqual([novice.portee, novice.sectionId, novice.verrou], ['module', null, 'module:m-n'])
  const formation = items.find(i => i.moduleId === 'm-f')
  assert.deepEqual(formation.lecons, ['p1-1', 'p1-2', 'p1-3'])
  assert.deepEqual([formation.portee, formation.sectionId, formation.verrou], ['section', 's-p1', 'module:m-f'])
  // Partie 1 finie et Partie 2 a 4 sur 42 : toute la partie 1 publiee (pas la lecon a venir), puis round(4/42 x 10) = 1.
  const deux = plan([r(P1, 42, 42), r(P2, 4, 42)]).find(i => i.moduleId === 'm-f')
  assert.deepEqual(deux.lecons, [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(o => `p1-${o}`), 'p2-1'])
  assert.deepEqual([deux.portee, deux.sectionId], ['module', null], 'deux parties : une ligne, le cours entier')
  assert.equal(deux.cours.length, 2)
  // Au moins 1 si Skool en montre une ; rien si Skool n'en montre aucune ; la part arrondie.
  assert.equal(R.nombreACocher(1, 66, 10), 1)
  assert.equal(R.nombreACocher(0, 42, 10), 0)
  assert.equal(R.nombreACocher(21, 42, 10), 5)
  assert.equal(R.nombreACocher(5, 8, 42), 26)
  assert.equal(R.nombreACocher(60, 60, 69), 69)
  assert.equal(plan([r(P2, 0, 42)]).length, 0)
  // Le dernier releve d'un cours ; un module a venir n'est pas rempli (il le sera quand il sera publie).
  assert.deepEqual(plan([r(NOVICE, 7, 7, '2026-11-01'), r(NOVICE, 2, 7, '2026-11-15')]).find(i => i.moduleId === 'm-n').lecons, ['n-1', 'n-2'])
  assert.equal(plan([r(JOURNALING, 20, 20)]).length, 0)
  // Le repere garde dans le journal : celui de la cible.
  assert.equal(formation.pourcentage, 30)
  // L'ordre de l'academie : sans partie, puis les parties dans leur ordre.
  assert.deepEqual(R.leconsDansLOrdre(CAT, 'm-f').slice(0, 2), ['p1-1', 'p1-2'])
  assert.deepEqual(R.leconsDansLOrdre(CAT, 'm-f', 's-p2')[0], 'p2-1')
})

await bloc('une lecon deja vue (ou ouverte, ou decochee) n est jamais touchee', () => {
  const sql = R.SQL_COCHER_REPRISE_AUTO
  assert.match(sql, /on conflict \(user_id, lecon_id\) do nothing/)
  assert.ok(!/do update/.test(sql), 'jamais de mise a jour d une ligne existante')
  assert.match(sql, /l\.statut = 'publie' and m\.statut = 'publie'/)
})

await bloc('deuxieme passage sans effet : le verrou du journal, en base et dans le plan', async () => {
  const items = plan([r(NOVICE, 7, 7), r(P1, 3, 10), r(REPLAY, 2, 22)])
  assert.equal(items.length, 3)
  assert.deepEqual(plan([r(NOVICE, 7, 7), r(P1, 3, 10), r(REPLAY, 2, 22)], items.map(i => i.verrou)), [])
  // Le bouton deja utilise (mode membre) : meme verrou, rien a remplir.
  assert.deepEqual(plan([r(NOVICE, 7, 7)], ['module:m-n']), [])
  // L'ecriture, simulee : le journal d'abord, puis les lecons manquantes, puis la liste ; au second passage
  // l'index unique ne rend aucune ligne et rien d'autre n'est ecrit.
  const appels = []
  let premier = true
  const tx = {
    async $queryRawUnsafe(sql, ...v) {
      appels.push(sql === R.SQL_POSER_REPRISE_AUTO ? 'poser' : sql === R.SQL_COCHER_REPRISE_AUTO ? 'cocher' : 'autre')
      if (sql === R.SQL_POSER_REPRISE_AUTO) return premier ? [{ id: `r-${v[4]}` }] : []
      if (sql === R.SQL_COCHER_REPRISE_AUTO) return v[1].slice(1).map(lecon_id => ({ lecon_id }))
      return []
    },
    async $executeRawUnsafe(sql, ...v) {
      appels.push(sql === R.SQL_COMPLETER_REPRISE_AUTO ? `completer:${v[1].length}+${v[2]}` : 'autre')
      return 1
    },
  }
  const fait = await R.ecrireRemplissage(tx, C(1), items)
  assert.deepEqual(fait, { cours: 3, lecons: items.reduce((n, i) => n + i.lecons.length - 1, 0) })
  assert.deepEqual(appels.slice(0, 3), ['poser', 'cocher', `completer:${items[0].lecons.length - 1}+1`])
  premier = false
  appels.length = 0
  assert.deepEqual(await R.ecrireRemplissage(tx, C(1), items), { cours: 0, lecons: 0 })
  assert.deepEqual(appels, ['poser', 'poser', 'poser'])
  assert.match(R.SQL_POSER_REPRISE_AUTO, /on conflict \(user_id, verrou\) where mode in \('membre', 'auto'\) do nothing/)
  assert.match(R.SQL_POSER_REPRISE_AUTO, /'auto', null, \$5::text/)
})

await bloc('cours douteux exclus (Chronique, Rediffusion des Lives), sans equivalent aussi', () => {
  assert.deepEqual(plan([r(CHRONIQUE, 30, 66), r(REDIFF, 31, 31), r(INITIATION, 8, 8)]), [])
  assert.equal(R.COURS_SKOOL_REMPLIS.has(CHRONIQUE), false)
  assert.equal(R.COURS_SKOOL_REMPLIS.has(REDIFF), false)
  assert.equal(R.COURS_SKOOL_REMPLIS.has(INITIATION), false)
  assert.equal(R.COURS_SKOOL_REMPLIS.size, R.CORRESPONDANCE_SKOOL.filter(c => c.module && c.sure).length)
  assert.ok(!R.SQL_ETAT_AUTO.includes(CHRONIQUE) && !R.SQL_ETAT_AUTO.includes(REDIFF), 'la base ne les lit meme pas')
  // Replay Premium (sur) : la partie Replay Premium seulement.
  const rp = plan([r(REPLAY, 22, 22)])
  assert.deepEqual(rp.map(i => [i.portee, i.sectionId, i.lecons.join(',')]), [['section', 's-rp', 'rp-1,rp-2,rp-3,rp-4']])
})

await bloc('aucun point, aucun temps : les memes marques que le bouton', () => {
  const sql = R.SQL_COCHER_REPRISE_AUTO
  for (const c of ['terminee_le', 'marquee_vue_le', 'secondes_vues', 'pourcentage', 'dernier_signal_le', 'position_max_s']) {
    assert.ok(!sql.includes(c), `ne touche pas ${c}`)
  }
  assert.match(sql, /\(user_id, lecon_id, derniere_vue_le, nb_sessions, vu_le, vu_par\)\s+select \$1::uuid, l\.id, now\(\), 0, now\(\), 'reprise'/)
  // Pas de fenetre de 30 jours pour l'automatique : ni etatReprise ni la fenetre dans repriseAutomatique.
  const serveur = lire('../src/lib/academie/reprise.ts')
  const auto = serveur.slice(serveur.indexOf('export async function repriseAutomatique'))
  assert.ok(!/etatReprise|fenetreReprise|ouverte|REPRISE_JOURS/.test(auto))
  assert.ok(!/resend|telegram|sendMessage|notifier|envoyerEmail|cloche/i.test(auto.replace(/\/\/.*$/gm, '')))
})

await bloc('le mode auto est compte dans le Cockpit comme les autres (par vu_par, jamais par le mode)', () => {
  const cockpit = texteWorkspace('apps/cockpit/src/lib/academie.ts')
  assert.match(cockpit, /export const estReprise = \(p: ProgressionAca\) => Boolean\(p\.vu_le\) && p\.vu_par === 'reprise'/)
  assert.match(cockpit, /if \(estReprise\(p\)\) s\.reprises\+\+/)
  // Le cockpit ne lit pas le journal des reprises : aucun filtre sur le mode.
  for (const f of ['apps/cockpit/src/lib/academie.ts', 'apps/cockpit/src/views/academie/Consommation.tsx']) {
    assert.ok(!/academie_reprises|mode === 'membre'|mode = 'membre'/.test(texteWorkspace(f)), f)
  }
  // Le journal : l'activite du jour (points) ne lit ni vu_le ni vu_par (verifier-reprise.mjs), et l'agent du
  // cockpit connait le mode auto.
  assert.match(lire('../src/lib/agent-cockpit.ts'), /mode membre\|equipe\|auto/)
})

await bloc('le rattachement a la main confirme par Brice : mode equipe, avec auteur (Brice), un filet', () => {
  assert.equal(R.RATTACHEMENTS_A_LA_MAIN.length, 1)
  const f = R.RATTACHEMENTS_A_LA_MAIN[0]
  assert.deepEqual([f.membre, f.compte, f.par], ['91b8c4f373e54933a8efd6afd043d8c1', 'ef210909-1b85-4c60-a408-b6ad232a8eef', R.COMPTE_BRICE])
  assert.equal(R.COMPTE_BRICE, '0636a40b-13a4-4fe8-af11-d060e2810767')
  assert.match(R.SQL_RATTACHER_A_LA_MAIN, /rattache_mode = 'equipe',\s+rattache_source = null,\s+rattache_par = \$3::uuid/)
  assert.match(R.SQL_RATTACHER_A_LA_MAIN, /and m\.profile_id is null\s+and not exists \(select 1 from public\.academie_skool_membres x where x\.profile_id = \$2::uuid\)/)
  // Le script ne le pose que si l'automatique ne l'a pas fait.
  const script = lire('./rattraper-reprise-skool.mjs')
  assert.match(script, /if \(lie === x\.compte\) return \{ \.\.\.x, etat: lienBase\.has\(x\.membre\) \? 'deja' : 'auto' \}/)
  assert.match(script, /for \(const x of aFaire\) \{\s+const fait = await tx\.\$queryRawUnsafe\(R\.SQL_RATTACHER_A_LA_MAIN, x\.membre, x\.compte, x\.par\)/)
  // La base exige un auteur pour un rattachement a la main.
  assert.match(sansCommentaires(texteWorkspace(MIGRATION)), /check \(rattache_mode is null or rattache_mode in \('email', 'nom'\) or rattache_par is not null\)/)
})

await bloc('le bouton absent pour un cours rempli tout seul (plan, /moi, base)', () => {
  const etat = R.etatReprise({ releveSkool: true, ancien: false, arrivee: new Date('2026-11-17T09:00:00Z'), maintenant: new Date('2026-11-20T12:00:00Z') })
  const lecons = [1, 2].map(n => ({ id: `l${n}`, sectionId: 's1', lisible: true, acces: 'ouvert', raisons: ['skool'], vue: false }))
  const p = o => R.planReprise({ etat, faites: [], module: { id: 'm1', publie: true, externe: false }, sectionId: null, sections: ['s1'], lecons, ...o })
  const auto = [{ moduleId: 'm1', sectionId: 's1', mode: 'auto', lecons: 2 }]
  assert.deepEqual(p({ faites: auto }), { refus: 'deja' })
  assert.deepEqual(p({ faites: auto, sectionId: 's1' }), { refus: 'deja' })
  assert.ok('lecons' in p({ faites: [{ moduleId: 'm1', sectionId: null, mode: 'equipe' }] }), 'un geste de l equipe ne compte pas')
  assert.deepEqual([...R.MODES_UNE_FOIS], ['membre', 'auto'])
  // /moi rend les faites des deux modes, avec le mode et le nombre de lecons (le site cache le bouton, dit « N lecons »).
  const serveur = lire('../src/lib/academie/reprise.ts')
  assert.match(serveur, /faites: s\.faites\.filter\(f => MODES_UNE_FOIS\.includes\(f\.mode\)\)\s+\.map\(f => \(\{ module_id: f\.moduleId, section_id: f\.sectionId, mode: f\.mode, lecons: f\.lecons \?\? 0 \}\)\)/)
  assert.match(R.SQL_REPRISES_DU_COMPTE, /cardinality\(r\.lecons\)::int as lecons/)
  // La base : l'index unique couvre membre ET auto (le bouton du journal d'avant y bute aussi : essai).
  assert.match(sansCommentaires(texteWorkspace(MIGRATION)),
    /create unique index if not exists academie_reprises_une_fois_idx\s+on public\.academie_reprises \(user_id, verrou\) where mode in \('membre', 'auto'\)/)
})

await bloc('/moi tient si le rattachement ou le remplissage echoue', () => {
  const route = lire('../src/app/api/academie/moi/route.ts')
  // Le remplissage est attrape (log, null) ; un catalogue illisible ne le lance pas ; la progression et le bouton
  // sont lus APRES lui, qu'il ait reussi ou non.
  assert.match(route, /const auto: Promise<BilanAuto \| null> = lectureCatalogue\.then\(\s+cat => repriseAutomatique\(userId, cat\)/)
  assert.match(route, /\(\) => null,\s+\)\.catch\(\(err: unknown\) => \{\s+console\.warn\(`\[academie\/moi\] reprise auto en echec compte=\$\{tronquer\(userId\)\} : \$\{messageErreur\(err\)\}`\)\s+return null\s+\}\)/)
  assert.match(route, /auto\.then\(\(\) => progressionDuCompte\(userId\)\)/)
  assert.match(route, /const reprise: Promise<SituationReprise \| null> = auto\.then\(\(\) => situationReprise\(userId\)\)\.catch/)
  // Un « auto » qui ne rejette jamais : la progression ne peut pas tomber a cause de lui (simulation de la chaine).
  return (async () => {
    const panne = Promise.reject(new Error('panne')).then(() => 'jamais', () => null).catch(() => null)
    assert.equal(await panne.then(() => 'progression lue'), 'progression lue')
    const panneApres = Promise.resolve('catalogue').then(() => Promise.reject(new Error('base')), () => null).catch(() => null)
    assert.equal(await panneApres.then(() => 'progression lue'), 'progression lue')
    // Les logs : le compte tronque, des modes et des nombres, jamais un email, un nom ni un id de Skool.
    for (const m of route.matchAll(/console\.(?:info|warn|error)\(([^\n]*(?:\n\s+\+[^\n]*)?)/g)) {
      assert.ok(!/email\b(?!\/)|prenom|membre}|\.membre|first_name/.test(m[1].replace(/rattache\?\.mode/g, '')), `log : ${m[1].slice(0, 90)}`)
    }
    // Une transaction bornee (verrous, duree).
    const serveur = lire('../src/lib/academie/reprise.ts')
    assert.match(serveur, /set local lock_timeout = '3s'/)
    assert.match(serveur, /set local statement_timeout = '8s'/)
    assert.match(serveur, /return ecrireRemplissage\(tx, userId, items\)/)
  })()
})

await bloc('l effacement : les reprises de tout mode et le membre de Skool rattache par nom', () => {
  const effacement = texteWorkspace('sites/Aoknowledgecom/supabase/migrations/20261115180000_academie_reprise_progression.sql')
  assert.match(effacement, /delete from public\.academie_reprises where user_id = any\(v_us\);/)
  assert.match(effacement, /delete from public\.academie_skool_membres where profile_id = any\(v_us\) or email = any\(v_em\);/)
  assert.match(effacement, /'academie_reprises', \(select count\(\*\) from public\.academie_reprises x where x\.user_id = any\(k\.us\)\)/)
  const s6 = sansCommentaires(effacement.slice(effacement.indexOf('-- 6.')))
  for (const l of s6.split('\n').filter(x => x.includes('academie_reprises'))) assert.ok(!/\bmode\b/.test(l), `aucun filtre sur le mode : ${l.trim()}`)
  assert.ok(!/rattache_mode/.test(s6), 'aucun filtre sur le mode de rattachement')
  // Cette migration ne redefinit pas l'effacement.
  assert.ok(!/cockpit_effacer|cockpit_effacement_apercu/.test(sansCommentaires(texteWorkspace(MIGRATION))))
})

await bloc('la migration 20261115200000 : modes nom et auto, contraintes, decoupable, rejouable', () => {
  const sql = texteWorkspace(MIGRATION)
  const code = sansCommentaires(sql)
  assert.match(code, /alter table public\.academie_skool_membres add column if not exists rattache_source text;/)
  assert.match(code, /check \(rattache_mode is null or rattache_mode in \('email', 'nom', 'equipe', 'membre'\)\)/)
  assert.match(code, /or \(rattache_mode = 'email' and rattache_source in \('connexion', 'secondaire', 'invitation', 'acces', 'fiche', 'paiement'\)\)\s+or \(rattache_mode = 'nom' and rattache_source in \('profil', 'fiche'\)\)/)
  assert.match(code, /alter table public\.academie_reprises alter column par drop not null;/)
  assert.match(code, /check \(mode in \('membre', 'equipe', 'auto'\)\)/)
  assert.match(code, /check \(mode <> 'auto' or \(par is null and verrou is not null\)\)/)
  assert.match(code, /check \(mode = 'auto' or par is not null\)/)
  assert.match(code, /drop index if exists public\.academie_reprises_une_fois_idx;/)
  // Chaque contrainte est retiree avant d'etre posee : rejouable.
  for (const m of code.matchAll(/add constraint (\w+)/g)) assert.match(code, new RegExp(`drop constraint if exists ${m[1]};`), m[1])
  // Aucune policy ni aucun droit ne change.
  assert.ok(!/\b(grant|revoke|create policy|drop policy)\b/i.test(code))
  // Pas de begin ni de commit (l'essai annule les validerait), aucun point-virgule dans les commentaires.
  assert.ok(!/^\s*(begin|commit|rollback)\s*;/im.test(code))
  for (const l of sql.split('\n')) if (l.trim().startsWith('--')) assert.ok(!l.includes(';'), `commentaire sans point-virgule : ${l.slice(0, 60)}`)
  // Les sources de la base et du journal sont les memes.
  for (const s of [...R.SOURCES_RATTACHEMENT_EMAIL, ...R.SOURCES_RATTACHEMENT_NOM]) assert.ok(code.includes(`'${s}'`), s)
})

await bloc('le script de rattrapage : a blanc par defaut, une transaction, des nombres seulement', () => {
  const script = lire('./rattraper-reprise-skool.mjs')
  assert.match(script, /const ECRIRE = args\.includes\('--ecrire'\)/)
  assert.match(script, /if \(!ECRIRE\) \{\s+console\.log\('\\nA BLANC/)
  assert.match(script, /await prisma\.\$transaction\(async tx => \{/)
  assert.match(script, /R\.deciderRattachements\(R\.lirePaires\(await prisma\.\$queryRawUnsafe\(R\.SQL_PAIRES_RATTACHEMENT\)\)\)/)
  assert.match(script, /const f = await R\.ecrireRemplissage\(tx, compte, items\)/)
  // Ses sorties : jamais un compte, un membre, un email ni un nom interpoles.
  for (const m of script.matchAll(/console\.(?:log|error)\(([^\n]*)/g)) {
    assert.ok(!/\$\{(?:r|x|p|l)\.(?:compte|membre|email|prenom|nom|note)\b|\$\{compte\}|\$\{membre\}/.test(m[1]), `sortie : ${m[1].slice(0, 90)}`)
  }
  // L'import suit la meme regle (plus de rattachement par email a part).
  const importer = lire('./importer-progression-skool.mjs')
  assert.match(importer, /R\.deciderRattachements\(R\.lirePaires\(await tx\.\$queryRawUnsafe\(R\.SQL_PAIRES_RATTACHEMENT\)\)\)/)
  assert.ok(!('SQL_RATTACHER_PAR_EMAIL' in R), 'l ancienne regle par email seule n existe plus')
})

await bloc('aucun tiret long ni guillemet courbe dans les fichiers touches', () => {
  for (const f of ['../src/lib/academie/reprise-pur.ts', '../src/lib/academie/reprise.ts', '../src/app/api/academie/moi/route.ts',
    './rattraper-reprise-skool.mjs', './importer-progression-skool.mjs']) {
    assert.ok(!/[—“”‘’]/.test(lire(f)), f)
  }
  assert.ok(!/[—“”‘’]/.test(texteWorkspace(MIGRATION)), 'migration')
})

console.log(`\n${blocs} blocs ok`)
